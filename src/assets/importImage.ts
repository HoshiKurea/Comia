import { parseGIF, decompressFrame } from 'gifuct-js';
import type { AssetMeta, Id, ImageLayer, Point, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { LIMITS } from '../domain/limits';
import { newId } from '../domain/id';
import { createLayer } from '../domain/factories';
import { execute } from '../history/commandBus';
import { getProject } from '../state/documentStore';
import { runtimeStore } from '../state/runtimeStore';
import { sessionStore } from '../state/sessionStore';
import { translation } from '../geometry/matrix';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { detectImageFormat, inspectAvifAnimation, inspectWebpAnimation, preflightDimensions, type ImageKind } from './inspectFormat';
import { sanitizeSvg } from './sanitizeSvg';

export interface DecodedAsset {
  meta: AssetMeta;
  original: Blob;
  render: Blob;
  bitmap: ImageBitmap;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function hash(blob: Blob): Promise<string> { return hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())); }
async function firstGif(bytes: ArrayBuffer): Promise<Result<ImageBitmap>> {
  const gif = parseGIF(bytes);
  const frame = gif.frames.find((f): f is Extract<typeof f, { image: unknown }> => 'image' in f);
  if (!frame) return fail(problem('image/gif-empty', 'GIF没有图像帧'));
  const decoded = decompressFrame(frame, gif.gct, true);
  if (!decoded?.patch) return fail(problem('image/gif-decode', 'GIF首帧解码失败'));
  const width = gif.lsd.width, height = gif.lsd.height;
  if (width < 1 || height < 1 || width * height > LIMITS.maxAssetPixels) return fail(problem('image/too-many-pixels', 'GIF逻辑画布尺寸无效或超出上限'));
  if (decoded.dims.left < 0 || decoded.dims.top < 0 || decoded.dims.width < 1 || decoded.dims.height < 1 || decoded.dims.left + decoded.dims.width > width || decoded.dims.top + decoded.dims.height > height) return fail(problem('image/gif-frame-bounds', 'GIF首帧超出逻辑画布'));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const patchCanvas = document.createElement('canvas');
  try {
  const ctx = canvas.getContext('2d'); if (!ctx) return fail(problem('image/canvas', '无法创建图片画布'));
  const transparent = frame.gce?.extras?.transparentColorGiven === true;
  const background = gif.gct[gif.lsd.backgroundColorIndex];
  if (!transparent && background) { ctx.fillStyle = `rgb(${background[0]} ${background[1]} ${background[2]})`; ctx.fillRect(0, 0, width, height); }
  patchCanvas.width = decoded.dims.width; patchCanvas.height = decoded.dims.height;
  const patchContext = patchCanvas.getContext('2d'); if (!patchContext) return fail(problem('image/canvas', '无法创建GIF首帧画布'));
  const patch = new ImageData(new Uint8ClampedArray(decoded.patch), decoded.dims.width, decoded.dims.height);
  patchContext.putImageData(patch, 0, 0);
  ctx.drawImage(patchCanvas, decoded.dims.left, decoded.dims.top);
  return ok(await createImageBitmap(canvas));
  } finally { canvas.width = canvas.height = patchCanvas.width = patchCanvas.height = 0; }
}

async function rasterSvg(blob: Blob, signal: AbortSignal): Promise<Result<ImageBitmap>> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  let canvas: HTMLCanvasElement | null = null;
  try {
    image.src = url;
    await image.decode();
    if (signal.aborted) return fail(problem('image/cancelled', '图片导入已取消'));
    const width = image.naturalWidth, height = image.naturalHeight;
    if (width < 1 || height < 1 || width * height > LIMITS.maxAssetPixels) return fail(problem('image/svg-size', 'SVG栅格化尺寸超出上限'));
    canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); if (!ctx) return fail(problem('image/canvas', '无法创建SVG画布'));
    ctx.drawImage(image, 0, 0);
    return ok(await createImageBitmap(canvas));
  } catch { return fail(problem('image/svg-decode', '安全SVG无法栅格化，请先转PNG')); }
  finally { URL.revokeObjectURL(url); image.src = ''; if (canvas) canvas.width = canvas.height = 0; }
}

interface FrameDecoder {
  tracks?: { ready: Promise<void>; selectedTrack?: { frameCount?: number } };
  decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>;
  close(): void;
}
interface FrameDecoderConstructor {
  new (options: { data: Uint8Array<ArrayBuffer>; type: string }): FrameDecoder;
  isTypeSupported?(type: string): Promise<boolean>;
}

