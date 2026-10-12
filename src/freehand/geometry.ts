import clipping from 'polygon-clipping';
import type { FreehandBubbleSource, InkStroke, Point, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { segmentsIntersect } from '../geometry/polygon';
import { checkedUnion, regionEdges, regionToPath, transformRegion } from '../geometry/renderRegion';
import { polygonRegion, type Region } from '../geometry/pathRegion';
import { maxSingularValue, LOCAL_TARGET, type GeometryTarget } from '../geometry/flattenForBoolean';
import { DRAWING_LIMITS } from './model';
import type { ShapePath } from '../geometry/types';

export function captureBubbleRing(raw: readonly Point[]): Result<Point[]> {
  const ring = raw.filter((p, i) => !i || Math.hypot(p.x - raw[i - 1].x, p.y - raw[i - 1].y) > 1e-6).map(p => ({ x: p.x, y: p.y }));
  if (ring.length > 1 && Math.hypot(ring[0].x - ring.at(-1)!.x, ring[0].y - ring.at(-1)!.y) < 1e-6) ring.pop();
  if (ring.length < 3 || ring.length > DRAWING_LIMITS.strokePoints || ring.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return fail(problem('drawing/ring', '轮廓需要3～8192个有限点'));
  const area = ring.reduce((n, p, i) => { const q = ring[(i + 1) % ring.length]; return n + p.x * q.y - q.x * p.y; }, 0) / 2;
  if (Math.abs(area) < 4) return fail(problem('drawing/area', '轮廓面积太小，请重新绘制'));
  const edges = ring.map((a, i) => { const b = ring[(i + 1) % ring.length]; return { a, b, i, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) }; }).sort((a, b) => a.lo - b.lo);
  let active: typeof edges = [];
  for (const edge of edges) {
    active = active.filter(e => e.hi >= edge.lo);
    for (const e of active) if (Math.abs(e.i - edge.i) !== 1 && Math.abs(e.i - edge.i) !== ring.length - 1 && segmentsIntersect(e.a, e.b, edge.a, edge.b, 1e-9)) return fail(problem('drawing/crossing', '轮廓发生交叉，请撤销这一笔后重画'));
    active.push(edge);
  }
  return ok(area < 0 ? ring.reverse() : ring);
}
export function strokeRadius(stroke: InkStroke, pressure: number): number { return stroke.width / 2 * (stroke.pressureMode === 'fixed' ? 1 : .2 + .8 * pressure); }
function hull(points: Point[]): Point[] {
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y), lower: Point[] = [], upper: Point[] = [];
  const turn = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (const p of sorted) { while (lower.length > 1 && turn(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop(); lower.push(p); }
  for (const p of sorted.reverse()) { while (upper.length > 1 && turn(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
/** Convex hull of adjacent disks is the exact sweep of linearly varying radius. */
export function strokeRegion(stroke: InkStroke, target: GeometryTarget = LOCAL_TARGET): Result<Region> {
  const scale = maxSingularValue(target.localToOutput), epsilon = target.tolerancePx / (4 * scale);
  if (!Number.isFinite(epsilon) || epsilon <= 0) return fail(problem('drawing/target', '笔迹输出精度非法'));
  const disk = (p: Point, radius: number): Point[] => {
    const count = Math.max(8, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - epsilon / radius))));
    if (!Number.isFinite(count) || count > 8192) throw Error('笔刷圆弧超过输出精度预算');
    return Array.from({ length: count }, (_, i) => ({ x: p.x + radius * Math.cos(i * 2 * Math.PI / count), y: p.y + radius * Math.sin(i * 2 * Math.PI / count) }));
  };
  try {
    let prior: Point[] | null = null, batch: Region[] = [], result: Region = [];
    for (const p of stroke.points) {
      const current = disk(p, strokeRadius(stroke, p.pressure)); batch.push(polygonRegion(prior ? hull([...prior, ...current]) : current)); prior = current;
      if (batch.length === 32) { const merged = checkedUnion([result, ...batch]); if (!merged.ok) return merged; result = merged.value; batch = []; }
    }
    return checkedUnion([result, ...batch]);
  } catch (e) { return fail(problem('drawing/sweep', (e as Error).message)); }
}
export function applyBubbleShapeEdit(region: Region, stroke: InkStroke, mode: 'add' | 'subtract', target: GeometryTarget = LOCAL_TARGET): Result<Region> {
  const sweep = strokeRegion(stroke, target); if (!sweep.ok) return sweep;
  if (mode === 'add') return checkedUnion([region, sweep.value]);
  try { const next = clipping.difference(region, sweep.value); return regionEdges(next) <= 8192 ? ok(next) : fail(problem('drawing/budget', '修形超过轮廓预算，未降低精度')); }
  catch (e) { return fail(problem('drawing/boolean', (e as Error).message)); }
}
export function freehandRegion(source: FreehandBubbleSource, target: GeometryTarget = LOCAL_TARGET): Result<Region> {
  const ring = captureBubbleRing(source.baseRing); if (!ring.ok) return ring;
  let region = polygonRegion(ring.value);
  for (const edit of source.edits) { const next = applyBubbleShapeEdit(region, edit.stroke, edit.mode, target); if (!next.ok) return next; region = next.value; }
  return ok(region);
}
export function validBubbleRegion(region: Region): Result<void> {
  return region.length === 1 && region[0].length === 1 ? ok(undefined) : fail(problem('drawing/topology', '气泡需为一块无孔闭合区域；请补画修复，或撤销擦除'));
}
export function freehandBody(source: FreehandBubbleSource, width: number, height: number, target: GeometryTarget = LOCAL_TARGET): Result<ShapePath> {
  const sx = width / source.width, sy = height / source.height;
  const [a,b,c,d,e,f] = target.localToOutput;
  const result = freehandRegion(source, { ...target, localToOutput: [a*sx,b*sx,c*sy,d*sy,e,f] }); if (!result.ok) return result;
  const valid = validBubbleRegion(result.value); if (!valid.ok) return valid;
  return ok(regionToPath(transformRegion(result.value, [sx,0,0,sy,0,0])));
}
