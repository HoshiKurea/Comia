import { breakoutSplitGuard } from '../images/breakoutCommands';
import clipping from 'polygon-clipping';
import type { Id, PanelLayer, Point, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { polyBounds, validateConvex } from '../geometry/polygon';
import { validateSimplePolygon } from '../geometry/simplePolygon';
import { clipHalfPlane } from '../geometry/clip';
import { GEOMETRY_POLICY } from '../domain/limits';
import { rectangle } from './presets';
import { getProject } from '../state/documentStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { hasLockedDescendant } from '../layers/group';

export interface LineCutSpec { a: Point; b: Point; gap: number }
export function splitPolygon(poly: Point[], mode: PanelLayer['geometryMode'], spec: LineCutSpec): Result<Point[][]> {
  if (![spec.a.x, spec.a.y, spec.b.x, spec.b.y, spec.gap].every(Number.isFinite) || spec.gap < 0 || spec.gap > 256) return fail(problem('panel/line-spec', '切割坐标须有效，间隙须为0～256px'));
  const dx = spec.b.x - spec.a.x, dy = spec.b.y - spec.a.y, len = Math.hypot(dx, dy);
  if (len < 1e-6) return fail(problem('panel/line-short', '拖动一条穿过分镜的切割线'));
  const n = { x: -dy / len, y: dx / len }, c = n.x * spec.a.x + n.y * spec.a.y;
  const box = polyBounds(poly), enclosing = rectangle({ x: box.x - 1, y: box.y - 1, width: box.width + 2, height: box.height + 2 });
  const result: Point[][] = [];
  try {
    for (const sign of [1, -1]) {
      const plane = { normal: { x: n.x * sign, y: n.y * sign }, offset: c * sign - spec.gap / 2 };
      if (mode !== 'simple') { const piece = clipHalfPlane(poly, plane); if (!piece.length) return fail(problem('panel/line-miss', '切割线须穿过分镜，间隙不能吞掉一侧')); result.push(piece); }
      else {
        const half = clipHalfPlane(enclosing, plane); if (!half.length) return fail(problem('panel/line-miss', '切割线未穿过轮廓'));
        const rings = clipping.intersection([poly.map(p => [p.x, p.y] as [number, number])], [half.map(p => [p.x, p.y] as [number, number])]);
        if (!rings.length) return fail(problem('panel/line-miss', '切割线未穿过轮廓'));
        for (const polygon of rings) {
          if (polygon.length !== 1) return fail(problem('panel/line-hole', '切割结果带洞，无法保存为分格'));
          result.push(polygon[0].slice(0, -1).map(([x, y]) => ({ x, y })));
        }
      }
    }
  } catch { return fail(problem('panel/line-boolean', '轮廓运算失败，请调整切割线')); }
  for (const geometry of result) {
    const bounds = polyBounds(geometry), checked = mode === 'simple' ? validateSimplePolygon(geometry) : validateConvex(geometry, GEOMETRY_POLICY);
    if (!checked.ok || bounds.width < 16 - 1e-6 || bounds.height < 16 - 1e-6) return fail(problem('panel/line-small', '所有切割结果须至少16×16px且保持合法；请调整切线或间隙'));
  }
  return ok(result);
}
export function previewLineCut(id: Id, spec: LineCutSpec, project = getProject()): Result<Point[][]> {
  const panel = project.layers[id];
  if (panel?.type !== 'panel' || panel.role !== 'leaf') return fail(problem('panel/line-target', '请选择未切割的叶子分镜'));
  if (effectiveLayerFlags(project, id).locked || hasLockedDescendant(project, id)) return fail(problem('panel/line-locked', '分镜或其后代已锁定'));
  const breakout = breakoutSplitGuard(project, id); if (!breakout.ok) return breakout;
  return splitPolygon(panel.geometry, panel.geometryMode, spec);
}
