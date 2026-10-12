import type { Id, Project, Rect, Viewport } from '../domain/types';
import { drawPage, type ImageResources } from './drawScene';
import { runScreenBounds } from './screenBounds';
import { affectedMangaIds } from '../bubbles/affectedMangaIds';

type StaticRun = { kind: 'static'; roots: Id[]; canvas: HTMLCanvasElement | null; bounds: Rect | null };
type DynamicRun = { kind: 'dynamic'; roots: Id[] };
export type GestureRuns = { base: Project; pageId: Id; viewport: Viewport; width: number; height: number; runs: (StaticRun | DynamicRun)[] };
const MAX_CACHE_BYTES = 64 * 1024 * 1024;

function topRoot(project: Project, id: Id): Id | null {
  let layer = project.layers[id];
  if (!layer) return null;
  while (layer.parentId) {
    layer = project.layers[layer.parentId];
    if (!layer) return null;
  }
  return layer.id;
}

/** Eight-bit intermediate alpha/clip surfaces can round again when composited
 * over a moving sibling. Replay these runs from their immutable source so the
 * normal and preview paths apply each blend/clip in precisely the same order. */
function needsReplay(project: Project, id: Id, clips = 0): boolean {
  const layer = project.layers[id];
  if (!layer || !layer.visible) return false;
  if (layer.type === 'pageBackground') return true;
  const partial = (color: string) => !['00', 'FF'].includes(color.slice(-2).toUpperCase());
  if (layer.type === 'image') return true; // Asset metadata does not promise opaque pixels.
  if(layer.type==='group'&&layer.dialogue)return true;
  if(layer.type==='bubbleTail')return true;
  if(layer.type==='text'&&layer.role==='sfx'&&layer.effects&&partial(layer.effects.outlineColor))return true;
  if (layer.type === 'panel') {
    if (clips > 0 || partial(layer.style.fill) || (layer.style.borderWidth > 0 && partial(layer.style.borderColor))) return true;
    return layer.children.some((child) => needsReplay(project, child, clips + 1));
  }
  if (layer.type === 'bubble' && (partial(layer.style.fill) || (layer.style.borderWidth > 0 && partial(layer.style.borderColor)))) return true;
  if (layer.type === 'text' && partial(layer.text.font.color)) return true;
  if (layer.type === 'decoration' && partial(layer.spec.color)) return true;
  return 'children' in layer && layer.children.some((child) => needsReplay(project, child, clips));
}

function drawSubset(ctx: CanvasRenderingContext2D, source: Project, pageId: Id, images: ImageResources, roots: Id[], viewport: Viewport, paintBackground: boolean, opacity?: ReadonlyMap<Id, number>, cropGhostId?: Id): void {
  ctx.save();
  ctx.translate(viewport.pan.x, viewport.pan.y);
  ctx.scale(viewport.zoom, viewport.zoom);
  drawPage(ctx, source, pageId, images, roots, paintBackground, opacity, cropGhostId);
  ctx.restore();
}

/** 从底到顶切出连续静态run；受影响根的整棵树留在动态路径，保持内部clip与遮挡。 */
export function beginGestureRuns(base: Project, pageId: Id, affectedIds: Id[], viewport: Viewport, size: { width: number; height: number }, images: ImageResources): GestureRuns {
  const page = base.pages[pageId];
  const dynamic = new Set(affectedMangaIds(base,affectedIds).map((id) => topRoot(base, id)).filter((id): id is Id => id !== null));
  const runs: (StaticRun | DynamicRun)[] = [];
  if (page) for (const root of page.roots) {
    const kind = dynamic.has(root) ? 'dynamic' : 'static';
    const last = runs[runs.length - 1];
    if (last?.kind === kind) last.roots.push(root);
    else if (kind === 'dynamic') runs.push({ kind, roots: [root] });
    else runs.push({ kind, roots: [root], canvas: null, bounds: null });
  }
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  // Rasterize in the same viewport/device coordinate system as the normal
  // layer, then copy the tight integer-device-pixel rectangle. Translating a
  // curve before rasterizing can change Firefox's antialiasing by one RGB
  // level even when coverage matches. The temporary viewport surface counts
  // against the same 64MiB budget and is released before the first move frame.
  const viewportWidth = Math.ceil(size.width * dpr), viewportHeight = Math.ceil(size.height * dpr);
  const viewportBytes = viewportWidth * viewportHeight * 4;
  let scratch: HTMLCanvasElement | null = null;
  let used = 0;
  try {
    for (const run of runs) {
      if (run.kind !== 'static') continue;
      const bounds = runScreenBounds(base, run.roots, viewport, size);
      run.bounds = bounds;
      if (!bounds) continue;
      if (run.roots.some((root) => needsReplay(base, root))) continue;
      const x = Math.floor(bounds.x * dpr), y = Math.floor(bounds.y * dpr);
      const width = Math.ceil((bounds.x + bounds.width) * dpr) - x, height = Math.ceil((bounds.y + bounds.height) * dpr) - y;
      run.bounds = { x: x / dpr, y: y / dpr, width: width / dpr, height: height / dpr };
      const bytes = width * height * 4;
      if (used + bytes + viewportBytes > MAX_CACHE_BYTES) continue;
      if (!scratch) { scratch = document.createElement('canvas'); scratch.width = viewportWidth; scratch.height = viewportHeight; }
      const scratchCtx = scratch.getContext('2d'); if (!scratchCtx) continue;
      scratchCtx.setTransform(1, 0, 0, 1, 0, 0); scratchCtx.clearRect(0, 0, viewportWidth, viewportHeight);
      scratchCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawSubset(scratchCtx, base, pageId, images, run.roots, viewport, false);
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { canvas.width = 0; canvas.height = 0; continue; }
      run.canvas = canvas;
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(scratch, x, y, width, height, 0, 0, width, height);
      used += bytes;
    }
  } catch (error) {
    for (const run of runs) if (run.kind === 'static' && run.canvas) { run.canvas.width = run.canvas.height = 0; run.canvas = null; }
    throw error;
  } finally { if (scratch) scratch.width = scratch.height = 0; }
  return { base, pageId, viewport, width: size.width, height: size.height, runs };
}

export function drawGestureRuns(ctx: CanvasRenderingContext2D, cache: GestureRuns, draft: Project, images: ImageResources, opacity?: ReadonlyMap<Id, number>, cropGhostId?: Id): void {
  drawSubset(ctx, cache.base, cache.pageId, images, [], cache.viewport, true);
  for (const run of cache.runs) {
    if (run.kind === 'dynamic') drawSubset(ctx, draft, cache.pageId, images, run.roots, cache.viewport, false, opacity, cropGhostId);
    else if (run.canvas && run.bounds) ctx.drawImage(run.canvas, run.bounds.x, run.bounds.y, run.bounds.width, run.bounds.height);
    else if (run.bounds) drawSubset(ctx, cache.base, cache.pageId, images, run.roots, cache.viewport, false);
  }
}

export function disposeGestureRuns(cache: GestureRuns | null): void {
  if (!cache) return;
  for (const run of cache.runs) if (run.kind === 'static' && run.canvas) { run.canvas.width = 0; run.canvas.height = 0; run.canvas = null; }
}
