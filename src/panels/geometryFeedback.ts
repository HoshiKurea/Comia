import type { Point } from '../domain/types';

export function vertexAngle(points: readonly Point[], index: number): number {
  const p = points[index], a = points[(index + points.length - 1) % points.length], b = points[(index + 1) % points.length];
  const ux = a.x - p.x, uy = a.y - p.y, vx = b.x - p.x, vy = b.y - p.y;
  return Math.atan2(Math.abs(ux * vy - uy * vx), ux * vx + uy * vy) * 180 / Math.PI;
}
/** Outward normal matches the edge push calculation; report the accepted geometry after clamping. */
export function edgeDisplacement(original: readonly Point[], current: readonly Point[], index: number): number {
  const a = original[index], b = original[(index + 1) % original.length], q = current[index];
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return length ? ((q.x - a.x) * (b.y - a.y) + (q.y - a.y) * (a.x - b.x)) / length : 0;
}
