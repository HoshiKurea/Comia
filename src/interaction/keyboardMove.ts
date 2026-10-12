import { preserveUnlinkedMasks } from '../images/maskGeometry';
import { createStore } from 'zustand/vanilla';
import type { Id, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { MATRIX_TRANSLATE_MAX } from '../domain/limits';
import { getDocument } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { runtimeStore } from '../state/runtimeStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { hasLockedDescendant } from '../layers/group';
import { inverse, worldMatrix } from '../geometry/matrix';
import { execute } from '../history/commandBus';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { cancelActiveGesture, registerGestureCanceller } from './activeGesture';

interface KeyboardMove { base: Project; preview: Project; ids: Id[]; pageId: Id; epoch: number; stateId: Id; dx: number; dy: number }
export const keyboardMoveStore = createStore<{ active: KeyboardMove | null }>(() => ({ active: null }));
let unregister: (() => void) | null = null;
export function currentKeyboardMove(): KeyboardMove | null { return keyboardMoveStore.getState().active; }
export function cancelKeyboardMove(): void { unregister?.(); unregister = null; keyboardMoveStore.setState({ active: null }); runtimeStore.setState({ gestureActive: false, previewProject: null }); }
export function moveByKeyboard(dx: number, dy: number): Result<void> {
  let move = currentKeyboardMove();
  if (!move) {
    const text = finishActiveTextEdit(); if (!text.ok) return text;
    cancelActiveGesture(); const doc = getDocument(), session = sessionStore.getState(), selected = new Set(session.selection);
    const ids = [...selected].filter((id) => { for (let parent = doc.project.layers[id]?.parentId; parent; parent = doc.project.layers[parent]?.parentId ?? null) if (selected.has(parent)) return false; return true; });
    if (!ids.length) return fail(problem('keyboard/empty', '请先选择要移动的图层'));
    for (const id of ids) {
      const layer = doc.project.layers[id], flags = effectiveLayerFlags(doc.project, id);
      if (!layer || layer.pageId !== session.activePageId || !flags.visible || flags.locked || hasLockedDescendant(doc.project, id)) return fail(problem('keyboard/locked', `图层“${layer?.name ?? id}”或其子层隐藏、锁定或不在当前页，不能移动`));
      if (layer.type === 'pageBackground') return fail(problem('background/transform', '页面背景固定在纸张范围内'));
      const parent = layer.parentId ? doc.project.layers[layer.parentId] : null;
      if ((parent?.type === 'panel' && !(layer.type === 'image' && !layer.crop)) || parent?.type === 'bubble') return fail(problem('keyboard/owned', `图层“${layer.name}”受容器控制，请使用裁剪或文字编辑模式`));
    }
    move = { base: doc.project, preview: doc.project, ids, pageId: session.activePageId, epoch: doc.epoch, stateId: doc.history.stateId, dx: 0, dy: 0 };
    unregister = registerGestureCanceller(cancelKeyboardMove);
  }
  const nextDx = move.dx + dx, nextDy = move.dy + dy, layers = { ...move.base.layers };
  for (const id of move.ids) {
    const layer = move.base.layers[id], parent = layer.parentId ? worldMatrix(move.base, layer.parentId) : [1, 0, 0, 1, 0, 0] as const;
    const inv = inverse(parent); if (!inv.ok) { cancelKeyboardMove(); return inv; }
    // Δlocal = linear(inverse(Wparent)) × Δpage; start matrix is never incrementally rescaled.
    const x = layer.matrix[4] + inv.value[0] * nextDx + inv.value[2] * nextDy;
    const y = layer.matrix[5] + inv.value[1] * nextDx + inv.value[3] * nextDy;
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > MATRIX_TRANSLATE_MAX || Math.abs(y) > MATRIX_TRANSLATE_MAX) return fail(problem('keyboard/bounds', `图层“${layer.name}”已达到坐标范围，继续移动被拒绝`));
    layers[id] = { ...layer, matrix: [layer.matrix[0], layer.matrix[1], layer.matrix[2], layer.matrix[3], x, y] };
  }
  const preview = { ...move.base, layers };
  preserveUnlinkedMasks(move.base, preview);
  keyboardMoveStore.setState({ active: { ...move, dx: nextDx, dy: nextDy, preview } });
  runtimeStore.setState({ gestureActive: true, previewProject: preview }); return ok(undefined);
}
export function commitKeyboardMove(): Result<void> {
  const move = currentKeyboardMove(); if (!move) return ok(undefined);
  const doc = getDocument();
  if (doc.epoch !== move.epoch || doc.history.stateId !== move.stateId) { cancelKeyboardMove(); return fail(problem('keyboard/stale', '项目已变化，按键移动预览已取消')); }
  cancelKeyboardMove();
  const result = execute({ label: '方向键移动图层', context: { pageId: move.pageId, selection: move.ids }, afterSelection: move.ids, mutate(project) { for (const id of move.ids) project.layers[id].matrix = move.preview.layers[id].matrix; } });
  return result.ok ? ok(undefined) : result;
}
