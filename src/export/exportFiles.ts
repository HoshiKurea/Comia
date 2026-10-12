import { jsPDF } from 'jspdf';
import type { Id, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { EXPORT_BUDGET } from '../domain/limits';
import type { ImageResources } from '../render/drawScene';
import { compileScene, type RenderPlan } from '../render/compileScene';
import { drawPlan } from '../render/drawPlan';
import { triggerDownload } from '../storage/fileSave';
import { retainResources } from '../storage/blobRepository';
import { awaitFonts } from '../text/fonts';
import { resolveVerticalGlyph, VERTICAL_PUNCTUATION, verticalFallbackMessage } from '../text/verticalGlyphs';

export interface ExportProgress { phase: 'prepare' | 'render' | 'encode'; completed: number; total: number }
export interface ExportSettings { scale?: number; onProgress?: (value: ExportProgress) => void; onWarning?: (message: string) => void }
export interface RasterSize { width: number; height: number; estimatedBytes: number }
export function rasterSize(width: number, height: number, scale = 1): Result<RasterSize> {
  if (!Number.isFinite(scale) || scale < 0.25 || scale > 4) return fail(problem('export/scale', '导出倍率必须在0.25～4之间'));
  const w = Math.round(width * scale), h = Math.round(height * scale), bytes = w * h * 12;
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1 || w > EXPORT_BUDGET.maxSide || h > EXPORT_BUDGET.maxSide || w * h > EXPORT_BUDGET.maxPixels || bytes > EXPORT_BUDGET.maxEstimatedBytes) return fail(problem('export/budget', '页面超出导出内存预算，请降低倍率或页面尺寸'));
  return ok({ width: w, height: h, estimatedBytes: bytes });
}
/** Allocation-free budget preflight, shared by disabled feedback and actual export. */
export function exportAvailability(project: Project, pageIds: Id[], format: 'png' | 'pdf', scale = 1): Result<void> {
  if (!pageIds.length) return fail(problem('export/empty', '没有可导出的页面'));
  let rasterBytes = 0;
  const hashes = new Map<string, number>();
  const visit = (id: Id): Result<void> => {
    const layer = project.layers[id]; if (!layer?.visible) return ok(undefined);
    if (layer.type === 'image') {
      const meta = project.assets[layer.assetId];
      if (!meta) return fail(problem('export/asset', `图片“${layer.name}”缺少资源记录`));
      hashes.set(meta.renderHash, meta.width * meta.height * 4);
    }
    if ('children' in layer) for (const child of layer.children) { const result = visit(child); if (!result.ok) return result; }
    return ok(undefined);
  };
  for (const id of pageIds) {
    const page = project.pages[id]; if (!page) return fail(problem('export/page', '页面不存在'));
    const size = rasterSize(page.width, page.height, scale); if (!size.ok) return size;
    const bytes = size.value.estimatedBytes + (format === 'pdf' ? size.value.width * size.value.height * 4 : 0);
    if (bytes > EXPORT_BUDGET.maxEstimatedBytes) return fail(problem('export/budget', 'PDF绘制与编码画布超出内存预算，请降低倍率或页面尺寸'));
    rasterBytes = Math.max(rasterBytes, bytes);
    for (const root of page.roots) { const result = visit(root); if (!result.ok) return result; }
  }
  if (rasterBytes + [...hashes.values()].reduce((sum, bytes) => sum + bytes, 0) > EXPORT_BUDGET.maxEstimatedBytes) return fail(problem('export/budget', '图片快照与页面超过导出内存预算，请减小页面或拆分项目'));
  return ok(undefined);
}
function check(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException('导出已取消', 'AbortError'); }
function errorResult(error: unknown): Result<never> {
  return fail(problem(error instanceof DOMException && error.name === 'AbortError' ? 'export/cancelled' : 'export/failed', error instanceof Error ? error.message : '导出失败，请重试'));
}
const yieldFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function raster(plan: RenderPlan, images: ImageResources, white: boolean, size: RasterSize, scale: number, signal?: AbortSignal): Promise<Blob> {
  check(signal); const canvas = document.createElement('canvas');
  let encodingCanvas: HTMLCanvasElement | null = null;
  try {
    canvas.width = size.width; canvas.height = size.height;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('无法创建导出画布');
    if (white) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size.width, size.height); }
    ctx.scale(scale, scale); drawPlan(ctx, plan, images);
    if (white) {
      // Keep text AA identical to PNG/main paint (opaque canvases enable different LCD AA).
      // Copy the completed white-backed RGBA raster to an opaque encoding-only canvas.
      // jsPDF 2.5.2 processPNG then reuses lossless RGB IDAT, avoiding inflate/split/recompress.
      encodingCanvas = document.createElement('canvas'); encodingCanvas.width = size.width; encodingCanvas.height = size.height;
      const encodingContext = encodingCanvas.getContext('2d', { alpha: false }); if (!encodingContext) throw new Error('无法创建PDF编码画布');
      encodingContext.drawImage(canvas, 0, 0);
    }
    const outputCanvas = encodingCanvas ?? canvas;
    const blob = await new Promise<Blob | null>((resolve, reject) => { try { outputCanvas.toBlob(resolve, 'image/png'); } catch (error) { reject(error); } });
    check(signal); if (!blob) throw new Error('PNG编码失败，请重试'); return blob;
  } finally { canvas.width = 0; canvas.height = 0; if (encodingCanvas) { encodingCanvas.width = 0; encodingCanvas.height = 0; } }
}

