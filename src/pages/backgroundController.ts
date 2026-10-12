import { createStore } from 'zustand/vanilla';
import type { Id, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { getDocument } from '../state/documentStore';
import { runtimeStore } from '../state/runtimeStore';
import { sessionStore } from '../state/sessionStore';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { cancelActiveGesture, registerGestureCanceller } from '../interaction/activeGesture';
import { backgroundTarget, updatePageBackground } from './backgroundCommands';
import { validateBackgroundBudget, validateBackgroundValues, type BackgroundValues } from './backgroundGeometry';

interface BackgroundPreview { token: number; id: Id; pageId: Id; base: Project; preview: Project; epoch: number; stateId: Id }
export const backgroundEditStore = createStore<{ active: BackgroundPreview | null }>(() => ({ active: null }));
export const currentBackgroundEdit = () => backgroundEditStore.getState().active;
let unregister: (() => void) | null = null, sequence = 0;
export function cancelBackgroundEdit(): void {
  if (!currentBackgroundEdit()) return;
  unregister?.(); unregister = null; backgroundEditStore.setState({ active: null }); runtimeStore.setState({ gestureActive: false, previewProject: null });
}
export function beginBackgroundEdit(id: Id): Result<void> {
  if (currentBackgroundEdit()?.id === id) return ok(undefined);
  const text = finishActiveTextEdit(); if (!text.ok) return text;
  cancelActiveGesture(); const doc = getDocument(), target = backgroundTarget(id); if (!target.ok) return target;
  if (target.value.pageId !== sessionStore.getState().activePageId) return fail(problem('background/page', '背景不在当前页面'));
  unregister = registerGestureCanceller(cancelBackgroundEdit);
  backgroundEditStore.setState({ active: { token: ++sequence, id, pageId: target.value.pageId, base: doc.project, preview: doc.project, epoch: doc.epoch, stateId: doc.history.stateId } });
  runtimeStore.setState({ gestureActive: true, previewProject: doc.project }); return ok(undefined);
}
export function previewPageBackground(id: Id, patch: Partial<BackgroundValues>): Result<void> {
  if (Object.keys(patch).some(key => !['fill', 'frame', 'watermark'].includes(key))) return fail(problem('background/field', '背景包含未知属性'));
  const existing = currentBackgroundEdit(), source = existing?.id === id ? existing.preview : getDocument().project, layer = source.layers[id];
  if (layer?.type !== 'pageBackground') return fail(problem('background/target', '背景已不存在'));
  const values = validateBackgroundValues({ fill: layer.fill, frame: layer.frame, watermark: layer.watermark, ...patch }); if (!values.ok) return values;
  const page = source.pages[layer.pageId], budget = validateBackgroundBudget(page.width, page.height, values.value.watermark); if (!budget.ok) return budget;
  if (!existing || existing.id !== id) { const started = beginBackgroundEdit(id); if (!started.ok) return started; }
  const active = currentBackgroundEdit()!, doc = getDocument();
  if (active.epoch !== doc.epoch || active.stateId !== doc.history.stateId) { cancelBackgroundEdit(); return fail(problem('background/stale', '作品已改变，背景预览已取消')); }
  const preview = { ...active.preview, layers: { ...active.preview.layers, [id]: { ...layer, ...values.value } } };
  backgroundEditStore.setState({ active: { ...active, preview } }); runtimeStore.setState({ previewProject: preview }); return ok(undefined);
}
export function commitBackgroundEdit(): Result<void> {
  const active = currentBackgroundEdit(); if (!active) return ok(undefined);
  const doc = getDocument(), layer = active.preview.layers[active.id]; cancelBackgroundEdit();
  if (active.epoch !== doc.epoch || active.stateId !== doc.history.stateId || layer.type !== 'pageBackground') return fail(problem('background/stale', '作品已改变，背景预览已取消'));
  return updatePageBackground(active.id, { fill: layer.fill, frame: layer.frame, watermark: layer.watermark });
}
sessionStore.subscribe((next, previous) => { const active = currentBackgroundEdit(); if (active && (next.activePageId !== active.pageId || next.selection.length !== 1 || next.selection[0] !== active.id) && (next.activePageId !== previous.activePageId || next.selection !== previous.selection)) cancelBackgroundEdit(); });
if (typeof window !== 'undefined') window.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.isComposing && currentBackgroundEdit()) cancelBackgroundEdit(); });
