import type { PanelTemplateNode, Point, Rect, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { validateConvex } from '../geometry/polygon';
import { GEOMETRY_POLICY } from '../domain/limits';

export const PANEL_PRESETS = [
  ['rect-panel', '矩形分镜'], ['round-panel', '圆角分镜'], ['ellipse-panel', '椭圆分镜'],
  ['triangle-panel', '三角分镜'], ['diamond-panel', '菱形分镜'], ['trapezoid', '梯形分镜'],
  ['parallelogram', '平行四边形'], ['pentagon-panel', '五边形分镜'], ['hexagon-panel', '六边形分镜'], ['octagon-panel', '八边形分镜'],
] as const;
export type PanelPresetKind = typeof PANEL_PRESETS[number][0];
export const LAYOUT_PRESETS = [
  ['two-rows', '上下二格'], ['two-columns', '左右二格'], ['three-rows', '三横条'], ['three-columns', '三竖条'],
  ['four-rows', '四横条'], ['grid-2x2', '四格'], ['grid-2x3', '六格竖版'], ['grid-3x2', '六格横版'],
  ['top-large', '上大下二'], ['bottom-large', '上二下大'], ['left-large', '左大右二'], ['right-large', '左二右大'],
] as const;
export type LayoutPresetKind = typeof LAYOUT_PRESETS[number][0];
export const rectangle = (r: Rect): Point[] => [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }];
export const panelNode = (geometry: Point[], children: PanelTemplateNode[] = []): PanelTemplateNode => ({ geometry, style: { borderWidth: children.length ? 0 : 4, borderRadius: 0, borderColor: '#000000FF', fill: '#FFFFFF00' }, children });

export function makePanelPreset(kind: PanelPresetKind, size = { width: 600, height: 400 }): Result<PanelTemplateNode> {
  const { width: w, height: h } = size;
  if (![w, h].every(Number.isFinite) || w < 16 || h < 16 || w > 16384 || h > 16384) return fail(problem('panel/preset-size', '分格尺寸须为16～16384px'));
  let geometry = rectangle({ x: 0, y: 0, width: w, height: h });
  const n = kind === 'ellipse-panel' ? 64 : kind === 'triangle-panel' ? 3 : kind === 'pentagon-panel' ? 5 : kind === 'hexagon-panel' ? 6 : kind === 'octagon-panel' ? 8 : 0;
  if (n) geometry = Array.from({ length: n }, (_, i) => ({ x: w / 2 + w / 2 * Math.cos(-Math.PI / 2 + 2 * Math.PI * i / n), y: h / 2 + h / 2 * Math.sin(-Math.PI / 2 + 2 * Math.PI * i / n) }));
  if (kind === 'diamond-panel') geometry = [{ x: w / 2, y: 0 }, { x: w, y: h / 2 }, { x: w / 2, y: h }, { x: 0, y: h / 2 }];
  if (kind === 'trapezoid') geometry = [{ x: w * 2 / 15, y: 0 }, { x: w * 13 / 15, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  if (kind === 'parallelogram') geometry = [{ x: w * 2 / 15, y: 0 }, { x: w, y: 0 }, { x: w * 13 / 15, y: h }, { x: 0, y: h }];
  const valid = validateConvex(geometry, GEOMETRY_POLICY); if (!valid.ok) return valid;
  const node = panelNode(geometry); if (kind === 'round-panel') node.style.borderRadius = 32;
  return ok(node);
}

export function makeGrid(bounds: Rect, rows: number, columns: number, gapX: number, gapY: number): Result<PanelTemplateNode> {
  if (![bounds.x, bounds.y, bounds.width, bounds.height, rows, columns, gapX, gapY].every(Number.isFinite) || !Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1 || rows > 8 || columns > 8 || rows * columns > 32 || gapX < 0 || gapY < 0 || gapX > 256 || gapY > 256) return fail(problem('panel/grid-options', '行列各1～8，总格数≤32，横纵间隙0～256px'));
  const w = (bounds.width - (columns - 1) * gapX) / columns, h = (bounds.height - (rows - 1) * gapY) / rows;
  if (w < 16 || h < 16) return fail(problem('panel/grid-small', '区域无法容纳这些分格；每格至少16×16px'));
  const children = Array.from({ length: rows * columns }, (_, i) => panelNode(rectangle({ x: bounds.x + i % columns * (w + gapX), y: bounds.y + Math.floor(i / columns) * (h + gapY), width: w, height: h })));
  return ok(panelNode(rectangle(bounds), children));
}
export function makeLayoutPreset(kind: LayoutPresetKind, bounds: Rect, gapX = 16, gapY = 16): Result<PanelTemplateNode> {
  const dimensions: Partial<Record<LayoutPresetKind, [number, number]>> = { 'two-rows': [2, 1], 'two-columns': [1, 2], 'three-rows': [3, 1], 'three-columns': [1, 3], 'four-rows': [4, 1], 'grid-2x2': [2, 2], 'grid-2x3': [3, 2], 'grid-3x2': [2, 3] };
  const dims = dimensions[kind]; if (dims) return makeGrid(bounds, ...dims, gapX, gapY);
  // Two-stage split, with the chosen half kept intact and the other equally divided.
  const horizontal = kind === 'top-large' || kind === 'bottom-large';
  const first = makeGrid(bounds, horizontal ? 2 : 1, horizontal ? 1 : 2, gapX, gapY); if (!first.ok) return first;
  const index = kind === 'top-large' || kind === 'left-large' ? 1 : 0;
  const half = first.value.children[index].geometry;
  const sub = makeGrid({ x: half[0].x, y: half[0].y, width: half[1].x - half[0].x, height: half[2].y - half[1].y }, horizontal ? 1 : 2, horizontal ? 2 : 1, gapX, gapY); if (!sub.ok) return sub;
  first.value.children.splice(index, 1, ...sub.value.children); return first;
}
