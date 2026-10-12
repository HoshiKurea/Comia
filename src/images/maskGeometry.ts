import type { ImageLayer, ImageMask, Point, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { inverse, multiply } from '../geometry/matrix';
import { polyBounds, segmentsIntersect, polygonEpsilon } from '../geometry/polygon';
import { containsSimplePolygon, distanceToSegment } from '../geometry/simplePolygon';

export function defaultMask(image: ImageLayer, shape: ImageMask['shape'] = 'rect'): ImageMask {
  const x = image.width * .1, y = image.height * .1, w = image.width * .8, h = image.height * .8;
  return { enabled: true, linked: true, shape, matrix: [1, 0, 0, 1, 0, 0], geometry: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] };
}
export function validateMaskGeometry(mask: ImageMask): Result<void> {
  if (!['rect', 'ellipse', 'polygon'].includes(mask.shape) || typeof mask.enabled !== 'boolean' || typeof mask.linked !== 'boolean' || !Array.isArray(mask.geometry)) return fail(problem('mask/format', '遮罩形状或开关无效'));
  const p = mask.geometry;
  if (p.length < 3 || p.length > 256 || p.some(v => !Number.isFinite(v.x) || !Number.isFinite(v.y) || Math.abs(v.x) > 1e7 || Math.abs(v.y) > 1e7)) return fail(problem('mask/points', '遮罩须为3～256个有限顶点'));
  const b = polyBounds(p), eps = polygonEpsilon(p);
  if (b.width < .001 || b.height < .001) return fail(problem('mask/size', '遮罩宽高至少0.001px'));
  if (mask.shape !== 'polygon') {
    const expected = [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }];
    if (p.length !== 4 || expected.some((v, i) => Math.hypot(v.x - p[i].x, v.y - p[i].y) > eps)) return fail(problem('mask/rectangle', '矩形和椭圆须使用规范矩形边界'));
    return ok(undefined);
  }
  let area = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], next = p[(i + 1) % p.length], prev = p[(i + p.length - 1) % p.length];
    area += a.x * next.y - next.x * a.y;
    if (Math.hypot(a.x - next.x, a.y - next.y) < .001 || distanceToSegment(next, prev, a) <= eps || distanceToSegment(prev, a, next) <= eps) return fail(problem('mask/edge', '遮罩顶点不能重合或沿相邻边折返'));
    for (let j = i + 1; j < p.length; j++) if (j !== i + 1 && (j + 1) % p.length !== i && segmentsIntersect(a, next, p[j], p[(j + 1) % p.length], eps)) return fail(problem('mask/intersection', '遮罩不能自交，请修正顶点'));
  }
  return Math.abs(area) >= 2e-6 ? ok(undefined) : fail(problem('mask/area', '遮罩面积过小'));
}
export function maskContains(mask: ImageMask, local: Point): boolean {
  if (!mask.enabled) return true;
  const inv = inverse(mask.matrix); if (!inv.ok) return false;
  const m = inv.value, p = { x: m[0] * local.x + m[2] * local.y + m[4], y: m[1] * local.x + m[3] * local.y + m[5] };
  if (mask.shape === 'polygon') return containsSimplePolygon(mask.geometry, p);
  const b = polyBounds(mask.geometry);
  if (mask.shape === 'rect') return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
  return ((p.x - b.x - b.width / 2) / (b.width / 2)) ** 2 + ((p.y - b.y - b.height / 2) / (b.height / 2)) ** 2 <= 1;
}
export function traceImageMask(ctx: CanvasRenderingContext2D, mask: ImageMask, begin = true): void {
  if (begin) ctx.beginPath();
  ctx.save(); ctx.transform(...mask.matrix);
  if (mask.shape === 'ellipse') { const b = polyBounds(mask.geometry); ctx.ellipse(b.x + b.width / 2, b.y + b.height / 2, b.width / 2, b.height / 2, 0, 0, Math.PI * 2); }
  else { mask.geometry.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); }
  ctx.restore();
}
/** Unlinked mask stays in the SAME parent coordinates. Reparenting carries both by design. */
export function preserveUnlinkedMasks(before: Project, after: Project): void {
  for (const [id, value] of Object.entries(after.layers)) {
    const old = before.layers[id];
    if (value.type !== 'image' || old?.type !== 'image' || !old.mask || old.mask.linked || !value.mask || value.mask.linked || value.parentId !== old.parentId || old.crop || value.crop) continue;
    if (value.matrix.every((n, i) => n === old.matrix[i]) || JSON.stringify(value.mask) !== JSON.stringify(old.mask)) continue;
    const inv = inverse(value.matrix); if (!inv.ok) continue;
    after.layers[id] = { ...value, mask: { ...value.mask, matrix: multiply(inv.value, multiply(old.matrix, old.mask.matrix)) } };
  }
}
