import type { Point, Viewport } from '../domain/types';
export const clampZoom = (value: number): number => Math.max(.05, Math.min(8, value));
export function fitPage(page: { width: number; height: number }, size: Point): Viewport {
  const zoom = clampZoom(Math.min(Math.max(1, size.x - 64) / page.width, Math.max(1, size.y - 64) / page.height));
  return { zoom, pan: { x: (size.x - page.width * zoom) / 2, y: (size.y - page.height * zoom) / 2 } };
}
export function zoomAt(start: Viewport, screen: Point, factor: number): Viewport {
  if (!(factor > 0) || !Number.isFinite(factor)) return start;
  const anchor = { x: (screen.x - start.pan.x) / start.zoom, y: (screen.y - start.pan.y) / start.zoom }, zoom = clampZoom(start.zoom * factor);
  return { zoom, pan: { x: screen.x - anchor.x * zoom, y: screen.y - anchor.y * zoom } };
}
export function panBy(start: Viewport, delta: Point): Viewport { return { ...start, pan: { x: start.pan.x + delta.x, y: start.pan.y + delta.y } }; }
export function pinchViewport(start: Viewport, startMidpoint: Point, startDistance: number, midpoint: Point, distance: number): Viewport {
  if (startDistance < 4 || !Number.isFinite(distance)) return start;
  const zoomed = zoomAt(start, startMidpoint, Math.max(.00001, distance / startDistance));
  return panBy(zoomed, { x: midpoint.x - startMidpoint.x, y: midpoint.y - startMidpoint.y });
}