async function firstAnimatedFrame(bytes: ArrayBuffer, kind: ImageKind, status: 'animated' | 'unknown'): Promise<Result<{ bitmap: ImageBitmap; animated: boolean }>> {
  const Decoder = (globalThis as unknown as { ImageDecoder?: FrameDecoderConstructor }).ImageDecoder;
  if (!Decoder) return fail(problem('image/animation-unsupported', '此浏览器无法稳定读取动画首帧，请先转为静态PNG'));
  const types = kind === 'image/avif' ? status === 'unknown' ? ['image/avif', 'image/avif-sequence'] : ['image/avif-sequence', 'image/avif'] : [kind];
  let lastError: Error | null = null;
  for (const type of types) {
    if (Decoder.isTypeSupported && !(await Decoder.isTypeSupported(type))) continue;
    let decoder: FrameDecoder | null = null;
    try {
      decoder = new Decoder({ data: new Uint8Array(bytes), type });
      await decoder.tracks?.ready;
      const count = decoder.tracks?.selectedTrack?.frameCount;
      const frame = (await decoder.decode({ frameIndex: 0 })).image;
      try { return ok({ bitmap: await createImageBitmap(frame), animated: count === undefined ? true : count > 1 }); }
      finally { frame.close(); }
    } catch (error) { lastError = error as Error; }
    finally { decoder?.close(); }
  }
  return fail(problem('image/animation-unsupported', lastError ? `动画首帧无法解码：${lastError.message}；请先转为静态PNG` : '此浏览器不支持该动画格式的稳定首帧，请先转为静态PNG'));
}

export async function decodeImage(file: File, signal: AbortSignal): Promise<Result<DecodedAsset>> {
  let bitmap: ImageBitmap | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let transferred = false;
  try {
    if (file.size > LIMITS.maxAssetBytes) return fail(problem('image/too-large', '单张图片超过50MiB'));
    const buffer = await file.arrayBuffer();
    if (signal.aborted) return fail(problem('image/cancelled', '图片导入已取消'));
    const kind = detectImageFormat(new Uint8Array(buffer));
    if (!kind) return fail(problem('image/format', '不支持的图片格式'));
    const preflight = preflightDimensions(new Uint8Array(buffer), kind);
    if (!preflight.ok) return preflight;
    const animation = kind === 'image/webp' ? inspectWebpAnimation(new Uint8Array(buffer)) : kind === 'image/avif' ? inspectAvifAnimation(new Uint8Array(buffer)) : ok('still' as const);
    if (!animation.ok) return animation;
    let source: Blob = file;
    if (kind === 'image/svg+xml') {
      const safe = sanitizeSvg(buffer); if (!safe.ok) return safe;
      source = safe.value;
    }
    const needsFrameDecoder = (kind === 'image/webp' || kind === 'image/avif') && animation.value !== 'still';
    const frame = needsFrameDecoder ? await firstAnimatedFrame(buffer, kind, animation.value === 'animated' ? 'animated' : 'unknown') : null;
    const decoded = kind === 'image/gif' ? await firstGif(buffer) : kind === 'image/svg+xml' ? await rasterSvg(source, signal) : frame ? frame.ok ? ok(frame.value.bitmap) : frame : ok(await createImageBitmap(source, { imageOrientation: 'from-image' }));
    if (!decoded.ok) return decoded;
    bitmap = decoded.value;
    if (bitmap.width * bitmap.height > LIMITS.maxAssetPixels) return fail(problem('image/too-many-pixels', '图片像素数超出40MP'));
    canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d'); if (!ctx) return fail(problem('image/canvas', '无法创建图片画布'));
    ctx.drawImage(bitmap, 0, 0);
    const renderCanvas = canvas;
    const render = await new Promise<Blob | null>((resolve) => renderCanvas.toBlob(resolve, 'image/png'));
    if (!render || signal.aborted) return fail(problem('image/cancelled', '图片导入已取消或编码失败'));
    const original = new Blob([buffer], { type: kind });
    const meta: AssetMeta = { id: newId(), name: file.name, originalMime: kind, originalHash: await hash(original), renderHash: await hash(render), renderMime: 'image/png', width: bitmap.width, height: bitmap.height, originalBytes: original.size, renderBytes: render.size, framePolicy: kind === 'image/gif' || animation.value === 'animated' || (frame?.ok && frame.value.animated) ? 'first-frame' : 'still', normalizedOrientation: true };
    if (signal.aborted) return fail(problem('image/cancelled', '图片导入已取消'));
    transferred = true;
    return ok({ meta, original, render, bitmap });
  } catch (e) { return fail(problem('image/decode', `图片解码失败：${(e as Error).message}`)); }
  finally {
    if (canvas) canvas.width = canvas.height = 0;
    if (!transferred) bitmap?.close();
  }
}

