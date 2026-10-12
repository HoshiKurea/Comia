import type { Id, Point, Project, Rect, Viewport } from '../domain/types';
import { apply, pageToScreen, worldMatrix } from '../geometry/matrix';
import { isBreakout } from './paintOps';

/** Conservative damage for a contour-only draft. All paint within it is replayed
 * from paper upward, including unchanged siblings and every ancestor clip.
 * null means no damage; undefined requires a complete repaint. */
export function contourDamage(before: Project, after: Project, id: Id, viewport: Viewport, size: { width: number; height: number }, dpr: number): Rect | null | undefined {
  const a = before.layers[id], b = after.layers[id];
  if (a?.type !== 'panel' || b?.type !== 'panel' || a.matrix.some((v, i) => v !== b.matrix[i]) || JSON.stringify(a.style) !== JSON.stringify(b.style)) return undefined;
  const hasBreakout = (source: Project, parent: Id): boolean => { const layer = source.layers[parent]; return layer?.type === 'image' ? isBreakout(layer) : !!layer && 'children' in layer && layer.children.some(child => hasBreakout(source, child)); };
  if (hasBreakout(before, id) || hasBreakout(after, id)) return undefined;
  const world = worldMatrix(after, id), screen = (p: Point) => pageToScreen(apply(world, p), viewport);
  let points: Point[];
  if (!a.style.borderRadius && !b.style.borderRadius && a.geometry.length === b.geometry.length) {
    points = [];
    for (let i = 0; i < a.geometry.length; i++) {
      if (a.geometry[i].x === b.geometry[i].x && a.geometry[i].y === b.geometry[i].y) continue;
      // Moving vertex i changes only edges (i-1,i) and (i,i+1), their
      // intervening fill region, and joins at their three endpoints.
      for (const j of [(i + a.geometry.length - 1) % a.geometry.length, i, (i + 1) % a.geometry.length]) points.push(screen(a.geometry[j]), screen(b.geometry[j]));
    }
  } else points = [...a.geometry, ...b.geometry].map(screen);
  if (!points.length) return null;
  // Frobenius norm bounds the largest singular value, including shear and
  // nonuniform scaling. Two CSS pixels conservatively cover antialiasing.
  const pad = Math.hypot(world[0], world[1], world[2], world[3]) * viewport.zoom * Math.max(a.style.borderWidth, b.style.borderWidth) / 2 + 2;
  let x0 = Math.min(...points.map(p => p.x)) - pad, y0 = Math.min(...points.map(p => p.y)) - pad;
  let x1 = Math.max(...points.map(p => p.x)) + pad, y1 = Math.max(...points.map(p => p.y)) + pad;
  // Radius/style/matrix changes take the full-frame fallback above; insertion
  // and deletion conservatively cover both complete polygon bounds.
  x0 = Math.max(0, Math.floor(x0 * dpr) / dpr); y0 = Math.max(0, Math.floor(y0 * dpr) / dpr);
  x1 = Math.min(size.width, Math.ceil(x1 * dpr) / dpr); y1 = Math.min(size.height, Math.ceil(y1 * dpr) / dpr);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}
