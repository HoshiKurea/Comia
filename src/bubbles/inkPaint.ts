import type { BubbleLayer, FreehandBubbleSource, InkStroke, Mat, Point, Rect } from '../domain/types';
import { rectCorners } from '../geometry/matrix';
import { polyBounds } from '../geometry/polygon';
import { unionBounds } from '../geometry/bounds';
import { paintInkStroke } from '../freehand/material';
import { strokeRadius } from '../freehand/geometry';

export const bubbleInk = (b: BubbleLayer): readonly InkStroke[] => b.freehandSource?.version === 2 ? b.freehandSource.ink : [];
/** Shape caches exclude colour details: drawing a line never recomputes the bubble outline. */
export const bubbleShapeSource = (s?: FreehandBubbleSource) => s ? { version: 1, width: s.width, height: s.height, baseRing: s.baseRing, edits: s.edits } : undefined;
export function bubbleInkBounds(b: BubbleLayer): Rect | null {
  const source = b.freehandSource; if (!source) return null;
  const sx = b.width / source.width, sy = b.height / source.height;
  return unionBounds(bubbleInk(b).filter(s => s.tool === 'pen' && s.opacity > 0 && parseInt(s.color.slice(7), 16) > 0).map(s => {
    const box = polyBounds(s.points), r = s.width / 2;
    return { x: (box.x - r) * sx, y: (box.y - r) * sy, width: (box.width + 2 * r) * sx, height: (box.height + 2 * r) * sy };
  }));
}
function strokeContains(s: InkStroke, p: Point): boolean {
  for (let i = 0; i < s.points.length; i++) {
    const a = s.points[Math.max(0, i - 1)], b = s.points[i], ra = strokeRadius(s, a.pressure), rb = strokeRadius(s, b.pressure), dx = b.x - a.x, dy = b.y - a.y, dr = rb - ra, px = p.x - a.x, py = p.y - a.y;
    const A = dx * dx + dy * dy - dr * dr, B = -2 * (px * dx + py * dy + ra * dr), C = px * px + py * py - ra * ra;
    const t = A > 0 ? Math.max(0, Math.min(1, -B / (2 * A))) : (A + B < 0 ? 1 : 0);
    if (A * t * t + B * t + C <= 1e-8) return true;
  }
  return false;
}
export function bubbleInkContains(b: BubbleLayer, local: Point): boolean {
  const source = b.freehandSource; if (!source) return false;
  const p = { x: local.x * source.width / b.width, y: local.y * source.height / b.height }; let alpha = 0;
  for (const s of bubbleInk(b)) if (strokeContains(s, p)) { if (s.tool === 'eraser') alpha *= 1 - s.opacity; else { const a = s.opacity * parseInt(s.color.slice(7), 16) / 255; alpha = a + alpha * (1 - a); } }
  return alpha > 0;
}
const ids = new WeakMap<object, number>(); let sequence = 0, bytes = 0;
const cache = new Map<string, HTMLCanvasElement>(); const LIMIT = 16 * 1024 * 1024;
export const bubbleInkCacheStats = () => ({ bytes, limit: LIMIT, entries: cache.size });
export function clearBubbleInkCache(): void { for (const c of cache.values()) c.width = c.height = 0; cache.clear(); bytes = 0; }
/** Device-aligned tiles replay author strokes at the actual output scale, including PNG/PDF. */
export function drawBubbleInk(ctx: CanvasRenderingContext2D, b: BubbleLayer): void {
  const source = b.freehandSource, bounds = bubbleInkBounds(b); if (!source || !bounds) return;
  let id = ids.get(source); if (!id) { id = ++sequence; ids.set(source, id); }
  const t = ctx.getTransform(), m: Mat = [t.a, t.b, t.c, t.d, t.e, t.f], output = polyBounds(rectCorners(bounds, m));
  const x0 = Math.max(0, Math.floor(output.x) - 1), y0 = Math.max(0, Math.floor(output.y) - 1), x1 = Math.min(ctx.canvas.width, Math.ceil(output.x + output.width) + 1), y1 = Math.min(ctx.canvas.height, Math.ceil(output.y + output.height) + 1);
  const scratch = document.createElement('canvas'), sx = b.width / source.width, sy = b.height / source.height;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  try {
    for (let y = y0; y < y1; y += 256) for (let x = x0; x < x1; x += 256) {
      const w = Math.min(256, x1 - x), h = Math.min(256, y1 - y), key = JSON.stringify([id, m, sx, sy, x, y, w, h]); let tile = cache.get(key);
      if (tile) { cache.delete(key); cache.set(key, tile); ctx.drawImage(tile, x, y); continue; }
      tile = document.createElement('canvas'); tile.width = scratch.width = w; tile.height = scratch.height = h;
      const target = tile.getContext('2d'), paint = scratch.getContext('2d'); if (!target || !paint) throw Error('无法创建气泡细节绘制缓冲');
      for (const s of bubbleInk(b)) {
        paint.setTransform(1, 0, 0, 1, 0, 0); paint.clearRect(0, 0, w, h);
        paint.setTransform(m[0] * sx, m[1] * sx, m[2] * sy, m[3] * sy, m[4] - x, m[5] - y);
        paintInkStroke(paint, { ...s, color: s.tool === 'eraser' ? '#000000FF' : s.color.slice(0, 7) + 'FF' });
        target.globalAlpha = s.opacity * (s.tool === 'eraser' ? 1 : parseInt(s.color.slice(7), 16) / 255);
        target.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over'; target.drawImage(scratch, 0, 0);
      }
      cache.set(key, tile); bytes += w * h * 4; ctx.drawImage(tile, x, y);
      while (bytes > LIMIT) { const [oldKey, old] = cache.entries().next().value!; bytes -= old.width * old.height * 4; cache.delete(oldKey); old.width = old.height = 0; }
    }
  } finally { scratch.width = scratch.height = 0; ctx.restore(); }
}
