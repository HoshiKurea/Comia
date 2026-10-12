import { assetReferences } from '../assets/references';
import type { Id, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { onBusEvent, replaceDocument } from '../history/commandBus';
import { getDocument, documentStore } from '../state/documentStore';
import { runtimeStore } from '../state/runtimeStore';
import { pushNotice, sessionStore } from '../state/sessionStore';
import { registerRecoveryReferences, replaceRuntimeResources, scheduleBlobCollection } from './blobRepository';
import { migrateProject } from './migrateProject';

const DB_NAME = 'comia-recovery-v1';
const STORE = 'drafts';
type RecoveryBlob = { hash: string; blob: Blob } | { hash: string; bytes: Uint8Array; mimeType: string };
interface RecoveryRecord { key: Id; project: Project; stateId: Id; createdAt: number; blobs: RecoveryBlob[] }
export interface RecoveryCandidate { key: Id; projectName: string; createdAt: number; layerCount: number }
// Each live tab owns a generation slot. Reloaded tabs discover the old slot via
// getAll; they never overwrite another live tab's draft of the same project.
const TAB_ID = crypto.randomUUID();
let workspaceOwner = '';
const recoveryKey = (projectId: Id) => `${projectId}:${TAB_ID}${workspaceOwner ? `:${workspaceOwner}` : ''}`;
type RestoredSource = { key: Id; stateId: Id; projectId: Id } | null;
let restoredSource: RestoredSource = null;
export interface RecoveryBinding { owner: string; source: RestoredSource }
export function getRecoveryBinding(): RecoveryBinding { return { owner: workspaceOwner, source: restoredSource }; }
export function setRecoveryBinding(binding: RecoveryBinding): void { workspaceOwner = binding.owner; restoredSource = binding.source; }
let restoreSequence = 0;
const CLOSE_PREFIX = 'comia-recovery-closed:';
function lastNormalClose(key: Id): number | null {
  try {
    const raw = localStorage.getItem(CLOSE_PREFIX + key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  } catch { return null; }
}
function clearNormalClose(key: Id): void { try { localStorage.removeItem(CLOSE_PREFIX + key); } catch { /* retain recovery when storage is unavailable */ } }

/** Only a verified externally saved document qualifies as a safe close. Dirty reloads retain recovery. */
export function recordNormalClose(): void {
  const doc = getDocument();
  if (doc.savedStateId !== doc.history.stateId || sessionStore.getState().textEditingId || runtimeStore.getState().gestureActive) return;
  sequence++;
  if (timer) clearTimeout(timer); timer = null;
  try { localStorage.setItem(CLOSE_PREFIX + recoveryKey(doc.project.id), JSON.stringify(Date.now())); }
  catch { /* fail open: never hide a recoverable draft on close-marker failure */ }
}

let dbPromise: Promise<IDBDatabase> | null = null;
function database(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const opening = indexedDB.open(DB_NAME, 1);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error('自动恢复数据库无法打开'));
  });
  return dbPromise.catch((error) => { dbPromise = null; throw error; });
}

async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const operation = run(tx.objectStore(STORE));
    let value: T;
    operation.onsuccess = () => { value = operation.result; };
    operation.onerror = () => { /* transaction.onabort reports the error */ };
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => reject(tx.error ?? operation.error ?? new Error('自动恢复写入失败'));
    tx.onerror = () => reject(tx.error ?? new Error('自动恢复事务失败'));
  });
}

function referencedHashes(project: Project): Set<string> {
  const hashes = new Set<string>();
  for (const id of assetReferences(project)) {
    const asset = project.assets[id];
    if (asset) { hashes.add(asset.originalHash); hashes.add(asset.renderHash); }
  }
  return hashes;
}

let sequence = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let installed = false;
// Some Windows WebKit builds cannot persist native Blob/File values in IndexedDB.
// Keep native Blob storage where supported, and remember a verified serialization failure for this tab.
let binaryRecovery = false;

