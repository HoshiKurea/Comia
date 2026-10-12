import type { PanelLayer, Point, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { GEOMETRY_POLICY } from '../domain/limits';
import { metrics, polygonEpsilon, segmentsIntersect, validateConvex } from './polygon';

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function validateSimplePolygon(points: Point[]): Result<void> {
  if (points.length < 3 || points.length > 256 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return fail(problem('polygon/simple-points', '自由轮廓须为3～256个有限顶点'));
  const measure = metrics(points); if (!measure.ok) return measure;
  const eps = polygonEpsilon(points);
  if (Math.abs(measure.value.signedArea) < 4 || measure.value.bounds.width < 16 || measure.value.bounds.height < 16) return fail(problem('polygon/simple-small', '自由分格至少16×16px且面积不小于4px²'));
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (Math.hypot(a.x - b.x, a.y - b.y) < .1 - eps) return fail(problem('polygon/simple-edge', '轮廓边长不能小于0.1px'));
    const prev = points[(i + points.length - 1) % points.length];
    if (distanceToSegment(b, prev, a) <= eps || distanceToSegment(prev, a, b) <= eps) return fail(problem('polygon/simple-backtrack', '轮廓不能沿相邻边折返重叠'));
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (j + 1) % points.length === i) continue;
      if (segmentsIntersect(a, b, points[j], points[(j + 1) % points.length], eps)) return fail(problem('polygon/self-intersect', '轮廓存在自交或非相邻边接触，请修正顶点'));
    }
  }
  return ok(undefined);
}
export function containsSimplePolygon(poly: Point[], p: Point): boolean {
  const eps = polygonEpsilon(poly); let inside = false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (distanceToSegment(p, a, b) <= eps) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < a.x + (p.y - a.y) * (b.x - a.x) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}
/** Split child edges at every parent intersection and check every open interval. */
export function polygonContained(parent: Point[], child: Point[]): boolean {
  if (child.some(p => !containsSimplePolygon(parent, p))) return false;
  const eps = polygonEpsilon(parent);
  for (let i = 0; i < child.length; i++) {
    const a = child[i], b = child[(i + 1) % child.length], dx = b.x - a.x, dy = b.y - a.y;
    const ts = [0, 1];
    for (let j = 0; j < parent.length; j++) {
      const c = parent[j], d = parent[(j + 1) % parent.length], ex = d.x - c.x, ey = d.y - c.y;
      const cross = dx * ey - dy * ex;
      if (Math.abs(cross) <= eps * Math.max(1, Math.hypot(dx, dy), Math.hypot(ex, ey))) {
        const length = dx * dx + dy * dy;
        for (const p of [c, d]) if (distanceToSegment(p, a, b) <= eps && length) ts.push(((p.x - a.x) * dx + (p.y - a.y) * dy) / length);
      } else {
        const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / cross;
        const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / cross;
        if (t > 0 && t < 1 && u >= -eps && u <= 1 + eps) ts.push(t);
      }
    }
    ts.sort((x, y) => x - y);
    for (let k = 1; k < ts.length; k++) {
      const t = (ts[k - 1] + ts[k]) / 2;
      if (!containsSimplePolygon(parent, { x: a.x + dx * t, y: a.y + dy * t })) return false;
    }
  }
  return true;
}
export function validatePanelGeometry(panel: Pick<PanelLayer, 'geometry' | 'geometryMode'>): Result<void> {
  return panel.geometryMode === 'simple' ? validateSimplePolygon(panel.geometry) : validateConvex(panel.geometry, GEOMETRY_POLICY);
}
