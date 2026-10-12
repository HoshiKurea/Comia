import type { Mat, Point, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import type { ShapePath } from './types';
import { apply, IDENTITY } from './matrix';
import { distanceToSegment } from './simplePolygon';
import { MANGA } from '../domain/limits';

export interface GeometryTarget { localToOutput: Mat; tolerancePx: number }
export interface FlatSubpath { points: Point[]; closed: boolean }
export const LOCAL_TARGET: GeometryTarget = { localToOutput: IDENTITY, tolerancePx: .25 };
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export function maxSingularValue(m: Mat): number {
  const t = m[0] ** 2 + m[1] ** 2 + m[2] ** 2 + m[3] ** 2, det = m[0] * m[3] - m[1] * m[2];
  return Math.sqrt((t + Math.sqrt(Math.max(0, t * t - 4 * det * det))) / 2);
}
/** A strict render approximation. No chord fallback when precision/depth/budget fails. */
export function flattenForRender(path: ShapePath, target: GeometryTarget = LOCAL_TARGET, budget: number = MANGA.booleanEdgesPerMember): Result<FlatSubpath[]> {
  if (!Number.isInteger(budget) || budget < 1 || budget > MANGA.booleanEdgesPerGroup || !Number.isFinite(target.tolerancePx) || target.tolerancePx <= 0 || target.tolerancePx > .25 || target.localToOutput.length !== 6 || target.localToOutput.some(v => !Number.isFinite(v)) || maxSingularValue(target.localToOutput) <= 0) return fail(problem('geometry/target', '绘制精度、矩阵或边预算非法'));
  const paths: FlatSubpath[] = []; let current: Point | null = null, active: FlatSubpath | null = null, count = 0;
  const append = (p: Point) => {
    if (!active || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw Error('路径点或子路径非法');
    const prior = active.points.at(-1);
    if (prior && Math.hypot(prior.x - p.x, prior.y - p.y) < 1e-12) return;
    if (prior && ++count > budget) throw Error('曲线离散超出边预算，未降低绘制精度');
    active.points.push({ ...p });
  };
  const curve = (points: Point[], depth: number): void => {
    const transformed = points.map(p => apply(target.localToOutput, p));
    if (transformed.slice(1, -1).every(p => distanceToSegment(p, transformed[0], transformed.at(-1)!) <= target.tolerancePx)) { append(points.at(-1)!); return; }
    if (depth >= MANGA.booleanDepth) throw Error('曲线无法在递归预算内达到输出精度');
    const levels: Point[][] = [points];
    while (levels.at(-1)!.length > 1) { const last = levels.at(-1)!; levels.push(last.slice(1).map((p, i) => midpoint(last[i], p))); }
    curve(levels.map(row => row[0]), depth + 1); curve(levels.map(row => row.at(-1)!).reverse(), depth + 1);
  };
  try {
    for (const op of path.ops) {
      if (op.op === 'M') { active = { points: [], closed: false }; paths.push(active); current = op.p; append(op.p); }
      else if (op.op === 'Z') {
        if (!active || !current) throw Error('闭合缺少子路径');
        const first = active.points[0], last = active.points.at(-1)!;
        if (Math.hypot(first.x-last.x, first.y-last.y) < 1e-12 && active.points.length > 1) active.points.pop();
        else if (++count > budget) throw Error('闭合边超出绘制预算');
        active.closed = true; current = first;
      } else {
        if (!current || !active || active.closed) throw Error('路径指令顺序非法');
        if (op.op === 'L') append(op.p);
        else if (op.op === 'Q') curve([current, op.control, op.p], 0);
        else curve([current, op.c1, op.c2, op.p], 0);
        current = op.p;
      }
    }
  } catch (error) { return fail(problem('geometry/precision-budget', (error as Error).message)); }
  return ok(paths);
}
export function flattenForBoolean(path: ShapePath, target: GeometryTarget = LOCAL_TARGET, budget: number = MANGA.booleanEdgesPerMember): Result<Point[][]> {
  const flat = flattenForRender(path, target, budget); if (!flat.ok) return flat;
  if (flat.value.some(sub => !sub.closed || sub.points.length < 3)) return fail(problem('geometry/open-region', '布尔区域必须是至少三点的闭合子路径'));
  return ok(flat.value.map(sub => sub.points));
}
