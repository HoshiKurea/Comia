import type { Id, ImageLayer, Point, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { createLayer } from '../domain/factories';
import { execute } from '../history/commandBus';
import { getProject } from '../state/documentStore';
import { runtimeStore } from '../state/runtimeStore';
import { sessionStore, pushNotice } from '../state/sessionStore';
import { decodeImage, type DecodedAsset } from './importImage';
import { makeAsyncToken, isTokenCurrent } from '../history/asyncGuard';
import { inverse, multiply, worldMatrix } from '../geometry/matrix';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { emptyAssetLibrary } from './folderModel';

export function installDecodedAssets(assets: DecodedAsset[]): void {
  const runtime = runtimeStore.getState(), images = new Map(runtime.images), blobs = new Map(runtime.blobs);
  for (const asset of assets) {
    if (!blobs.has(asset.meta.originalHash)) blobs.set(asset.meta.originalHash, asset.original);
    if (!blobs.has(asset.meta.renderHash)) blobs.set(asset.meta.renderHash, asset.render);
    if (images.has(asset.meta.renderHash)) asset.bitmap.close(); else images.set(asset.meta.renderHash, asset.bitmap);
  }
  runtimeStore.setState({ blobs, images });
}
export function addLibraryAssets(assets: DecodedAsset[], folderId: Id | null = null): Result<Id[]> {
  if (!assets.length) return fail(problem('library/empty', '请选择图片文件'));
  const project = getProject(), pageId = sessionStore.getState().activePageId, metas = { ...project.assets }, ids: Id[] = [];
  if (folderId && !project.assetLibrary?.folders[folderId]) return fail(problem('library/folder', '导入目标文件夹已不存在'));
  for (const asset of assets) {
    const same = Object.values(metas).find(meta => meta.originalHash === asset.meta.originalHash && meta.renderHash === asset.meta.renderHash && meta.drawingSourceHash === asset.meta.drawingSourceHash);
    const id = same?.id ?? asset.meta.id; metas[id] = same ?? asset.meta; ids.push(id);
  }
  const result = execute({ label: `导入${assets.length}张素材`, context: { pageId, selection: sessionStore.getState().selection }, mutate(draft) {
    if (draft.schemaVersion < 3) draft.schemaVersion = 3;
    draft.assets = metas; draft.libraryAssetIds = [...new Set([...(draft.libraryAssetIds ?? []), ...ids])];
    if (draft.schemaVersion >= 8) { draft.assetLibrary ??= emptyAssetLibrary(); for (const id of ids) if (!(id in draft.assetLibrary.assetFolder)) draft.assetLibrary.assetFolder[id] = folderId; }
  } });
  if (!result.ok) return result;
  installDecodedAssets(assets);const repeated=ids.filter(id=>(project.libraryAssetIds??[]).includes(id)).length;if(repeated)pushNotice('info',`${repeated} 张相同素材已在库中，保留原分类`);return ok([...new Set(ids)]);
}
/** Entire batch commits once. Replacing the project or cancelling closes every temporary bitmap. */
export async function importLibraryFiles(files: File[], signal: AbortSignal, folderId: Id | null = null): Promise<Result<Id[]>> {
  if (folderId && !getProject().assetLibrary?.folders[folderId]) return fail(problem('library/folder', '导入目标文件夹已不存在'));
  const token = makeAsyncToken(null), decoded: DecodedAsset[] = [];
  for (const file of files) {
    if (signal.aborted || !isTokenCurrent(token)) { decoded.forEach(asset => asset.bitmap.close()); return fail(problem('library/cancelled', '作品已变化或导入已取消')); }
    const result = await decodeImage(file, signal);
    if (!result.ok) { decoded.forEach(asset => asset.bitmap.close()); return fail(...result.problems.map(p => ({ ...p, message: `${file.name}：${p.message}；本批素材未导入` }))); }
    decoded.push(result.value);
  }
  if (signal.aborted || !isTokenCurrent(token)) { decoded.forEach(asset => asset.bitmap.close()); return fail(problem('library/cancelled', '作品已变化或导入已取消')); }
  const result = addLibraryAssets(decoded, folderId); if (!result.ok) decoded.forEach(asset => asset.bitmap.close()); return result;
}
export function removeLibraryAsset(id: Id): Result<void> {
  const project = getProject();
  if (!(project.libraryAssetIds ?? []).includes(id)) return fail(problem('library/missing', '素材已不在库中'));
  const result = execute({ label: '移出素材库', context: { pageId: sessionStore.getState().activePageId, selection: sessionStore.getState().selection }, mutate(draft) { draft.libraryAssetIds = draft.libraryAssetIds!.filter(value => value !== id); if (draft.assetLibrary) delete draft.assetLibrary.assetFolder[id]; } });
  return result.ok ? ok(undefined) : result;
}
export function placeLibraryAsset(assetId: Id, pageId: Id, point?: Point, targetPanelId?: Id): Result<Id> {
  const project = getProject(), meta = project.assets[assetId], page = project.pages[pageId];
  if (!meta || !page || !(project.libraryAssetIds ?? []).includes(assetId)) return fail(problem('library/target', '素材或页面已失效'));
  if (!runtimeStore.getState().images.has(meta.renderHash)) return fail(problem('library/resource', '素材显示图未就绪，未创建空图层'));
  const panel = targetPanelId ? project.layers[targetPanelId] : null;
  if (targetPanelId && (panel?.type !== 'panel' || panel.role !== 'leaf' || panel.pageId !== pageId || effectiveLayerFlags(project, targetPanelId).locked || !effectiveLayerFlags(project, targetPanelId).visible)) return fail(problem('library/panel', '请选择同页可见且未锁定的叶子分镜'));
  const image = createLayer('image', pageId, Array.from(meta.name).slice(0, 80).join('')) as ImageLayer;
  image.assetId = assetId; image.width = meta.width; image.height = meta.height;
  const s = Math.max(.0002, Math.min(1, page.width / (meta.width * 2), page.height / (meta.height * 2))), p = point ?? { x: page.width / 2, y: page.height / 2 };
  image.matrix = [s, 0, 0, s, p.x - meta.width * s / 2, p.y - meta.height * s / 2];
  if (panel?.type === 'panel') { const inv = inverse(worldMatrix(project, panel.id)); if (!inv.ok) return inv; image.matrix = multiply(inv.value, image.matrix); image.parentId = panel.id; }
  const result = execute({ label: '放置素材', context: { pageId, selection: sessionStore.getState().selection }, afterSelection: [image.id], mutate(draft) { draft.layers[image.id] = image; const target = image.parentId ? draft.layers[image.parentId] : null; if (target?.type === 'panel') target.children.push(image.id); else draft.pages[pageId].roots.push(image.id); } });
  return result.ok ? ok(image.id) : result;
}
