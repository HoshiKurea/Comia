import { createStore } from 'zustand/vanilla';
import type { CropParams, Id, ImageLayer, PanelLayer, Point, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { execute } from '../history/commandBus';
import { getDocument } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { runtimeStore } from '../state/runtimeStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { cancelActiveGesture, registerGestureCanceller } from '../interaction/activeGesture';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { retainResources } from '../storage/blobRepository';
import { cropFromMapping, resolveCrop, zoomCrop } from './crop';
import { polyBounds } from '../geometry/polygon';

export interface CropEdit {
  base: Project; preview: Project; panelId: Id; imageId: Id; pageId: Id; epoch: number; stateId: Id;
  maximumByImage: Record<Id, number>;
}
export const cropEditStore = createStore<{ active: CropEdit | null }>(() => ({ active: null }));
export const currentCropEdit = () => cropEditStore.getState().active;
let unregister: (() => void) | null = null, unsubscribeSession: (() => void) | null = null, release: (() => void) | null = null;
export function editableCropImages(project: Project, panelId: Id): ImageLayer[] {
  const panel = project.layers[panelId];
  return panel?.type === 'panel' ? [...panel.children].reverse().map((id) => project.layers[id]).filter((layer): layer is ImageLayer => layer?.type === 'image' && !!layer.crop && effectiveLayerFlags(project, layer.id).visible && !effectiveLayerFlags(project, layer.id).locked) : [];
}
export function cancelCropEdit(): void {
  if (!currentCropEdit()) return;
  unregister?.(); unregister = null; unsubscribeSession?.(); unsubscribeSession = null;
  cropEditStore.setState({ active: null }); release?.(); release = null;
  runtimeStore.setState({ previewProject: null, gestureActive: false });
  sessionStore.setState({ cropTarget: null, toolMode: 'select' });
}
export function beginCropEdit(panelId: Id, imageId?: Id): Result<void> {
  const text = finishActiveTextEdit(); if (!text.ok) return text;
  cancelActiveGesture(); cancelCropEdit();
  const doc = getDocument(), panel = doc.project.layers[panelId], flags = effectiveLayerFlags(doc.project, panelId);
  if (panel?.type !== 'panel' || panel.role !== 'leaf' || !flags.visible || flags.locked) return fail(problem('crop/target', '请先选择可见且未锁定的叶子分镜'));
  const choices = editableCropImages(doc.project, panelId), image = imageId ? choices.find((item) => item.id === imageId) : choices[0];
  if (!image) return fail(problem('crop/no-image', imageId ? '目标图片不可见、已锁定或不属于此分镜' : `分镜“${panel.name}”中没有可编辑的可见图片，请先导入图片`));
  const maximumByImage = Object.fromEntries(choices.map((item) => [item.id, Math.max(16, item.crop!.zoom)]));
  release = retainResources(doc.project);
  cropEditStore.setState({ active: { base: doc.project, preview: doc.project, pageId: panel.pageId, panelId, imageId: image.id, maximumByImage, epoch: doc.epoch, stateId: doc.history.stateId } });
  sessionStore.setState({ activePageId: panel.pageId, toolMode: 'crop', cropTarget: { pageId: panel.pageId, panelId, imageId: image.id }, selection: [panelId] });
  unregister = registerGestureCanceller(cancelCropEdit);
  unsubscribeSession = sessionStore.subscribe((next) => { const active = currentCropEdit(); if (active && (next.toolMode !== 'crop' || next.activePageId !== active.pageId)) cancelCropEdit(); });
  return ok(undefined);
}
function checkedActive(): Result<CropEdit> {
  const active = currentCropEdit(), doc = getDocument();
  if (!active) return fail(problem('crop/inactive', '请先进入图片裁剪'));
  if (active.epoch !== doc.epoch || active.stateId !== doc.history.stateId) { cancelCropEdit(); return fail(problem('crop/stale', '作品已变化，裁剪已取消')); }
  if (!editableCropImages(doc.project, active.panelId).some((image) => image.id === active.imageId)) { cancelCropEdit(); return fail(problem('crop/locked', '目标图片已不可编辑，裁剪已取消')); }
  return ok(active);
}
export function selectCropImage(imageId: Id): Result<void> {
  const checked = checkedActive(); if (!checked.ok) return checked; const active = checked.value;
  if (runtimeStore.getState().gestureActive) return fail(problem('crop/gesture', '请先结束当前拖动再切换图片'));
  if (!editableCropImages(active.base, active.panelId).some((image) => image.id === imageId)) return fail(problem('crop/target', '目标图片不可见、已锁定或不属于此分镜'));
  cropEditStore.setState({ active: { ...active, imageId } });
  sessionStore.setState({ cropTarget: { pageId: active.pageId, panelId: active.panelId, imageId } }); return ok(undefined);
}
export function previewCropParams(crop: CropParams): Result<void> {
  const checked = checkedActive(); if (!checked.ok) return checked; const active = checked.value;
  if (![crop.zoom, crop.focus.u, crop.focus.v].every(Number.isFinite) || crop.zoom < 1 || crop.zoom > active.maximumByImage[active.imageId] || crop.focus.u < 0 || crop.focus.u > 1 || crop.focus.v < 0 || crop.focus.v > 1) return fail(problem('crop/range', `焦点须在0～1，缩放须在1～${active.maximumByImage[active.imageId]}之间`));
  const panel = active.preview.layers[active.panelId] as PanelLayer, image = active.preview.layers[active.imageId] as ImageLayer;
  const normalized = cropFromMapping(panel.geometry, { x: image.width, y: image.height }, resolveCrop(panel.geometry, { x: image.width, y: image.height }, crop));
  const preview = { ...active.preview, layers: { ...active.preview.layers, [image.id]: { ...image, crop: normalized } } };
  cropEditStore.setState({ active: { ...active, preview } }); runtimeStore.setState({ previewProject: preview }); return ok(undefined);
}
export function previewCropZoom(zoom: number, anchor?: Point): Result<void> {
  const checked = checkedActive(); if (!checked.ok) return checked; const active = checked.value;
  const panel = active.preview.layers[active.panelId] as PanelLayer, image = active.preview.layers[active.imageId] as ImageLayer, box = polyBounds(panel.geometry);
  if (!Number.isFinite(zoom)) return fail(problem('crop/range', '缩放须为有限数字'));
  return previewCropParams(zoomCrop(panel.geometry, { x: image.width, y: image.height }, image.crop!, zoom, anchor ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 }, active.maximumByImage[image.id]));
}
export function commitCropEdit(): Result<void> {
  const checked = checkedActive(); if (!checked.ok) return checked; const active = checked.value;
  cancelCropEdit();
  const result = execute({ label: '调整图片裁剪', context: { pageId: active.pageId, selection: [active.panelId] }, mutate(project) {
    for (const image of editableCropImages(active.base, active.panelId)) (project.layers[image.id] as ImageLayer).crop = structuredClone((active.preview.layers[image.id] as ImageLayer).crop);
  } }); return result.ok ? ok(undefined) : result;
}
