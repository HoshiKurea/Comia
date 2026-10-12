import { fail, ok, problem, type AssetLibraryOrganization, type Id, type Result } from '../domain/types';
import { isUuid } from '../domain/id';

export const FOLDER_LIMITS = { count: 256, depth: 8 } as const;
export function normalizedLibraryName(value: string): string { return value.trim().normalize('NFC'); }
export function libraryNameKey(value: string): string { return normalizedLibraryName(value).toLowerCase(); }
export function validLibraryName(value: unknown): value is string {
  return typeof value === 'string' && value === normalizedLibraryName(value) && Array.from(value).length > 0 && Array.from(value).length <= 80 && !/[\u0000-\u001f\u007f]/.test(value);
}
export function emptyAssetLibrary(ids: readonly Id[] = []): AssetLibraryOrganization {
  return { folders: {}, assetFolder: Object.fromEntries(ids.map(id => [id, null])) };
}
export function folderAncestors(org: AssetLibraryOrganization, id: Id): Result<Id[]> {
  const ids: Id[] = [], seen = new Set<Id>(); let current: Id | null = id;
  while (current !== null) {
    if (seen.has(current) || !org.folders[current]) return fail(problem('folder/tree', '素材文件夹存在环或失效的上级'));
    seen.add(current); ids.unshift(current); current = org.folders[current].parentId;
    if (ids.length > FOLDER_LIMITS.depth) return fail(problem('folder/depth', '素材文件夹最多8层'));
  }
  return ok(ids);
}
export function validateAssetLibrary(value: unknown, assetIds: readonly Id[], occupiedIds: ReadonlySet<Id> = new Set()): Result<AssetLibraryOrganization> {
  const bad = (text: string) => fail(problem('folder/invalid', text));
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('素材目录格式无效');
  const org = value as AssetLibraryOrganization;
  if (!org.folders || typeof org.folders !== 'object' || Array.isArray(org.folders) || !org.assetFolder || typeof org.assetFolder !== 'object' || Array.isArray(org.assetFolder)) return bad('素材目录和归属映射无效');
  if (Object.keys(org.folders).length > FOLDER_LIMITS.count) return bad('素材文件夹最多256个');
  const names = new Set<string>();
  for (const [id, folder] of Object.entries(org.folders)) {
    if (!isUuid(id) || occupiedIds.has(id) || !folder || folder.id !== id || !validLibraryName(folder.name) || (folder.parentId !== null && !isUuid(folder.parentId))) return bad('文件夹ID、名称或上级无效');
    const key = `${folder.parentId ?? ''}:${libraryNameKey(folder.name)}`;
    if (names.has(key)) return bad('同一文件夹内不能使用重复目录名称'); names.add(key);
    const ancestors = folderAncestors(org, id); if (!ancestors.ok) return ancestors;
  }
  const set = new Set(assetIds);
  if (Object.keys(org.assetFolder).length !== set.size) return bad('每张库素材必须有且只有一个目录归属');
  for (const [id, folderId] of Object.entries(org.assetFolder)) if (!set.has(id) || (folderId !== null && !org.folders[folderId])) return bad('素材目录引用已失效');
  return ok(structuredClone(org));
}
