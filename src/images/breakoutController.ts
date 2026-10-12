import { createStore } from 'zustand/vanilla';
import type { BreakoutRegion, Id, ImageLayer, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { validateProject } from '../domain/validate';
import { getDocument } from '../state/documentStore';
import { runtimeStore } from '../state/runtimeStore';
import { sessionStore } from '../state/sessionStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { cancelActiveGesture, registerGestureCanceller } from '../interaction/activeGesture';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { execute } from '../history/commandBus';
import { freeImage } from './freeImage';
import { defaultBreakoutRegion, validateBreakoutRegion } from './breakoutCommands';

interface BreakoutEditSession { imageId: Id; projectId: Id; epoch: number; stateId: Id; base: Project; preview: Project }
export const breakoutEditStore = createStore<{ active: BreakoutEditSession | null }>(() => ({ active: null }));
export const currentBreakoutEdit = () => breakoutEditStore.getState().active;
let unregister: (() => void) | null = null;
export function cancelBreakoutEdit(): void { unregister?.(); unregister = null; breakoutEditStore.setState({ active: null }); runtimeStore.setState({ gestureActive: false, previewProject: null }); }
export function beginBreakoutEdit(imageId: Id, shape?: BreakoutRegion['shape']): Result<void> {
  const text = finishActiveTextEdit(); if (!text.ok) return text; cancelActiveGesture();
  const doc = getDocument(), image = doc.project.layers[imageId], flags = effectiveLayerFlags(doc.project, imageId);
  if (doc.project.schemaVersion < 5 || image?.type !== 'image' || !image.parentId || doc.project.layers[image.parentId]?.type !== 'panel' || flags.locked || !flags.visible) return fail(problem('breakout/edit-target', '请选择可见、未锁定并关联分镜的素材'));
  const target = structuredClone(freeImage(doc.project, imageId)), region = shape ? defaultBreakoutRegion(target, shape) : target.panelClip?.region ?? defaultBreakoutRegion(target);
  target.panelClip = { mode: 'partial', region: structuredClone(region) };
  const preview = { ...doc.project, layers: { ...doc.project.layers, [imageId]: target } };
  const checked = validateProject(preview); if (!checked.ok) return checked;
  breakoutEditStore.setState({ active: { imageId, projectId: doc.project.id, epoch: doc.epoch, stateId: doc.history.stateId, base: doc.project, preview } });
  runtimeStore.setState({ gestureActive: true, previewProject: preview }); sessionStore.setState({ selection: [imageId], toolMode: 'select' }); unregister = registerGestureCanceller(cancelBreakoutEdit); return ok(undefined);
}
export function previewBreakoutRegion(region: BreakoutRegion): Result<void> {
  const active = currentBreakoutEdit(), doc = getDocument(); if (!active) return fail(problem('breakout/edit-inactive', '局部破格编辑已结束'));
  if (active.epoch !== doc.epoch || active.projectId !== doc.project.id || active.stateId !== doc.history.stateId) { cancelBreakoutEdit(); return fail(problem('breakout/edit-stale', '作品已变化，局部破格编辑取消')); }
  const valid = validateBreakoutRegion(region); if (!valid.ok) return valid;
  const source = active.preview.layers[active.imageId] as ImageLayer, image: ImageLayer = { ...source, panelClip: { mode: 'partial', region: structuredClone(region) } };
  // The immutable base and unchanged image/container fields were validated at
  // begin. Only the region changes here; complete validation remains in execute.
  const preview = { ...active.preview, layers: { ...active.preview.layers, [image.id]: image } };
  breakoutEditStore.setState({ active: { ...active, preview } }); runtimeStore.setState({ previewProject: preview }); return ok(undefined);
}
export function commitBreakoutEdit(): Result<void> {
  const active = currentBreakoutEdit(), doc = getDocument(); if (!active) return ok(undefined);
  if (active.epoch !== doc.epoch || active.stateId !== doc.history.stateId || active.projectId !== doc.project.id || effectiveLayerFlags(doc.project, active.imageId).locked) { cancelBreakoutEdit(); return fail(problem('breakout/edit-stale', '作品或锁定状态已变化，未提交破格修改')); }
  const image = structuredClone(active.preview.layers[active.imageId]); cancelBreakoutEdit();
  const result = execute({ label: '编辑局部破格区域', context: { pageId: image.pageId, selection: [image.id] }, afterSelection: [image.id], mutate(draft) { draft.layers[image.id] = image; } }); return result.ok ? ok(undefined) : result;
}