export function placeImages(assets: DecodedAsset[], pageId: Id, point: Point, targetPanelId: Id | null): Result<Id[]> {
  const project = getProject();
  const page = project.pages[pageId];
  if (!page) return fail(problem('image/page-gone', '目标页面已删除，图片导入已取消'));
  if (!assets.length) return fail(problem('image/empty', '没有可导入的图片'));
  const panel = targetPanelId ? project.layers[targetPanelId] : null;
  if (targetPanelId && (!panel || panel.type !== 'panel' || panel.role !== 'leaf' || panel.pageId !== pageId || !effectiveLayerFlags(project, targetPanelId).visible || effectiveLayerFlags(project, targetPanelId).locked)) return fail(problem('image/target-gone', '目标分镜已删除、隐藏或锁定，图片导入已取消'));
  const parent = panel?.type === 'panel' ? panel : null;
  const layers: ImageLayer[] = [];
  const newAssets = new Map<Id, AssetMeta>();
  const existing = [...Object.values(project.assets)];
  for (const asset of assets) {
    const layer = createLayer('image', pageId) as ImageLayer;
    const same = [...existing, ...newAssets.values()].find((meta) => meta.originalHash === asset.meta.originalHash && meta.renderHash === asset.meta.renderHash);
    layer.assetId = same?.id ?? asset.meta.id;
    if (!same) newAssets.set(asset.meta.id, asset.meta);
    layer.width = asset.meta.width; layer.height = asset.meta.height;
    if (parent) { layer.parentId = parent.id; layer.crop = { focus: { u: 0.5, v: 0.5 }, zoom: 1 }; }
    else {
      const scale = Math.min(1, page.width / (asset.meta.width * 2), page.height / (asset.meta.height * 2));
      layer.matrix = translation(point.x - asset.meta.width * scale / 2, point.y - asset.meta.height * scale / 2);
      layer.matrix = [scale, 0, 0, scale, layer.matrix[4], layer.matrix[5]];
    }
    layers.push(layer);
  }
  const result = execute({ label: `导入${assets.length}张图片`, context: { pageId, selection: sessionStore.getState().selection }, afterSelection: layers.map((layer) => layer.id), mutate(draft) {
    for (const [id, meta] of newAssets) draft.assets[id] = meta;
    if (draft.schemaVersion < 3) draft.schemaVersion = 3; draft.libraryAssetIds = [...new Set([...(draft.libraryAssetIds ?? []), ...layers.map(layer => layer.assetId)])];
    if (draft.schemaVersion >= 8 && draft.assetLibrary) for (const layer of layers) if (!(layer.assetId in draft.assetLibrary.assetFolder)) draft.assetLibrary.assetFolder[layer.assetId] = null;
    for (const layer of layers) draft.layers[layer.id] = layer;
    if (parent) (draft.layers[parent.id] as typeof parent).children.push(...layers.map((layer) => layer.id));
    else draft.pages[pageId].roots.push(...layers.map((layer) => layer.id));
  } });
  if (!result.ok) return result;
  const runtime = runtimeStore.getState();
  for (const asset of assets) {
    if (!runtime.blobs.has(asset.meta.originalHash)) runtime.blobs.set(asset.meta.originalHash, asset.original);
    if (!runtime.blobs.has(asset.meta.renderHash)) runtime.blobs.set(asset.meta.renderHash, asset.render);
    if (runtime.images.has(asset.meta.renderHash)) asset.bitmap.close();
    else runtime.images.set(asset.meta.renderHash, asset.bitmap);
  }
  runtimeStore.setState({ blobs: new Map(runtime.blobs), images: new Map(runtime.images) });
  return ok(layers.map((layer) => layer.id));
}

export function placeImage(asset: DecodedAsset, pageId: Id, point: Point, targetPanelId: Id | null = null): Result<Id> {
  const result = placeImages([asset], pageId, point, targetPanelId);
  return result.ok ? ok(result.value[0]) : result;
}
