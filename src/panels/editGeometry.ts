import { validatePanelGeometry, polygonContained } from '../geometry/simplePolygon';
import type { Id, Point, Project } from '../domain/types';
import { GEOMETRY_POLICY } from '../domain/limits';
import { constrainCandidate, containsConvex } from '../geometry/polygon';

export function isParallelogram(poly: Point[]): boolean {
  return poly.length === 4 && Math.hypot(poly[0].x + poly[2].x - poly[1].x - poly[3].x, poly[0].y + poly[2].y - poly[1].y - poly[3].y) <= 1e-6;
}
export function moveVertex(poly: Point[], index: number, point: Point, constrained: boolean): Point[] {
  const delta = { x: point.x - poly[index].x, y: point.y - poly[index].y };
  return poly.map((vertex, i) => {
    if (i === index) return point;
    if (constrained && isParallelogram(poly) && i !== (index + 2) % 4) return { x: vertex.x + delta.x / 2, y: vertex.y + delta.y / 2 };
    return { ...vertex };
  });
}
export function constrainPanelGeometry(project: Project, id: Id, candidate: Point[]): Point[] {
  const layer = project.layers[id]; if (layer.type !== 'panel') return [];
  const result = layer.geometryMode === 'simple' ? (validatePanelGeometry({ ...layer, geometry: candidate }).ok ? candidate : layer.geometry) : constrainCandidate(layer.geometry, candidate, GEOMETRY_POLICY);
  const parent = layer.parentId ? project.layers[layer.parentId] : null;
  if (parent?.type !== 'panel' || polygonContained(parent.geometry, result)) return result;
  if (parent.geometryMode === 'simple' || layer.geometryMode === 'simple') return layer.geometry;
  // Parent is convex, so intersections of all moving vertex halfplanes form a prefix interval in t.
  let low = 0, high = 1;
  const at = (t: number) => layer.geometry.map((point, index) => ({ x: point.x + (result[index].x - point.x) * t, y: point.y + (result[index].y - point.y) * t }));
  for (let i = 0; i < 32; i++) { const middle = (low + high) / 2; if (at(middle).every((point) => containsConvex(parent.geometry, point))) low = middle; else high = middle; }
  return at(low);
}