/** Copy every needed bitmap before the first await; opening another project may close the originals. */
async function cloneImages(project: Project, pageIds: Id[], images: ImageResources, rasterBytes: number, signal?: AbortSignal): Promise<Map<string, ImageBitmap>> {
  check(signal); const hashes = new Set<string>();
  const visit = (id: Id) => {
    const layer = project.layers[id]; if (!layer?.visible) return;
    if (layer.type === 'image') { const meta = project.assets[layer.assetId]; if (!meta) throw new Error(`图片“${layer.name}”缺少资源记录`); hashes.add(meta.renderHash); }
    if ('children' in layer) for (const child of layer.children) visit(child);
  };
  for (const id of pageIds) for (const root of project.pages[id].roots) visit(root);
  let bytes = rasterBytes;
  const sources = [...hashes].map((hash) => {
    const image = images.get(hash); if (!image) throw new Error(`图片资源 ${hash.slice(0, 12)} 尚未就绪，无法导出`);
    const meta = Object.values(project.assets).find((asset) => asset.renderHash === hash)!;
    bytes += meta.width * meta.height * 4; return { hash, image };
  });
  if (bytes > EXPORT_BUDGET.maxEstimatedBytes) throw new Error('图片快照与页面超过导出内存预算，请减小页面或拆分项目');
  const promises = sources.map(({ hash, image }) => {
    try { return createImageBitmap(image as ImageBitmapSource).then((bitmap) => ({ hash, bitmap })); }
    catch (error) { return Promise.reject(error); }
  });
  const settled = await Promise.allSettled(promises), output = new Map<string, ImageBitmap>();
  const failed = settled.find((result) => result.status === 'rejected');
  for (const result of settled) if (result.status === 'fulfilled') output.set(result.value.hash, result.value.bitmap);
  if (failed || signal?.aborted) {
    for (const bitmap of output.values()) bitmap.close(); check(signal);
    throw new Error(`图片快照无法解码：${failed?.status === 'rejected' ? String(failed.reason) : ''}`);
  }
  return output;
}
/** Verified against jspdf 2.5.2 dist/jspdf.es.js: binary streams use the addImage_images collection. */
function storedPdfBytes(pdf: jsPDF): number {
  const images = (pdf.internal as unknown as { collections: { addImage_images?: Record<string, { data: string; sMask?: string }> } }).collections.addImage_images ?? {};
  return Object.values(images).reduce((sum, image) => sum + image.data.length + (image.sMask?.length ?? 0), 0);
}
async function exportSnapshot(project: Project, pageIds: Id[], images: ImageResources, format: 'png' | 'pdf', signal: AbortSignal | undefined, settings: ExportSettings): Promise<Result<Blob>> {
  let copies: Map<string, ImageBitmap> | null = null;
  const release = retainResources(project, new Map(), images);
  try {
    check(signal); const snapshot = structuredClone(project), scale = settings.scale ?? 1;
    const available = exportAvailability(snapshot, pageIds, format, scale); if (!available.ok) return available;
    if (!pageIds.length) return fail(problem('export/empty', '没有可导出的页面'));
    const sizes = new Map<Id, RasterSize>();
    let maximumPt = 0;
    for (const id of pageIds) {
      const page = snapshot.pages[id]; if (!page) return fail(problem('export/page', '页面不存在'));
      const size = rasterSize(page.width, page.height, scale); if (!size.ok) return size;
      // PDF additionally holds an opaque encoding surface alongside its unchanged RGBA raster.
      const budgeted = { ...size.value, estimatedBytes: size.value.estimatedBytes + (format === 'pdf' ? size.value.width * size.value.height * 4 : 0) };
      if (budgeted.estimatedBytes > EXPORT_BUDGET.maxEstimatedBytes) return fail(problem('export/budget', 'PDF绘制与编码画布超出内存预算，请降低倍率或页面尺寸'));
      sizes.set(id, budgeted);
      maximumPt = Math.max(maximumPt, page.width / page.dpi * 72, page.height / page.dpi * 72);
    }
    const progress = (phase: ExportProgress['phase'], completed: number) => settings.onProgress?.({ phase, completed, total: pageIds.length });
    progress('prepare', 0);
    copies = await cloneImages(snapshot, pageIds, images, Math.max(...[...sizes.values()].map((size) => size.estimatedBytes)), signal);
    const fonts = await awaitFonts(snapshot, signal, pageIds); if (!fonts.ok) return fonts;
    const frozenFonts = fonts.value.map((font) => ({ ...font }));
    const actualFamilies = new Map(frozenFonts.map((font) => [font.requested, font.actual]));
    for (const font of frozenFonts) if (font.fallback) settings.onWarning?.(`导出字体“${font.requested}”使用替代“${font.actual}”`);
    for (const layer of Object.values(snapshot.layers)) {
      if (layer.type !== 'text' || layer.text.direction !== 'vertical' || !pageIds.includes(layer.pageId)) continue;
      const fallbacks = [...new Set(Array.from(layer.text.content))].filter((glyph) => VERTICAL_PUNCTUATION[glyph]).flatMap((original) => {
        const choice = resolveVerticalGlyph(original, actualFamilies.get(layer.text.font.family) ?? layer.text.font.family);
        return choice.fallback ? [{ original, reason: choice.fallback }] : [];
      });
      if (fallbacks.length) settings.onWarning?.(`导出文字“${layer.name}”：${verticalFallbackMessage(fallbacks)}`);
    }
    let pdf: jsPDF | null = null;
    // PDF coordinates are limited to 14400 units; UserUnit preserves the true physical page size.
    const userUnit = Math.max(1, Math.ceil(maximumPt / 14400));
    for (const [index, id] of pageIds.entries()) {
      check(signal); progress('render', index); await yieldFrame(); check(signal);
      const plan = compileScene(snapshot, id, frozenFonts,{target:{localToOutput:[scale,0,0,scale,0,0],tolerancePx:.25}});
      const blob = await raster(plan, copies, format === 'pdf', sizes.get(id)!, scale, signal);
      check(signal); progress('encode', index);
      if (format === 'png') { progress('encode', 1); check(signal); return ok(blob); }
      const page = snapshot.pages[id], widthPt = page.width / page.dpi * 72 / userUnit, heightPt = page.height / page.dpi * 72 / userUnit;
      const data = new Uint8Array(await blob.arrayBuffer()); check(signal);
      if (!pdf) {
        pdf = new jsPDF({ unit: 'pt', format: [widthPt, heightPt], orientation: widthPt > heightPt ? 'landscape' : 'portrait', compress: true, userUnit });
        if (userUnit > 1) (pdf as unknown as { __private__: { setPdfVersion(version: string): void } }).__private__.setPdfVersion('1.6');
      }
      else pdf.addPage([widthPt, heightPt], widthPt > heightPt ? 'landscape' : 'portrait');
      // FAST uses lossless PNG/Flate compression; it does not change raster pixels.
      pdf.addImage(data, 'PNG', 0, 0, widthPt, heightPt, `page-${index}`, 'FAST');
      if (storedPdfBytes(pdf) * 3 > EXPORT_BUDGET.pdfTotalBytes) return fail(problem('export/pdf-budget', 'PDF编码预计超过256MiB预算，请降低倍率或分批导出'));
      progress('encode', index + 1); await yieldFrame();
    }
    check(signal); if (!pdf) return fail(problem('export/empty', '没有可导出的页面'));
    const blob = pdf.output('blob'); check(signal);
    if (blob.size > EXPORT_BUDGET.pdfTotalBytes) return fail(problem('export/pdf-budget', 'PDF超过256MiB预算，请分批导出'));
    return ok(blob);
  } catch (error) { return errorResult(error); }
  finally { if (copies) for (const bitmap of copies.values()) bitmap.close(); release(); }
}
export function exportPng(project: Project, pageId: Id, images: ImageResources, signal?: AbortSignal, settings: ExportSettings = {}): Promise<Result<Blob>> { return exportSnapshot(project, [pageId], images, 'png', signal, settings); }
export function exportPdf(project: Project, images: ImageResources, signal?: AbortSignal, settings: ExportSettings = {}): Promise<Result<Blob>> { return exportSnapshot(project, [...project.pageOrder], images, 'pdf', signal, settings); }
export async function downloadPng(project: Project, pageId: Id, images: ImageResources, signal?: AbortSignal, settings: ExportSettings = {}): Promise<Result<void>> {
  const name = `${project.pages[pageId]?.name ?? 'Comia'}.png`, result = await exportPng(project, pageId, images, signal, settings); if (!result.ok) return result;
  if (signal?.aborted) return errorResult(new DOMException('导出已取消', 'AbortError'));
  triggerDownload(result.value, name); return ok(undefined);
}
export async function downloadPdf(project: Project, images: ImageResources, signal?: AbortSignal, settings: ExportSettings = {}): Promise<Result<void>> {
  const name = `${project.name}.pdf`, result = await exportPdf(project, images, signal, settings); if (!result.ok) return result;
  if (signal?.aborted) return errorResult(new DOMException('导出已取消', 'AbortError'));
  triggerDownload(result.value, name); return ok(undefined);
}
