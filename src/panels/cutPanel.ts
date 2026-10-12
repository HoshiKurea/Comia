import { breakoutSplitGuard } from '../images/breakoutCommands';
import { createStore } from 'zustand/vanilla';
import type { Id, PanelLayer, Point, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { CUT, GEOMETRY_POLICY, LIMITS } from '../domain/limits';
import { getProject } from '../state/documentStore';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { cancelActiveGesture, registerGestureCanceller } from '../interaction/activeGesture';
import { hasLockedDescendant } from '../layers/group';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { clipAlongHorizontal, clipAlongVertical } from '../geometry/clip';
import { polyBounds, validateConvex } from '../geometry/polygon';
import { splitPolygon } from './lineCut';
import { panelNode } from './presets';
import { applyIndependentLayout } from './independentLayout';

export interface CutSpec { axis: 'horizontal' | 'vertical'; ratio: number; gap: number }
export interface CutResult { polygons: Point[][]; coordinate: number; gap: number; axis: CutSpec['axis'] }
export function previewCut(id: Id, spec: CutSpec, project = getProject()): Result<CutResult> {
  const panel = project.layers[id];
  if (panel?.type !== 'panel' || panel.role !== 'leaf') return fail(problem('panel/cut-target', '请选择未切割的叶子分镜；已切割父框不能再次直接切割'));
  if (effectiveLayerFlags(project, id).locked || hasLockedDescendant(project, id)) return fail(problem('panel/cut-locked', '分镜或其后代已锁定，切割未执行'));
  const breakout = breakoutSplitGuard(project, id); if (!breakout.ok) return breakout;
  if (!['horizontal', 'vertical'].includes(spec.axis) || !Number.isFinite(spec.ratio) || spec.ratio < CUT.ratio.min || spec.ratio > CUT.ratio.max || !Number.isFinite(spec.gap) || spec.gap < CUT.gap.min || spec.gap > CUT.gap.max) return fail(problem('panel/cut-spec', '切割比例须为0.01～0.99，间隙须为0～256px'));
  let depth = 1;
  for (let parent = panel.parentId; parent; parent = project.layers[parent]?.parentId ?? null) depth++;
  if (depth + Number(panel.children.length > 0) > LIMITS.maxDepth) return fail(problem('panel/cut-depth', '切割后的图层深度超过16层'));
  const bounds = polyBounds(panel.geometry), length = spec.axis === 'vertical' ? bounds.width : bounds.height;
  if (spec.gap >= length) return fail(problem('panel/cut-gap', '间隙必须小于沿切割轴的长度'));
  const coordinate = (spec.axis === 'vertical' ? bounds.x : bounds.y) + spec.ratio * length;
  if (panel.geometryMode === 'simple') {
    const split = splitPolygon(panel.geometry, panel.geometryMode, spec.axis === 'vertical' ? { a: { x: coordinate, y: 1 }, b: { x: coordinate, y: 0 }, gap: spec.gap } : { a: { x: 0, y: coordinate }, b: { x: 1, y: coordinate }, gap: spec.gap });
    if (!split.ok) return split;
    if (Object.values(project.layers).filter(layer => layer.type !== 'pageBackground').length - 1 + split.value.length + (split.value.length - 1) * panel.children.length > LIMITS.maxLayers) return fail(problem('panel/cut-count', '切割结果超过5000图层'));
    return ok({ polygons: split.value, coordinate, gap: spec.gap, axis: spec.axis });
  }
  const polygons: Point[][] = spec.axis === 'vertical' ? [clipAlongVertical(panel.geometry, coordinate, spec.gap, 'left'), clipAlongVertical(panel.geometry, coordinate, spec.gap, 'right')] : [clipAlongHorizontal(panel.geometry, coordinate, spec.gap, 'top'), clipAlongHorizontal(panel.geometry, coordinate, spec.gap, 'bottom')];
  for (const polygon of polygons) { const box = polyBounds(polygon), valid = validateConvex(polygon, GEOMETRY_POLICY); if (!valid.ok || box.width < 16 - 1e-6 || box.height < 16 - 1e-6) return fail(problem('panel/cut-small', '切割后两块都须至少16×16px且保持合法凸多边形，请调整比例或间隙')); }
  if (Object.values(project.layers).filter(layer => layer.type !== 'pageBackground').length + 1 + panel.children.length > LIMITS.maxLayers) return fail(problem('panel/cut-count', '切割结果超过5000图层'));
  return ok({ polygons, coordinate, gap: spec.gap, axis: spec.axis });
}
export function commitCut(id: Id, spec: CutSpec): Result<Id[]> {
  const edit = finishActiveTextEdit(); if (!edit.ok) return edit; cancelActiveGesture();
  const project = getProject(), preview = previewCut(id, spec, project); if (!preview.ok) return preview;
  const panel = project.layers[id] as PanelLayer;
  const tree = panelNode(panel.geometry, preview.value.polygons.map(geometry => ({ ...panelNode(geometry), geometryMode: panel.geometryMode, style: { ...panel.style, borderRadius: 0 } })));
  tree.geometryMode = panel.geometryMode;
  return applyIndependentLayout(panel.pageId, tree, id);
}

export const cutPreviewStore = createStore<{ active: { id: Id; project: Project; result: CutResult } | null }>(() => ({ active: null }));
let unregister: (() => void) | null = null;
export function clearCutPreview(): void { unregister?.(); unregister = null; cutPreviewStore.setState({ active: null }); }
export function showCutPreview(id: Id, spec: CutSpec): Result<void> {
  const project = getProject(), result = previewCut(id, spec, project); if (!result.ok) { clearCutPreview(); return result; }
  if (!unregister) unregister = registerGestureCanceller(clearCutPreview);
  cutPreviewStore.setState({ active: { id, project, result: result.value } }); return ok(undefined);
}
