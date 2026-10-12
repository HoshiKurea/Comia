import type { Point, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { distanceToSegment, validateSimplePolygon } from '../geometry/simplePolygon';
import { metrics } from '../geometry/polygon';
export interface FreehandOptions { mode: 'contour' | 'smooth' | 'straighten'; toleranceScreenPx: number; closeDistanceScreenPx: number }
function simplify(chain: Point[], tolerance: number): Point[] {
  if (chain.length <= 2) return chain;
  const keep = new Set([0, chain.length - 1]), stack = [[0, chain.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!; let index = start, maximum = 0;
    for (let i = start + 1; i < end; i++) { const d = distanceToSegment(chain[i], chain[start], chain[end]); if (d > maximum) { maximum = d; index = i; } }
    if (maximum > tolerance) { keep.add(index); stack.push([start, index], [index, end]); }
  }
  return chain.filter((_, i) => keep.has(i));
}
export function correctContour(raw: Point[], options: FreehandOptions, zoom: number): Result<Point[]> {
  if (!Number.isFinite(zoom) || zoom <= 0 || !Number.isFinite(options.closeDistanceScreenPx) || options.closeDistanceScreenPx < 0 || !['contour', 'smooth', 'straighten'].includes(options.mode) || !Number.isFinite(options.toleranceScreenPx) || options.toleranceScreenPx < .5 || options.toleranceScreenPx > 8 || raw.length > 4096 || raw.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return fail(problem('panel/correction-input', '修正强度须为0.5～8屏幕像素，采样最多4096点'));
  const input = raw.filter((p, i) => !i || Math.hypot(p.x - raw[i - 1].x, p.y - raw[i - 1].y) > 1e-8);
  if (input.length > 3 && Math.hypot(input[0].x - input.at(-1)!.x, input[0].y - input.at(-1)!.y) * zoom <= options.closeDistanceScreenPx) input.pop();
  if (input.length < 3) return fail(problem('panel/correction-empty', '请绘制至少三个不同的点'));
  // A farthest-from-start anchor avoids treating a closed contour as a zero-length chain.
  let anchor = 1; for (let i = 2; i < input.length; i++) if (Math.hypot(input[i].x - input[0].x, input[i].y - input[0].y) > Math.hypot(input[anchor].x - input[0].x, input[anchor].y - input[0].y)) anchor = i;
  const tolerance = options.toleranceScreenPx / zoom * (options.mode === 'straighten' ? 2 : 1);
  let points = [...simplify(input.slice(0, anchor + 1), tolerance).slice(0, -1), ...simplify([...input.slice(anchor), input[0]], tolerance).slice(0, -1)];
  if (options.mode === 'smooth') for (let round = 0; round < 2; round++) {
    const candidate: Point[] = [];
    for (let i = 0; i < points.length; i++) {
      const prev = points[(i + points.length - 1) % points.length], p = points[i], next = points[(i + 1) % points.length];
      const ax = p.x - prev.x, ay = p.y - prev.y, bx = next.x - p.x, by = next.y - p.y;
      const turn = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by))))) * 180 / Math.PI;
      if (turn >= 35) candidate.push(p);
      else candidate.push({ x: .75 * p.x + .25 * prev.x, y: .75 * p.y + .25 * prev.y }, { x: .75 * p.x + .25 * next.x, y: .75 * p.y + .25 * next.y });
    }
    if (!validateSimplePolygon(candidate).ok) break; points = candidate;
  }
  if (options.mode === 'straighten') for (let i = 0; i < points.length; i++) {
    const p = points[i], next = points[(i + 1) % points.length], angle = Math.atan2(next.y - p.y, next.x - p.x), snap = Math.round(angle / (Math.PI / 4)) * Math.PI / 4;
    if (Math.abs(angle - snap) > 7.5 * Math.PI / 180) continue;
    const length = Math.hypot(next.x - p.x, next.y - p.y), candidate = points.map((v, j) => j === (i + 1) % points.length ? { x: p.x + length * Math.cos(snap), y: p.y + length * Math.sin(snap) } : v);
    if (validateSimplePolygon(candidate).ok) points = candidate;
  }
  const valid = validateSimplePolygon(points); if (!valid.ok) return points.length > 256 ? fail(problem('panel/correction-budget', '顶点超过256，请提高修正强度')) : valid;
  const measure = metrics(points); if (measure.ok && measure.value.signedArea < 0) points.reverse();
  return ok(points);
}
