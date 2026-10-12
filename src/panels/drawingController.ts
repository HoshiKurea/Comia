import { breakoutSplitGuard } from '../images/breakoutCommands';
import { createStore } from 'zustand/vanilla';
import type { Id, PanelLayer, Point, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { getDocument } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { runtimeStore } from '../state/runtimeStore';
import { execute } from '../history/commandBus';
import { cancelActiveGesture, registerGestureCanceller } from '../interaction/activeGesture';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { hasLockedDescendant } from '../layers/group';
import { polyBounds } from '../geometry/polygon';
import { validateSimplePolygon, polygonContained } from '../geometry/simplePolygon';
import { cropFromMapping, resolveCrop } from '../images/crop';
import { correctContour, type FreehandOptions } from './correctContour';
import { previewLineCut } from './lineCut';
import { replaceLeafWithLayout } from './splitCommand';
import { panelNode } from './presets';
import { instantiatePanelTree } from './instantiate';
import { placeObjectDraft } from '../app/actions';

export interface DrawingSession {
  kind: 'freehand' | 'polygon' | 'edit' | 'line'; pageId: Id; targetId: Id | null;
  base: Project; preview: Project; epoch: number; stateId: Id;
  raw: Point[]; points: Point[]; phase: 'drawing' | 'review'; zoom: number;
  options: FreehandOptions; error: string; gap: number; pieces: Point[][];
}
export const drawingStore = createStore<{ active: DrawingSession | null }>(() => ({ active: null }));
export const currentDrawing = () => drawingStore.getState().active;
let unregister: (() => void) | null = null;
export function cancelDrawing(): void {
  if (!currentDrawing()) return; unregister?.(); unregister = null;
  drawingStore.setState({ active: null }); runtimeStore.setState({ gestureActive: false, previewProject: null });
}
sessionStore.subscribe((s,old)=>{const a=currentDrawing();if(a&&(s.activePageId!==old.activePageId||a.kind==='line'&&s.toolMode==='panel-cut'&&a.targetId&&!s.selection.includes(a.targetId)))cancelDrawing();});
export function beginDrawing(kind: DrawingSession['kind'], targetId: Id | null = null): Result<void> {
  const text = finishActiveTextEdit(); if (!text.ok) return text; cancelActiveGesture(); const doc = getDocument(), pageId = sessionStore.getState().activePageId, panel = targetId ? doc.project.layers[targetId] : null;
  if (!doc.project.pages[pageId]) return fail(problem('panel/draw-page', '当前页面不存在'));
  if ((kind === 'edit' || kind === 'line') && (panel?.type !== 'panel' || panel.role !== 'leaf' || panel.pageId !== pageId || effectiveLayerFlags(doc.project, panel.id).locked || hasLockedDescendant(doc.project, panel.id))) return fail(problem('panel/draw-target', '请选择可编辑且没有锁定图片的叶子分镜'));
  if (kind === 'line' && targetId) { const guard = breakoutSplitGuard(doc.project, targetId); if (!guard.ok) return guard; }
  const raw = kind === 'edit' && panel?.type === 'panel' ? structuredClone(panel.geometry) : [];
  drawingStore.setState({ active: { kind, pageId, targetId, base: doc.project, preview: doc.project, epoch: doc.epoch, stateId: doc.history.stateId, raw, points: structuredClone(raw), phase: kind === 'edit' ? 'review' : 'drawing', zoom: 1, options: { mode: 'contour', toleranceScreenPx: 1.5, closeDistanceScreenPx: 16 }, error: '', gap: 16, pieces: [] } });
  unregister = registerGestureCanceller(cancelDrawing); runtimeStore.setState({ gestureActive: true }); return ok(undefined);
}
function validSession(active: DrawingSession): boolean {
  const doc = getDocument(); return doc.epoch === active.epoch && doc.history.stateId === active.stateId && doc.project === active.base && sessionStore.getState().activePageId === active.pageId;
}
export function setDrawingGeometry(points: Point[]): Result<void> {
  const active = currentDrawing(); if (!active) return fail(problem('panel/draw-inactive', '没有分格草稿'));
  if (!validSession(active)) { cancelDrawing(); return fail(problem('panel/draw-stale', '作品已变化，轮廓修正已取消')); }
  // The pointer owner keeps mutating its sample array between frames. A
  // validated preview must own its points so an invalid next move cannot
  // mutate the previous legal mask before validation or damage comparison.
  points = structuredClone(points);
  let checked = validateSimplePolygon(points), preview = active.base;
  const target = active.targetId ? active.base.layers[active.targetId] : null;
  if (checked.ok && active.kind === 'edit' && target?.type === 'panel') {
    const parent = target.parentId ? active.base.layers[target.parentId] : null;
    if (parent?.type === 'panel' && !polygonContained(parent.geometry, points)) checked = fail(problem('panel/draw-outside', '轮廓不能超出父分镜'));
    else {
      preview = { ...active.base, layers: { ...active.base.layers, [target.id]: { ...target, geometry: points, geometryMode: 'simple', style: { ...target.style, borderRadius: 0 } } } };
      try {
        for (const id of target.children) {
          const image = active.base.layers[id]; if (image.type !== 'image' || !image.crop) continue;
          const mapping = resolveCrop(target.geometry, { x: image.width, y: image.height }, image.crop), box = polyBounds(points);
          if (box.x < mapping.tx - 1e-6 || box.y < mapping.ty - 1e-6 || box.x + box.width > mapping.tx + image.width * mapping.scale + 1e-6 || box.y + box.height > mapping.ty + image.height * mapping.scale + 1e-6) throw Error('image cannot cover contour');
          preview.layers[id] = { ...image, crop: cropFromMapping(points, { x: image.width, y: image.height }, mapping) };
        }
      } catch { checked = fail(problem('panel/draw-crop', '原图片无法覆盖扩大后的分格，请先放大图片裁剪')); }
    }
  }
  drawingStore.setState({ active: { ...active, ...(checked.ok ? { points: structuredClone(points), preview } : {}), error: checked.ok ? '' : checked.problems[0].message } });
  if (checked.ok && active.kind === 'edit') runtimeStore.setState({ previewProject: preview }); return checked;
}
export function setRawDrawing(raw: Point[], zoom: number): void {
  const active = currentDrawing(); if (!active) return;
  if (!validSession(active)) { cancelDrawing(); return; }
  if (raw.length > 4096) { drawingStore.setState({ active: { ...active, error: '采样已达4096点，请结束或重新绘制' } }); return; }
  drawingStore.setState({ active: { ...active, raw, points: raw, zoom, error: '' } });
  if (active.kind === 'line' && raw.length === 2 && active.targetId) {
    const result = previewLineCut(active.targetId, { a: raw[0], b: raw[1], gap: active.gap }, active.base);
    drawingStore.setState({ active: { ...currentDrawing()!, pieces: result.ok ? result.value : [], error: result.ok ? '' : result.problems[0].message } });
  }
}
export function finishDrawing(): Result<void> {
  const active = currentDrawing(); if (!active) return fail(problem('panel/draw-inactive', '没有分格草稿'));
  if (!validSession(active)) { cancelDrawing(); return fail(problem('panel/draw-stale', '作品已变化，未应用草稿')); }
  if (active.kind === 'line') {
    if (active.raw.length !== 2 || !active.targetId) return fail(problem('panel/draw-line', '请拖动切割线'));
    const split = previewLineCut(active.targetId, { a: active.raw[0], b: active.raw[1], gap: active.gap }, active.base); if (!split.ok) return split;
    const panel = active.base.layers[active.targetId] as PanelLayer, root = panelNode(panel.geometry, split.value.map(geometry => ({ ...panelNode(geometry), geometryMode: panel.geometryMode, style: { ...panel.style, borderRadius: 0 } })));
    root.geometryMode = panel.geometryMode; cancelDrawing(); const result = replaceLeafWithLayout(panel.id, root); return result.ok ? ok(undefined) : result;
  }
  const corrected = correctContour(active.raw, { ...active.options, closeDistanceScreenPx: active.kind === 'freehand' ? active.options.closeDistanceScreenPx : 0 }, active.zoom); if (!corrected.ok) { drawingStore.setState({ active: { ...active, phase: 'review', error: corrected.problems[0].message } }); return corrected; }
  drawingStore.setState({ active: { ...active, phase: 'review' } }); return setDrawingGeometry(corrected.value);
}
export function correctDrawing(options: FreehandOptions): Result<void> {
  const active = currentDrawing(); if (!active) return fail(problem('panel/draw-inactive', '没有轮廓草稿'));
  drawingStore.setState({ active: { ...active, options } }); const result = correctContour(active.raw, { ...options, closeDistanceScreenPx: active.kind === 'freehand' ? options.closeDistanceScreenPx : 0 }, active.zoom);
  if (!result.ok) { drawingStore.setState({ active: { ...currentDrawing()!, error: result.problems[0].message } }); return result; }
  return setDrawingGeometry(result.value);
}
export function commitDrawing(): Result<void> {
  const active = currentDrawing(); if (!active) return ok(undefined);
  if (!validSession(active)) { cancelDrawing(); return fail(problem('panel/draw-stale', '作品已变化，未应用草稿')); }
  if (active.error) return fail(problem('panel/draw-invalid', active.error));
  const checked = validateSimplePolygon(active.points); if (!checked.ok) return checked;
  const page = active.base.pages[active.pageId];
  if (!active.targetId && active.points.some(p => p.x < 0 || p.y < 0 || p.x > page.width || p.y > page.height)) return fail(problem('panel/draw-page-bounds', '新分格须位于页面内'));
  cancelDrawing();
  if (active.kind === 'edit' && active.targetId) {
    const target = active.base.layers[active.targetId]; if (effectiveLayerFlags(active.base, target.id).locked) return fail(problem('panel/draw-locked', '目标已锁定'));
    const result = execute({ label: '修正分格轮廓', context: { pageId: active.pageId, selection: [target.id] }, afterSelection: [target.id], mutate(draft) { draft.layers[target.id] = active.preview.layers[target.id]; if ('children' in target) for (const id of target.children) draft.layers[id] = active.preview.layers[id]; } }); return result.ok ? ok(undefined) : result;
  }
  const tree = panelNode(active.points); tree.geometryMode = 'simple';
  const result = placeObjectDraft(instantiatePanelTree(tree, active.pageId), active.pageId, { x: 0, y: 0 }); return result.ok ? ok(undefined) : result;
}
