import type { Id, ImageLayer, PanelLayer, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { multiply, scaling, translation } from '../geometry/matrix';
import { resolveCrop, cropFromMapping } from './crop';
import { execute } from '../history/commandBus';
import { getProject } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { bindImagesToPanel } from './panelAssociation';
import { createLayer } from '../domain/factories';

export function promoteMaterials(project: Project): void {
  if (project.schemaVersion < 3) { project.schemaVersion = 3; project.libraryAssetIds = Object.keys(project.assets); }
}
export function freeImage(project: Project, id: Id): ImageLayer {
  const image = project.layers[id]; if (image?.type !== 'image') throw Error('目标不是图片');
  if (!image.crop) return image;
  const panel = image.parentId ? project.layers[image.parentId] : null; if (panel?.type !== 'panel') throw Error('旧裁剪缺少分镜');
  const m = resolveCrop(panel.geometry, { x: image.width, y: image.height }, image.crop);
  return { ...image, crop: null, matrix: multiply(image.matrix, multiply(translation(m.tx, m.ty), scaling(m.scale, m.scale))) };
}
export function enableFreeImage(id: Id): Result<void> {
  const project = getProject(), image = project.layers[id];
  if (image?.type !== 'image' || effectiveLayerFlags(project, id).locked || !effectiveLayerFlags(project, id).visible) return fail(problem('image/locked', '请先选择可见且未锁定的图片'));
  const result = execute({ label: '自由编辑素材', context: { pageId: image.pageId, selection: sessionStore.getState().selection }, afterSelection: [id], mutate(draft) { promoteMaterials(draft); draft.layers[id] = freeImage(draft, id); } });
  return result.ok ? ok(undefined) : result;
}
/** Binding changes only container ownership, never fits or rescales the original. */
export function bindImageToPanel(id: Id, panelId: Id): Result<void> {
  return bindImagesToPanel([id], panelId);
}
export function clonePanelImage(source: ImageLayer, oldPanel: PanelLayer, nextPanel: PanelLayer): ImageLayer {
  const image = createLayer('image', source.pageId, source.name) as ImageLayer;
  Object.assign(image, structuredClone(source), { id: image.id, parentId: nextPanel.id });
  if (source.crop) image.crop = cropFromMapping(nextPanel.geometry, { x: source.width, y: source.height }, resolveCrop(oldPanel.geometry, { x: source.width, y: source.height }, source.crop));
  return image;
}
