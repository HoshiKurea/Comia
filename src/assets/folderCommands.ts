import { getProject } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { execute } from '../history/commandBus';
import { newId } from '../domain/id';
import { migrateProject } from '../storage/migrateProject';
import { fail, ok, problem, type Id, type Project, type Result } from '../domain/types';
import { emptyAssetLibrary, libraryNameKey, normalizedLibraryName, validLibraryName, validateAssetLibrary } from './folderModel';

const orgFor = (p: Project) => p.assetLibrary ?? emptyAssetLibrary(p.libraryAssetIds);
function edit(label: string, mutate: (draft: Project) => void): Result<void> {
  const result = execute({ label, context: { pageId: sessionStore.getState().activePageId, selection: sessionStore.getState().selection }, mutate(draft) {
    if (draft.schemaVersion < 8) { const next = migrateProject(draft); if (!next.ok) throw Error(next.problems[0].message); Object.assign(draft, next.value); }
    draft.assetLibrary ??= emptyAssetLibrary(draft.libraryAssetIds); mutate(draft);
    const check = validateAssetLibrary(draft.assetLibrary, draft.libraryAssetIds ?? []); if (!check.ok) throw Error(check.problems[0].message);
  } }); return result.ok ? ok(undefined) : result;
}
function checkName(p: Project, name: string, parentId: Id | null, except?: Id): Result<string> {
  const org = orgFor(p), value = normalizedLibraryName(name);
  if (!validLibraryName(value)) return fail(problem('folder/name', '文件夹名称须为1～80个字符，不能含控制字符'));
  if (parentId && !Object.hasOwn(org.folders,parentId)) return fail(problem('folder/parent', '目标文件夹已不存在'));
  if (Object.values(org.folders).some(f => f.id !== except && f.parentId === parentId && libraryNameKey(f.name) === libraryNameKey(value))) return fail(problem('folder/name', '上级目录已有同名文件夹'));
  return ok(value);
}
export function createAssetFolder(name: string, parentId: Id | null): Result<Id> {
  const checked = checkName(getProject(), name, parentId); if (!checked.ok) return checked;
  const id = newId(), result = edit('新建素材文件夹', draft => { draft.assetLibrary!.folders[id] = { id, name: checked.value, parentId }; }); return result.ok ? ok(id) : result;
}
export function renameAssetFolder(id: Id, name: string): Result<void> {
  const org=orgFor(getProject());if(!Object.hasOwn(org.folders,id))return fail(problem('folder/missing','文件夹已不存在'));const folder=org.folders[id];
  const checked = checkName(getProject(), name, folder.parentId, id); if (!checked.ok) return checked;
  return edit('重命名素材文件夹', draft => { draft.assetLibrary!.folders[id].name = checked.value; });
}
export function moveAssetFolder(id: Id, parentId: Id | null): Result<void> {
  const org = orgFor(getProject()), folder = Object.hasOwn(org.folders,id)?org.folders[id]:null; if (!folder) return fail(problem('folder/missing', '文件夹已不存在'));
  for (let current = parentId; current; current = org.folders[current]?.parentId ?? null) if (current === id) return fail(problem('folder/cycle', '不能把文件夹移入自身或下级目录'));
  const checked = checkName(getProject(), folder.name, parentId, id); if (!checked.ok) return checked;
  return edit('移动素材文件夹', draft => { draft.assetLibrary!.folders[id].parentId = parentId; });
}
export function moveLibraryAssets(ids: readonly Id[], folderId: Id | null): Result<void> {
  const p = getProject(); if ((folderId && !orgFor(p).folders[folderId]) || !ids.length || ids.some(id => !(p.libraryAssetIds ?? []).includes(id))) return fail(problem('folder/asset', '素材或目标文件夹已失效'));
  return edit('移动素材到文件夹', draft => { for (const id of ids) draft.assetLibrary!.assetFolder[id] = folderId; });
}
export function removeAssetFolder(id: Id): Result<void> {
  if (!Object.hasOwn(orgFor(getProject()).folders,id)) return fail(problem('folder/missing', '文件夹已不存在'));
  return edit('删除文件夹，内容移到上级', draft => {
    const org = draft.assetLibrary!, parentId = org.folders[id].parentId;
    const occupied = new Set(Object.values(org.folders).filter(f => f.parentId === parentId && f.id !== id).map(f => libraryNameKey(f.name)));
    for (const child of Object.values(org.folders).filter(f => f.parentId === id)) {
      const original = child.name; let index = 2;
      while (occupied.has(libraryNameKey(child.name))) { const suffix = ` (${index++})`; child.name = Array.from(original).slice(0, 80 - suffix.length).join('') + suffix; }
      occupied.add(libraryNameKey(child.name)); child.parentId = parentId;
    }
    for (const assetId of Object.keys(org.assetFolder)) if (org.assetFolder[assetId] === id) org.assetFolder[assetId] = parentId;
    delete org.folders[id];
  });
}
