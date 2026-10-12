import { createStore } from 'zustand/vanilla';
import type { Id, PanelLayer, PanelStyle, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { execute } from '../history/commandBus';
import { getDocument } from '../state/documentStore';
import { runtimeStore } from '../state/runtimeStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { cancelActiveGesture, registerGestureCanceller } from '../interaction/activeGesture';

interface StylePreview { token: number; ids: Id[]; pageId: Id; base: Project; preview: Project; epoch: number; stateId: Id }
export const panelStyleStore = createStore<{ active: StylePreview | null }>(() => ({ active: null }));
export const currentPanelStyle = () => panelStyleStore.getState().active;
let unregister: (() => void) | null = null;
let previewSequence = 0;

function targets(project: Project, ids: Id[]): Result<PanelLayer[]> {
  const unique = [...new Set(ids)], panels = unique.map((id) => project.layers[id]);
  if (!unique.length || panels.some((panel) => panel?.type !== 'panel')) return fail(problem('panel/style-target', '样式批量编辑只支持全部为分镜的选区'));
  const first = panels[0];
  if (panels.some((panel) => panel.pageId !== first.pageId)) return fail(problem('panel/style-page', '批量样式必须来自同一页'));
  if (panels.some((panel) => effectiveLayerFlags(project, panel.id).locked)) return fail(problem('panel/style-locked', '选区包含锁定分镜，整批样式未修改'));
  return ok(panels as PanelLayer[]);
}
function normalizedPatch(patch: Partial<PanelStyle>): Result<Partial<PanelStyle>> {
  const output: Partial<PanelStyle> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'borderRadius' || key === 'borderWidth') {
      const maximum = key === 'borderRadius' ? 4096 : 256;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) return fail(problem('panel/style-range', `${key === 'borderRadius' ? '请求圆角' : '边框宽度'}须在0～${maximum}之间`));
      output[key] = value;
    } else if (key === 'fill' || key === 'borderColor') {
      if (typeof value !== 'string' || !/^#[0-9a-f]{8}$/i.test(value)) return fail(problem('panel/style-color', '颜色须为#RRGGBBAA，包含透明度'));
      output[key] = value.toUpperCase();
    } else return fail(problem('panel/style-field', '分镜样式包含未知属性'));
  }
  return ok(output);
}
export function setPanelStyle(ids: Id[], patch: Partial<PanelStyle>): Result<void> {
  const edit = finishActiveTextEdit(); if (!edit.ok) return edit;
  cancelActiveGesture(); const doc = getDocument(), checked = targets(doc.project, ids), normalized = normalizedPatch(patch);
  if (!checked.ok) return checked; if (!normalized.ok) return normalized;
  const result = execute({ label: '修改分镜样式', context: { pageId: checked.value[0].pageId, selection: ids }, mutate(project) {
    for (const panel of checked.value) (project.layers[panel.id] as PanelLayer).style = { ...panel.style, ...normalized.value };
  } }); return result.ok ? ok(undefined) : result;
}
export function cancelPanelStyle(): void {
  if (!currentPanelStyle()) return;
  unregister?.(); unregister = null; panelStyleStore.setState({ active: null }); runtimeStore.setState({ gestureActive: false, previewProject: null });
}
export function previewPanelStyle(ids: Id[], patch: Partial<PanelStyle>): Result<void> {
  const normalized = normalizedPatch(patch); if (!normalized.ok) return normalized;
  let active = currentPanelStyle(); const signature = [...new Set(ids)].sort().join(',');
  if (!active || [...active.ids].sort().join(',') !== signature) {
    const edit = finishActiveTextEdit(); if (!edit.ok) return edit; cancelActiveGesture(); const doc = getDocument(), checked = targets(doc.project, ids); if (!checked.ok) return checked;
    active = { token: ++previewSequence, ids: checked.value.map((panel) => panel.id), pageId: checked.value[0].pageId, base: doc.project, preview: doc.project, epoch: doc.epoch, stateId: doc.history.stateId };
    unregister = registerGestureCanceller(cancelPanelStyle);
  }
  if (active.epoch !== getDocument().epoch || active.stateId !== getDocument().history.stateId) { cancelPanelStyle(); return fail(problem('panel/style-stale', '作品已变化，样式预览已取消')); }
  const layers = { ...active.preview.layers };
  for (const id of active.ids) { const panel = layers[id] as PanelLayer; layers[id] = { ...panel, style: { ...panel.style, ...normalized.value } }; }
  const preview = { ...active.preview, layers };
  panelStyleStore.setState({ active: { ...active, preview } }); runtimeStore.setState({ gestureActive: true, previewProject: preview }); return ok(undefined);
}
export function commitPanelStyle(): Result<void> {
  const active = currentPanelStyle(); if (!active) return ok(undefined);
  const doc = getDocument(); cancelPanelStyle();
  if (active.epoch !== doc.epoch || active.stateId !== doc.history.stateId) return fail(problem('panel/style-stale', '作品已变化，样式预览已取消'));
  const checked = targets(doc.project, active.ids); if (!checked.ok) return checked;
  const result = execute({ label: '修改分镜样式', context: { pageId: active.pageId, selection: active.ids }, mutate(project) {
    for (const id of active.ids) (project.layers[id] as PanelLayer).style = { ...(active.preview.layers[id] as PanelLayer).style };
  } }); return result.ok ? ok(undefined) : result;
}
export function previewPanelColor(ids: Id[], field: 'fill' | 'borderColor', channel: 'rgb' | 'alpha', value: string | number): Result<void> {
  if (channel === 'rgb' ? typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value) : typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) return fail(problem('panel/style-color', '颜色通道数值无效'));
  const started = previewPanelStyle(ids, {}); if (!started.ok) return started;
  const active = currentPanelStyle()!, layers = { ...active.preview.layers };
  const suffix = channel === 'alpha' ? Math.round(Number(value) / 100 * 255).toString(16).padStart(2, '0').toUpperCase() : '';
  for (const id of active.ids) {
    const panel = layers[id] as PanelLayer, color = panel.style[field];
    layers[id] = { ...panel, style: { ...panel.style, [field]: channel === 'rgb' ? `${String(value).toUpperCase()}${color.slice(7)}` : `${color.slice(0, 7)}${suffix}` } };
  }
  const preview = { ...active.preview, layers }; panelStyleStore.setState({ active: { ...active, preview } }); runtimeStore.setState({ previewProject: preview }); return ok(undefined);
}

/** Same uniform tangent-distance clamp as buildRoundedPolygon. No request value is changed. */
export function effectivePanelRadius(panel: PanelLayer): number {
  if (panel.geometryMode === 'simple') return 0;
  const poly = panel.geometry, radius = panel.style.borderRadius;
  const distances = poly.map((point, index) => {
    const prev = poly[(index - 1 + poly.length) % poly.length], next = poly[(index + 1) % poly.length];
    const a = Math.hypot(prev.x - point.x, prev.y - point.y), b = Math.hypot(next.x - point.x, next.y - point.y);
    const angle = Math.acos(Math.max(-1, Math.min(1, ((prev.x - point.x) * (next.x - point.x) + (prev.y - point.y) * (next.y - point.y)) / (a * b))));
    return angle >= Math.PI - .05 || angle <= 1e-9 ? 0 : radius / Math.tan(angle / 2);
  });
  let lambda = 1;
  for (let index = 0; index < poly.length; index++) { const next = (index + 1) % poly.length, sum = distances[index] + distances[next]; if (sum > 1e-12) lambda = Math.min(lambda, Math.hypot(poly[next].x - poly[index].x, poly[next].y - poly[index].y) / sum); }
  return radius * lambda;
}
