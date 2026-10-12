import clipping, { type MultiPolygon } from 'polygon-clipping';
import type { Point, Mat } from '../domain/types';
import type { ShapePath } from './types';
import { apply } from './matrix';
import { distanceToSegment } from './simplePolygon';

export type Region = MultiPolygon;
const diagnosticCounts = { 'center-approximation-budget': 0 };
const diagnosed = new WeakSet<ShapePath>();
export function pathRegionDiagnostics(): Readonly<typeof diagnosticCounts> { return { ...diagnosticCounts }; }
/** Approximation for editor labels/areas only. Each remaining original segment
 * reserves one endpoint; a budget fallback closes the whole path with chords. */
export function pathPolygon(path: ShapePath, matrix: Mat): Region {
  const points: Point[] = []; let cursor: Point = { x: 0, y: 0 }, budget = 8191, limited = false; // Reserve the closing chord.
  let remaining = path.ops.filter(op => op.op !== 'M' && op.op !== 'Z').length;
  const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  function curve(p: Point[], depth: number, capacity: number): Point[] {
    const a = p[0], b = p[p.length - 1], flat = p.slice(1, -1).every(c => distanceToSegment(c, a, b) <= .25);
    if (flat || depth >= 16 || capacity <= 1) { if (!flat) limited = true; return [b]; }
    const levels: Point[][] = [p]; while (levels.at(-1)!.length > 1) { const prev = levels.at(-1)!; levels.push(prev.slice(1).map((v, i) => midpoint(prev[i], v))); }
    const left = curve(levels.map(l => l[0]), depth + 1, capacity - 1);
    return [...left, ...curve(levels.map(l => l.at(-1)!).reverse(), depth + 1, capacity - left.length)];
  }
  for (const op of path.ops) {
    if (op.op === 'M') { cursor = apply(matrix, op.p); points.push(cursor); }
    else if (op.op !== 'Z') {
      remaining--; const end = apply(matrix, op.p), controls = op.op === 'Q' ? [apply(matrix, op.control)] : op.op === 'C' ? [apply(matrix, op.c1), apply(matrix, op.c2)] : [];
      const segment = controls.length ? curve([cursor, ...controls, end], 0, budget - remaining) : [end];
      points.push(...segment); budget -= segment.length; cursor = end;
    }
  }
  if (limited && !diagnosed.has(path)) { diagnosed.add(path); diagnosticCounts['center-approximation-budget']++; }
  return polygonRegion(points);
}
export function polygonRegion(points: readonly Point[]): Region {
  if (points.length < 3) return [];
  const ring = points.map(({ x, y }) => [x, y] as [number, number]);
  if (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) ring.push([...ring[0]]);
  return [[ring]];
}
export function intersectRegions(...regions: Region[]): Region { return regions.length ? clipping.intersection(regions[0], ...regions.slice(1)) : []; }
export function regionArea(region: Region): number {
  return region.reduce((total, poly) => total + poly.reduce((sum, ring, i) => {
    let cross = 0; for (let j = 0; j + 1 < ring.length; j++) cross += ring[j][0] * ring[j + 1][1] - ring[j + 1][0] * ring[j][1];
    return sum + (i ? -1 : 1) * Math.abs(cross / 2);
  }, 0), 0);
}
export function regionContains(region: Region, point: Point): boolean {
  const contains = (ring: number[][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax=ring[i][0],ay=ring[i][1],bx=ring[j][0],by=ring[j][1],dx=bx-ax,dy=by-ay,length=dx*dx+dy*dy;
      const t=length?Math.max(0,Math.min(1,((point.x-ax)*dx+(point.y-ay)*dy)/length)):0;
      const ex=point.x-ax-t*dx,ey=point.y-ay-t*dy;if(ex*ex+ey*ey<1e-16)return true;
      if ((ay > point.y) !== (by > point.y) && point.x < dx * (point.y - ay) / dy + ax) inside = !inside;
    } return inside;
  };
  return region.some(poly => contains(poly[0]) && poly.slice(1).every(ring => !contains(ring)));
}
/** An actual ellipse is sampled for area, rather than flattening a four-Bezier approximation. */
export function ellipseRegion(cx: number, cy: number, rx: number, ry: number, matrix: Mat): Region {
  const radius = Math.max(rx, ry) * Math.hypot(matrix[0], matrix[1], matrix[2], matrix[3]);
  const step = radius > .25 ? Math.acos(Math.max(-1, 1 - .25 / radius)) : Math.PI / 8;
  const count = Math.min(8192, Math.max(16, Math.ceil(Math.PI / Math.max(step, 1e-8))));
  return polygonRegion(Array.from({ length: count }, (_, i) => apply(matrix, { x: cx + rx * Math.cos(i * 2 * Math.PI / count), y: cy + ry * Math.sin(i * 2 * Math.PI / count) })));
}