export function scheduleRecovery(): void {
  sequence++;
  if (timer) clearTimeout(timer);
  const ticket = sequence;
  timer = setTimeout(() => {
    timer = null;
    const idle = (globalThis as typeof globalThis & { requestIdleCallback?: (callback: () => void, options: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(() => { void persistRecovery(ticket); }, { timeout: 1000 });
    else void persistRecovery(ticket);
  }, 2000);
}

async function persistRecovery(ticket: number): Promise<boolean> {
  if (ticket !== sequence) return false;
  const doc = getDocument();
  if (doc.savedStateId === doc.history.stateId) return true;
  const project = structuredClone(doc.project);
  const stateId = doc.history.stateId;
  const runtime = runtimeStore.getState();
  const blobs: RecoveryBlob[] = [];
  for (const hash of referencedHashes(project)) {
    const blob = runtime.blobs.get(hash);
    if (!blob) { pushNotice('error', '自动恢复不可用：图片数据缺失，请导出项目文件'); return false; }
    blobs.push({ hash, blob });
  }
  try {
    const db = await database();
    const stale = () => ticket !== sequence || doc.epoch !== getDocument().epoch || doc.project.id !== getDocument().project.id || getDocument().savedStateId === stateId;
    const bytes = async (): Promise<RecoveryBlob[]> => Promise.all(blobs.map(async item => 'blob' in item ? { hash: item.hash, bytes: new Uint8Array(await item.blob.arrayBuffer()), mimeType: item.blob.type } : item));
    // One atomic transaction still commits the document and all resource bytes together.
    const write = async (entries: RecoveryBlob[]) => { if (stale()) return; await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE), source = restoredSource?.projectId === project.id ? restoredSource : null;
      tx.oncomplete = () => {
        // A put already started before pagehide may complete after the safe-close marker.
        // Only a still-current dirty generation may clear that marker.
        if (ticket === sequence && getDocument().epoch === doc.epoch && getDocument().savedStateId !== stateId) clearNormalClose(recoveryKey(project.id));
        if (restoredSource === source) restoredSource = null; resolve();
      };
      tx.onabort = () => reject(tx.error ?? new Error('自动恢复写入失败'));
      tx.onerror = (event) => reject((event.target as IDBRequest).error ?? tx.error ?? new Error('自动恢复事务失败'));
      try {
        store.put({ key: recoveryKey(project.id), project, stateId, createdAt: Date.now(), blobs: entries } satisfies RecoveryRecord);
        // Adopt an old/legacy recovery only after the new complete generation
        // commits; a quota failure aborts both put and delete together.
        if (source && source.key !== recoveryKey(project.id)) {
          const old = store.get(source.key) as IDBRequest<RecoveryRecord | undefined>;
          old.onsuccess = () => { if (old.result?.stateId === source.stateId) store.delete(source.key); };
        }
      } catch (error) { tx.abort(); reject(error); }
    }); };
    if (binaryRecovery) await write(await bytes());
    else {
      try { await write(blobs); }
      catch (error) {
        const failure = error as DOMException;
        if (failure.name !== 'DataCloneError' && !(failure.name === 'UnknownError' && /preparing Blob\/File data/i.test(failure.message))) throw error;
        binaryRecovery = true; await write(await bytes());
      }
    }
    return !stale();
  } catch {
    pushNotice('error', '自动恢复不可用，请导出项目文件');
    return false;
  }
}

/** Finish the active workspace's draft before parking it; inactive work has no running timer. */
export async function flushRecovery(): Promise<boolean> {
  sequence++; if (timer) clearTimeout(timer); timer = null;
  return persistRecovery(sequence);
}
export async function discardCurrentRecovery(): Promise<Result<void>> {
  return discardWorkspaceRecovery(getDocument().project.id, getRecoveryBinding());
}
export async function discardWorkspaceRecovery(projectId: Id, binding: RecoveryBinding): Promise<Result<void>> {
  const ownKey = `${projectId}:${TAB_ID}${binding.owner ? `:${binding.owner}` : ''}`, source = binding.source;
  if (binding.owner === workspaceOwner) { sequence++; if (timer) clearTimeout(timer); timer = null; }
  const result = await discardRecovery(ownKey);
  if (result.ok && source?.projectId === projectId && source.key !== ownKey) return discardRecovery(source.key);
  return result;
}

export function installRecovery(): void {
  if (installed || typeof indexedDB === 'undefined') return;
  installed = true;
  window.addEventListener('pagehide', (event) => { if (!event.persisted) recordNormalClose(); });
  registerRecoveryReferences(async () => { const records = await transact('readonly', (store) => store.getAll() as IDBRequest<RecoveryRecord[]>); return new Set(records.flatMap((record) => record.blobs.map((blob) => blob.hash))); });
  onBusEvent((event) => {
    if (event.type === 'documentReplaced') {
      restoredSource = null; sequence++;
      if (timer) clearTimeout(timer); timer = null;
    }
    if (event.type === 'documentChanged') scheduleRecovery();
  });
}

