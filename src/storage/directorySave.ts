import { migrateProject } from './migrateProject';
import type { Id, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { newId } from '../domain/id';
import { LIMITS, LIMIT_ASSET_TOTAL_BYTES } from '../domain/limits';
import { detectImageFormat } from '../assets/inspectFormat';
import { assetMimeMap, prepareProjectForStorage, requiredHashes } from './codec';
import { checkSaveLock } from './saveLockGuard';

export interface DirectorySnapshot { project: Project; stateId: Id; blobs: Map<string, Blob> }
export interface DirectorySaveReceipt { stateId: Id; mode: 'directory'; generation: Id; completedAt: number }
export interface DirectoryBlobRef { hash: string; mime: string; bytes: number; path: string }
export interface DirectoryManifest {
  format: 'ComiaDirectory'; version: 1; generation: Id; previousGeneration: Id | null; createdAt: number;
  project: Project; blobs: DirectoryBlobRef[];
}
export interface CurrentPointer { generation: Id; manifestHash: string }
export interface DirectoryCandidate { generation: Id; createdAt: number; projectName: string; layerCount: number }
export type DirectoryOpen =
  | { kind: 'loaded'; generation: Id; project: Project; blobs: Map<string, Blob> }
  | { kind: 'recoverable'; candidates: DirectoryCandidate[]; pointerFingerprint: string | null };

const HASH = /^[0-9a-f]{64}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg' };
const MAX_MANIFEST = 16 * 1024 * 1024;
class DirectoryConflict extends Error {}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function notFound(error: unknown): boolean { return error instanceof DOMException && error.name === 'NotFoundError' || Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'NotFoundError'); }
async function digest(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function fileOrNull(directory: FileSystemDirectoryHandle, name: string): Promise<File | null> {
  try { return await (await directory.getFileHandle(name)).getFile(); }
  catch (error) { if (notFound(error)) return null; throw error; }
}
async function directoryOrNull(directory: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle | null> {
  try { return await directory.getDirectoryHandle(name); }
  catch (error) { if (notFound(error)) return null; throw error; }
}
async function writeAndVerify(directory: FileSystemDirectoryHandle, name: string, data: Blob, signal?: AbortSignal, beforeCommit?: (createdPlaceholder: boolean) => Promise<void>): Promise<void> {
  await checkSaveLock(signal);
  // Native getFileHandle(create:true) creates an empty file immediately, before
  // the writable's staged contents become visible. Keep this provenance so a
  // commit guard can distinguish its own placeholder from prior corruption.
  const createdPlaceholder = await fileOrNull(directory, name) === null;
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await checkSaveLock(signal);
    await writable.write(data);
    await beforeCommit?.(createdPlaceholder);
    await checkSaveLock(signal);
    await writable.close();
  }
  catch (error) { try { await writable.abort(); } catch { /* original write error is authoritative */ } throw error; }
  const readback = await handle.getFile();
  if (readback.size !== data.size || await digest(readback) !== await digest(data)) throw new Error(`${name} 写入后读回校验失败`);
}
function parseJson(file: File, maxBytes: number): Promise<unknown> {
  if (file.size > maxBytes) throw new Error('目录元数据超出大小上限');
  return file.text().then((text) => JSON.parse(text) as unknown);
}
async function parsePointer(file: File | null): Promise<CurrentPointer | null> {
  if (!file) return null;
  const raw = await parseJson(file, 4096);
  if (!raw || typeof raw !== 'object' || !('generation' in raw) || !('manifestHash' in raw) || typeof raw.generation !== 'string' || !ID.test(raw.generation) || typeof raw.manifestHash !== 'string' || !HASH.test(raw.manifestHash)) throw new Error('current.json 指针无效');
  return { generation: raw.generation, manifestHash: raw.manifestHash };
}
async function readPointer(handle: FileSystemDirectoryHandle): Promise<CurrentPointer | null> {
  return parsePointer(await fileOrNull(handle, 'current.json'));
}
async function pointerBeforeCommit(handle: FileSystemDirectoryHandle, createdPlaceholder: boolean): Promise<File | null> {
  const file = await fileOrNull(handle, 'current.json');
  // Only a file known to have been absent immediately before this writer
  // created it may stand for absence; an existing empty pointer stays corrupt.
  return createdPlaceholder && file?.size === 0 ? null : file;
}
async function fingerprintFile(file: File | null): Promise<string | null> {
  if (!file) return null;
  // Oversized pointers cannot be valid; bound recovery work without reading an attacker-sized file into RAM.
  return file.size <= 4096 ? digest(file) : `oversized:${file.size}:${file.lastModified}:${await digest(file.slice(0, 4096))}`;
}
export async function readDirectoryGeneration(handle: FileSystemDirectoryHandle): Promise<Id | null> {
  return (await readPointer(handle))?.generation ?? null;
}
function parseManifest(raw: unknown, generation: string): Result<DirectoryManifest> {
  if (!raw || typeof raw !== 'object') return fail(problem('directory/manifest', '目录manifest格式无效'));
  const value = raw as Partial<DirectoryManifest>;
  if (value.format !== 'ComiaDirectory' || value.version !== 1 || value.generation !== generation || !ID.test(generation) || value.previousGeneration !== null && (typeof value.previousGeneration !== 'string' || !ID.test(value.previousGeneration)) || !Number.isSafeInteger(value.createdAt) || value.createdAt! < 0 || !Array.isArray(value.blobs)) return fail(problem('directory/manifest', '目录manifest头部无效'));
  const checked = migrateProject(value.project);
  if (!checked.ok) return checked;
  const expectedMimes = assetMimeMap(checked.value);
  if (!expectedMimes.ok) return expectedMimes;
  const required = requiredHashes(checked.value), seen = new Set<string>();
  let total = 0;
  for (const item of value.blobs) {
    if (!item || typeof item !== 'object' || typeof item.hash !== 'string' || !HASH.test(item.hash) || typeof item.mime !== 'string' || !(item.mime in EXT) || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || typeof item.path !== 'string' || item.path !== `blobs/${item.hash}.${EXT[item.mime]}` || seen.has(item.hash)) return fail(problem('directory/blob-ref', '目录素材引用无效或路径越界'));
    if (item.mime !== expectedMimes.value.get(item.hash)) return fail(problem('directory/blob-mime', '目录素材类型与项目记录不符'));
    seen.add(item.hash); total += item.bytes;
    if (total > LIMIT_ASSET_TOTAL_BYTES) return fail(problem('directory/budget', '目录素材总量超出512MiB'));
  }
  if (required.size !== seen.size || [...required].some((hash) => !seen.has(hash))) return fail(problem('directory/blob-ref', '目录manifest缺少或多出素材引用'));
  return ok({ ...value, project: checked.value } as DirectoryManifest);
}
async function readGeneration(handle: FileSystemDirectoryHandle, generation: Id, expectedHash?: string): Promise<Result<{ manifest: DirectoryManifest; blobs: Map<string, Blob> }>> {
  if (!ID.test(generation)) return fail(problem('directory/generation', '目录版本号无效'));
  const manifests = await directoryOrNull(handle, 'manifests');
  if (!manifests) return fail(problem('directory/manifest-missing', '目录缺少manifest文件夹'));
  const file = await fileOrNull(manifests, `${generation}.json`);
  if (!file) return fail(problem('directory/manifest-missing', '目录版本manifest缺失'));
  if (file.size > MAX_MANIFEST) return fail(problem('directory/manifest-large', '目录manifest过大'));
  if (expectedHash && await digest(file) !== expectedHash) return fail(problem('directory/manifest-hash', 'current指向的manifest校验失败'));
  let raw: unknown;
  try { raw = await parseJson(file, MAX_MANIFEST); }
  catch { return fail(problem('directory/manifest-json', '目录manifest无法解析'));
  }
  const parsed = parseManifest(raw, generation);
  if (!parsed.ok) return parsed;
  const folder = await directoryOrNull(handle, 'blobs');
  if (!folder && parsed.value.blobs.length) return fail(problem('directory/blobs-missing', '目录缺少素材文件夹'));
  const blobs = new Map<string, Blob>();
  for (const ref of parsed.value.blobs) {
    const entry = await fileOrNull(folder!, ref.path.slice('blobs/'.length));
    if (!entry || entry.size !== ref.bytes || await digest(entry) !== ref.hash) return fail(problem('directory/blob-hash', `素材 ${ref.hash} 缺失或校验失败`));
    const bytes = new Uint8Array(await entry.arrayBuffer());
    const kind = detectImageFormat(bytes);
    if (kind !== ref.mime) return fail(problem('directory/blob-format', `素材 ${ref.hash} 格式与manifest不符`));
    blobs.set(ref.hash, new Blob([bytes], { type: ref.mime }));
  }
  return ok({ manifest: parsed.value, blobs });
}
async function scanCandidates(handle: FileSystemDirectoryHandle): Promise<DirectoryCandidate[]> {
  const folder = await directoryOrNull(handle, 'manifests');
  if (!folder) return [];
  const candidates: DirectoryCandidate[] = [];
  let count = 0;
  const entries = (folder as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
  for await (const [name, entry] of entries) {
    if (++count > 1000) throw new Error('目录版本数量超过扫描上限');
    if (entry.kind !== 'file' || !/^[0-9a-f-]{36}\.json$/i.test(name)) continue;
    const generation = name.slice(0, -5);
    const loaded = await readGeneration(handle, generation);
    if (loaded.ok) candidates.push({ generation, createdAt: loaded.value.manifest.createdAt, projectName: loaded.value.manifest.project.name, layerCount: Object.keys(loaded.value.manifest.project.layers).length });
  }
  return candidates.sort((a, b) => b.createdAt - a.createdAt || b.generation.localeCompare(a.generation));
}

export async function loadDirectory(handle: FileSystemDirectoryHandle): Promise<Result<DirectoryOpen>> {
  try {
    const pointerFile = await fileOrNull(handle, 'current.json');
    const fingerprint = await fingerprintFile(pointerFile);
    let pointer: CurrentPointer | null = null;
    try { pointer = await parsePointer(pointerFile); } catch { /* scan complete versions below */ }
    if (pointer) {
      const loaded = await readGeneration(handle, pointer.generation, pointer.manifestHash);
      if (loaded.ok) return ok({ kind: 'loaded', generation: pointer.generation, project: loaded.value.manifest.project, blobs: loaded.value.blobs });
    }
    const candidates = await scanCandidates(handle);
    return candidates.length ? ok({ kind: 'recoverable', candidates, pointerFingerprint: fingerprint }) : fail(problem('directory/empty', '目录没有可读取的完整Comia版本'));
  } catch (error) { return fail(problem('directory/read', `读取目录失败：${errorMessage(error)}`)); }
}

export async function loadDirectoryCandidate(handle: FileSystemDirectoryHandle, generation: Id): Promise<Result<DirectoryOpen>> {
  try {
    const loaded = await readGeneration(handle, generation);
    return loaded.ok ? ok({ kind: 'loaded', generation, project: loaded.value.manifest.project, blobs: loaded.value.blobs }) : loaded;
  } catch (error) { return fail(problem('directory/read', `读取目录失败：${errorMessage(error)}`)); }
}

export async function activateDirectoryCandidate(handle: FileSystemDirectoryHandle, generation: Id, expectedFingerprint: string | null, signal?: AbortSignal): Promise<Result<void>> {
  try {
    const assertUnchanged = async (createdPlaceholder = false) => { if (await fingerprintFile(await pointerBeforeCommit(handle, createdPlaceholder)) !== expectedFingerprint) throw new DirectoryConflict('选择恢复版本期间目录已变化，请重新打开目录'); };
    await checkSaveLock(signal);
    await assertUnchanged();
    const loaded = await readGeneration(handle, generation);
    if (!loaded.ok) return loaded;
    const manifests = await handle.getDirectoryHandle('manifests');
    const file = await (await manifests.getFileHandle(`${generation}.json`)).getFile();
    const current = new Blob([JSON.stringify({ generation, manifestHash: await digest(file) } satisfies CurrentPointer)], { type: 'application/json' });
    await writeAndVerify(handle, 'current.json', current, signal, assertUnchanged);
    return ok(undefined);
  } catch (error) { return fail(problem(error instanceof DirectoryConflict ? 'directory/conflict' : 'directory/recovery-write', `恢复目录指针失败：${errorMessage(error)}`)); }
}

export async function saveDirectory(handle: FileSystemDirectoryHandle, snapshot: DirectorySnapshot, expectedGeneration: Id | null, signal?: AbortSignal): Promise<Result<DirectorySaveReceipt>> {
  try {
    await checkSaveLock(signal);
    const prepared = prepareProjectForStorage(snapshot.project);
    if (!prepared.ok) return prepared;
    const project = prepared.value;
    const expectedMimes = assetMimeMap(project);
    if (!expectedMimes.ok) return expectedMimes;
    let pointer: CurrentPointer | null;
    try { pointer = await readPointer(handle); }
    catch { return fail(problem('directory/current-corrupt', '目录指针损坏；请先打开目录选择可恢复版本'));
    }
    if ((pointer?.generation ?? null) !== (expectedGeneration ?? null)) return fail(problem('directory/conflict', '目录版本已变化；请选择重新加载、另存副本或取消'));
    if (!pointer && (await scanCandidates(handle)).length) return fail(problem('directory/recovery-needed', '目录有未指向的完整版本；请先选择恢复版本'));
    const hashes = [...requiredHashes(project)].sort(), mimes = expectedMimes.value;
    const refs: DirectoryBlobRef[] = [];
    let total = 0;
    const folder = await handle.getDirectoryHandle('blobs', { create: true });
    for (const hash of hashes) {
      await checkSaveLock(signal);
      const blob = snapshot.blobs.get(hash), mime = mimes.get(hash);
      if (!blob || !mime || !(mime in EXT) || (blob.type !== '' && blob.type !== mime) || await digest(blob) !== hash || detectImageFormat(new Uint8Array(await blob.arrayBuffer())) !== mime) return fail(problem('directory/source-blob', `素材 ${hash} 缺失、类型不符或哈希不一致`));
      total += blob.size;
      if (total > LIMIT_ASSET_TOTAL_BYTES) return fail(problem('directory/budget', '目录素材总量超出512MiB'));
      const name = `${hash}.${EXT[mime]}`, existing = await fileOrNull(folder, name);
      if (existing) {
        if (existing.size !== blob.size || await digest(existing) !== hash) return fail(problem('directory/blob-collision', `已有素材 ${hash} 内容不一致`));
      } else await writeAndVerify(folder, name, blob, signal);
      refs.push({ hash, mime, bytes: blob.size, path: `blobs/${name}` });
    }
    const generation = newId();
    const manifest: DirectoryManifest = { format: 'ComiaDirectory', version: 1, generation, previousGeneration: expectedGeneration, createdAt: Date.now(), project, blobs: refs };
    const manifestBlob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    await checkSaveLock(signal);
    if (manifestBlob.size > MAX_MANIFEST || manifestBlob.size > LIMITS.maxProjectBytes) return fail(problem('directory/manifest-large', '目录manifest过大'));
    const manifests = await handle.getDirectoryHandle('manifests', { create: true });
    if (await fileOrNull(manifests, `${generation}.json`)) return fail(problem('directory/generation-collision', '新版本号已经存在'));
    await writeAndVerify(manifests, `${generation}.json`, manifestBlob, signal);
    await checkSaveLock(signal);
    const latest = await readPointer(handle);
    if ((latest?.generation ?? null) !== (expectedGeneration ?? null)) return fail(problem('directory/conflict', '写入期间目录版本已变化，保留manifest供恢复'));
    const current = new Blob([JSON.stringify({ generation, manifestHash: await digest(manifestBlob) } satisfies CurrentPointer)], { type: 'application/json' });
    await checkSaveLock(signal);
    await writeAndVerify(handle, 'current.json', current, signal, async (createdPlaceholder) => {
      const beforeClose = await parsePointer(await pointerBeforeCommit(handle, createdPlaceholder));
      if ((beforeClose?.generation ?? null) !== expectedGeneration) throw new DirectoryConflict('提交前目录版本已变化，保留manifest供恢复');
    });
    return ok({ stateId: snapshot.stateId, mode: 'directory', generation, completedAt: Date.now() });
  } catch (error) { return fail(problem(error instanceof DirectoryConflict ? 'directory/conflict' : 'directory/write', `目录保存失败：${errorMessage(error)}`)); }
}
