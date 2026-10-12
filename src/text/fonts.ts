import type { Id, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { DEFAULT_FONT_FAMILY } from '../domain/factories';
import { bumpFontGeneration } from '../state/runtimeStore';
import type { FontResolution } from './types';
import { mappedVerticalText } from './verticalGlyphs';
import { fontStyle } from './fontStyle';

const pending = new Map<string, Promise<FontResolution>>();
const resolved = new Map<string, FontResolution>();
const enumeratedFamilies = new Set<string>();
export function registerLocalFontFamilies(families: string[]): void {
  for (const family of families) {
    enumeratedFamilies.add(family); const resolution = { requested: family, actual: family, fallback: false };
    resolved.set(family, resolution); pending.set(family, Promise.resolve(resolution));
  }
  if (families.length) bumpFontGeneration();
}
const GENERIC = new Set(['sans-serif', 'serif', 'monospace']);
export const FONT_TIMEOUT_MS = 10_000;

export function quoteFont(family: string): string { return `"${family.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\f]/g, ' ')}"`; }
export function actualFont(family: string): string { return resolved.get(family)?.actual ?? (GENERIC.has(family) ? family : DEFAULT_FONT_FAMILY); }
export function fontCss(family: string, size: number, bold = false, italic = false): string {
  return fontStyle(actualFont(family), size, bold, italic);
}

/** Synchronous font snapshot for an interactive run; all registry reads precede compilation/paint. */
export function snapshotSceneFonts(project: Project, pageId: Id, roots = project.pages[pageId]?.roots ?? []): FontResolution[] {
  const families = new Set<string>();
  const visit = (id: Id): void => {
    const layer = project.layers[id]; if (!layer?.visible) return;
    if (layer.type === 'text') {
      families.add(layer.text.font.family);
      if (layer.text.direction === 'vertical' && mappedVerticalText(layer.text.content)) families.add(DEFAULT_FONT_FAMILY);
    } else if (layer.type === 'pageBackground' && layer.watermark) families.add(DEFAULT_FONT_FAMILY);
    else if (layer.type === 'decoration' && layer.spec.kind === 'sfx') families.add(layer.spec.fontFamily);
    if ('children' in layer) for (const child of layer.children) visit(child);
  };
  for (const root of roots) visit(root);
  return [...families].map((requested) => { const actual = actualFont(requested); return { requested, actual, fallback: actual !== requested }; });
}

/** Browser check() alone returns true for nonexistent local families, so compare measured fallback stacks. */
export function localFontAvailable(family: string): boolean {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return false;
  const probe = '漫画汉字 ABC xyz 012345 !@#';
  return ['monospace', 'serif'].some((fallback) => {
    ctx.font = `72px ${fallback}`; const baseline = ctx.measureText(probe).width;
    ctx.font = `72px ${quoteFont(family)}, ${fallback}`;
    return Math.abs(ctx.measureText(probe).width - baseline) > 0.01;
  });
}

export function resolveFont(family: string): Promise<FontResolution> {
  const previous = pending.get(family); if (previous) return previous;
  const task = (async (): Promise<FontResolution> => {
    if (!document.fonts) throw new Error('当前浏览器无法验证字体加载');
    let actual = family;
    if (family === DEFAULT_FONT_FAMILY) {
      const faces = await Promise.all([400, 700].map((weight) => new FontFace(DEFAULT_FONT_FAMILY,
        `url("/fonts/NotoSansCJKsc-${weight === 400 ? 'Regular' : 'Bold'}.otf")`, { weight: String(weight), style: 'normal' }).load()));
      for (const face of faces) document.fonts.add(face);
    } else if (!GENERIC.has(family) && !enumeratedFamilies.has(family) && !localFontAvailable(family)) {
      actual = (await resolveFont(DEFAULT_FONT_FAMILY)).actual;
    }
    if (enumeratedFamilies.has(family)) actual = family;
    const value = { requested: family, actual, fallback: actual !== family };
    resolved.set(family, value); bumpFontGeneration();
    return value;
  })().catch((error) => { pending.delete(family); throw error; });
  pending.set(family, task);
  return task;
}

export function fontDeadline<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const abort = () => finish(() => reject(new DOMException('导出已取消', 'AbortError')));
    const finish = (fn: () => void) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); fn(); };
    timer = setTimeout(() => finish(() => reject(new Error('字体加载超过10秒，请检查本地字体资源后重试'))), FONT_TIMEOUT_MS);
    signal?.addEventListener('abort', abort, { once: true });
    promise.then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
    if (signal?.aborted) abort();
  });
}

export async function awaitFonts(project: Project, signal?: AbortSignal, pageIds = project.pageOrder): Promise<Result<FontResolution[]>> {
  const uses = new Map<string, { text: string; bold: boolean; italic: boolean; size: number }[]>();
  for (const layer of Object.values(project.layers)) {
    if (!pageIds.includes(layer.pageId)) continue;
    const usage = layer.type === 'text' ? { family: layer.text.font.family, text: layer.text.content, bold: layer.text.font.bold, italic: layer.text.font.italic, size: layer.text.font.size }
      : layer.type === 'decoration' && layer.spec.kind === 'sfx' ? { family: layer.spec.fontFamily, text: layer.spec.content, bold: true, italic: false, size: layer.spec.fontSize } : layer.type === 'pageBackground' && layer.watermark ? { family: DEFAULT_FONT_FAMILY, text: layer.watermark.content, bold: false, italic: false, size: layer.watermark.fontSize } : null;
    if (usage) { const list = uses.get(usage.family) ?? []; list.push(usage); uses.set(usage.family, list); }
    if (layer.type === 'text' && layer.text.direction === 'vertical') {
      const mapped = mappedVerticalText(layer.text.content);
      if (mapped) {
        const list = uses.get(DEFAULT_FONT_FAMILY) ?? [];
        list.push({ text: mapped, bold: layer.text.font.bold, italic: layer.text.font.italic, size: layer.text.font.size });
        uses.set(DEFAULT_FONT_FAMILY, list);
      }
    }
  }
  try {
    const result = await fontDeadline(Promise.all([...uses].map(async ([family, usages]) => {
      const resolution = { ...await resolveFont(family) };
      await Promise.all(usages.map((use) => document.fonts.load(fontStyle(resolution.actual, use.size, use.bold, use.italic), use.text || '国Aa')));
      return resolution;
    })).then(async (values) => { if (uses.size) await document.fonts.ready; return values; }), signal);
    return ok(result);
  } catch (error) { return fail(problem(error instanceof DOMException && error.name === 'AbortError' ? 'export/cancelled' : 'font/load', error instanceof Error ? error.message : '字体加载失败')); }
}