export async function listRecoveries(): Promise<Result<RecoveryCandidate[]>> {
  if (typeof indexedDB === 'undefined') return fail(problem('recovery/unavailable', '浏览器不支持自动恢复数据库'));
  try {
    const records = await transact('readonly', (store) => store.getAll() as IDBRequest<RecoveryRecord[]>);
    return ok(records.filter((record) => { const closedAt = lastNormalClose(record.key); return closedAt === null || record.createdAt > closedAt; }).sort((a, b) => b.createdAt - a.createdAt).map((record) => ({ key: record.key, projectName: record.project.name, createdAt: record.createdAt, layerCount: Object.keys(record.project.layers).length })));
  } catch (error) { return fail(problem('recovery/read', `无法读取自动恢复：${(error as Error).message}`)); }
}

async function sha256(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function restoreRecovery(key: Id): Promise<Result<void>> {
  const initial = getDocument(), ticket = ++restoreSequence;
  const stale = () => ticket !== restoreSequence || getDocument().epoch !== initial.epoch || getDocument().history.stateId !== initial.history.stateId;
  try {
    const record = await transact('readonly', (store) => store.get(key) as IDBRequest<RecoveryRecord | undefined>);
    if (!record) return fail(problem('recovery/missing', '恢复草稿不存在'));
    const migrated = migrateProject(record.project); if (!migrated.ok) return migrated;
    record.project = migrated.value;
    const blobs = new Map<string, Blob>();
    for (const item of record.blobs) {
      const blob = 'blob' in item ? item.blob : new Blob([new Uint8Array(item.bytes)], { type: item.mimeType });
      if (await sha256(blob) !== item.hash) return fail(problem('recovery/hash', '恢复草稿素材校验失败'));
      blobs.set(item.hash, blob);
    }
    for (const hash of referencedHashes(record.project)) if (!blobs.has(hash)) return fail(problem('recovery/blob-missing', '恢复草稿缺少图片'));
    const images = new Map<string, ImageBitmap>();
    try {
      for (const asset of Object.values(record.project.assets)) {
        const blob = blobs.get(asset.renderHash);
        if (blob && !images.has(asset.renderHash)) images.set(asset.renderHash, await createImageBitmap(blob));
      }
    } catch (error) { for (const image of images.values()) image.close(); return fail(problem('recovery/decode', `恢复图片解码失败：${(error as Error).message}`)); }
    if (stale() || runtimeStore.getState().gestureActive || sessionStore.getState().textEditingId) {
      for (const image of images.values()) image.close();
      return fail(problem('recovery/stale', '恢复期间作品已改变，保留当前编辑；请重新选择恢复草稿'));
    }
    const replaced = replaceDocument(record.project);
    if (!replaced.ok) { for (const image of images.values()) image.close(); return replaced; }
    replaceRuntimeResources(blobs, images);
    restoredSource = { key: record.key, stateId: record.stateId, projectId: record.project.id };
    documentStore.setState({ savedStateId: null });
    return ok(undefined);
  } catch (error) { return fail(problem('recovery/read', `恢复失败：${(error as Error).message}`)); }
}

export async function discardRecovery(key: Id): Promise<Result<void>> {
  try { await transact('readwrite', (store) => store.delete(key)); clearNormalClose(key); scheduleBlobCollection(); return ok(undefined); }
  catch (error) { return fail(problem('recovery/delete', `无法丢弃恢复草稿：${(error as Error).message}`)); }
}

export async function markRecoverySaved(projectId: Id, stateId: Id): Promise<void> {
  const ownKey = recoveryKey(projectId), source = restoredSource?.projectId === projectId ? restoredSource : null;
  try {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE);
      const read = store.get(ownKey) as IDBRequest<RecoveryRecord | undefined>;
      read.onsuccess = () => { if (read.result?.stateId === stateId) store.delete(ownKey); };
      if (source) {
        const inherited = store.get(source.key) as IDBRequest<RecoveryRecord | undefined>;
        inherited.onsuccess = () => { if (inherited.result?.stateId === source.stateId) store.delete(source.key); };
      }
      tx.oncomplete = () => { if (restoredSource === source) restoredSource = null; resolve(); }; tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error);
    });
    scheduleBlobCollection();
  } catch { /* verified file save remains valid even if recovery maintenance fails */ }
}
