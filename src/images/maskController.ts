import { createStore } from 'zustand/vanilla';
import type { Id, ImageLayer, ImageMask, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { getDocument,documentStore } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { runtimeStore } from '../state/runtimeStore';
import { execute } from '../history/commandBus';
import { validateTransform } from '../domain/validate';
import { cancelActiveGesture, registerGestureCanceller } from '../interaction/activeGesture';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { retainResources } from '../storage/blobRepository';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { defaultMask, preserveUnlinkedMasks, validateMaskGeometry } from './maskGeometry';
import { freeImage, promoteMaterials } from './freeImage';

interface MaskEdit { base: Project; preview: Project; imageId: Id; pageId: Id; epoch: number; stateId: Id; target: 'image' | 'mask' }
export const maskEditStore = createStore<{ active: MaskEdit | null }>(() => ({ active: null }));
export const currentMaskEdit = () => maskEditStore.getState().active;
let unregister: (() => void) | null = null, unsubscribe: (() => void) | null = null, offDoc:(()=>void)|null=null, release: (() => void) | null = null;
export function cancelMaskEdit(): void {
  if (!currentMaskEdit()) return;
  unregister?.(); unregister = null; unsubscribe?.(); unsubscribe = null;
  offDoc?.();offDoc=null;
  maskEditStore.setState({ active: null }); release?.(); release = null;
  runtimeStore.setState({ previewProject: null, gestureActive: false });
}
export function beginMaskEdit(id: Id, shape?: ImageMask['shape'], editMode:'select'|'image-mask'='select'): Result<void> {
  const text = finishActiveTextEdit(); if (!text.ok) return text;
  cancelActiveGesture();
  const doc = getDocument(), image = doc.project.layers[id], flags = effectiveLayerFlags(doc.project, id);
  if (image?.type !== 'image' || flags.locked || !flags.visible) return fail(problem('mask/target', '请选择可见且未锁定的图片'));
  const preview = { ...doc.project, layers: { ...doc.project.layers } }; promoteMaterials(preview);
  const free = freeImage(preview, id); preview.layers[id] = { ...free, mask: shape || !free.mask ? defaultMask(free, shape) : structuredClone(free.mask) };
  release = retainResources(doc.project);
  maskEditStore.setState({ active: { base: doc.project, preview, imageId: id, pageId: image.pageId, epoch: doc.epoch, stateId: doc.history.stateId, target: 'mask' } });
  runtimeStore.setState({ previewProject: preview, gestureActive: true });
  sessionStore.setState({ selection: [id], activePageId: image.pageId, toolMode: editMode });
  unregister = registerGestureCanceller(cancelMaskEdit);
  const viewport=JSON.stringify(sessionStore.getState().viewportByPage[image.pageId]);
  unsubscribe = sessionStore.subscribe(next => { const active = currentMaskEdit(); if (active && (next.activePageId !== active.pageId || next.toolMode !== editMode || !next.selection.includes(id)||JSON.stringify(next.viewportByPage[image.pageId])!==viewport)) cancelMaskEdit(); });
  offDoc=documentStore.subscribe(next=>{if(currentMaskEdit()&&(next.epoch!==doc.epoch||next.history.stateId!==doc.history.stateId))cancelMaskEdit();});
  return ok(undefined);
}
export function selectMaskTarget(target: 'mask' | 'image'): void { const active = currentMaskEdit(); if (active) maskEditStore.setState({ active: { ...active, target } }); }
export function previewMaskImage(image: ImageLayer): Result<void> {
  const active = currentMaskEdit(), doc = getDocument();
  if (!active) return fail(problem('mask/inactive', '请先编辑遮罩'));
  if (doc.epoch !== active.epoch || doc.history.stateId !== active.stateId) { cancelMaskEdit(); return fail(problem('mask/stale', '作品已变化，编辑已取消')); }
  const flags = effectiveLayerFlags(doc.project, active.imageId);
  if (flags.locked || !flags.visible) { cancelMaskEdit(); return fail(problem('mask/locked', '图片已锁定或隐藏')); }
  // Only the two transforms and mask may change; ownership/source dimensions remain immutable here.
  const prior = active.preview.layers[active.imageId] as ImageLayer;
  if (image.id !== active.imageId || !image.mask) return fail(problem('mask/image', '编辑目标或遮罩已失效'));
  const candidate = { ...prior, matrix: [...image.matrix] as ImageLayer['matrix'], mask: structuredClone(image.mask) };
  const preview = { ...active.preview, layers: { ...active.preview.layers, [active.imageId]: candidate } };
  preserveUnlinkedMasks(active.preview, preview);
  const next = preview.layers[active.imageId] as ImageLayer;
  for (const checked of [validateTransform(next.matrix), validateTransform(next.mask!.matrix), validateMaskGeometry(next.mask!)]) if (!checked.ok) return checked;
  maskEditStore.setState({ active: { ...active, preview } }); runtimeStore.setState({ previewProject: preview }); return ok(undefined);
}
export function commitMaskEdit(): Result<void> {
  const active = currentMaskEdit(); if (!active) return ok(undefined);
  const doc = getDocument();
  if (doc.epoch !== active.epoch || doc.history.stateId !== active.stateId) { cancelMaskEdit(); return fail(problem('mask/stale', '作品已变化，编辑已取消')); }
  const image = structuredClone(active.preview.layers[active.imageId]); cancelMaskEdit();
  const result = execute({ label: '调整素材与遮罩', context: { pageId: active.pageId, selection: [active.imageId] }, afterSelection: [active.imageId], mutate(draft) { promoteMaterials(draft); draft.layers[active.imageId] = image; } });
  return result.ok ? ok(undefined) : result;
}
