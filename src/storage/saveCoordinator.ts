import type { Id, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { readDirectoryGeneration } from './directorySave';
import { checkSaveLock, registerSaveLockGuard } from './saveLockGuard';

const DB_NAME = 'comia-save-leases-v1';
const STORE = 'leases';
const OWNER = crypto.randomUUID();
const LEASE_MS = 30_000;
const RENEW_MS = 10_000;
const queues = new Map<string, Promise<unknown>>();

interface Lease { projectId: string; owner: string; expiresAt: number }

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'projectId' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function leaseTransaction(projectId: string, owner: string, action: 'acquire' | 'renew' | 'release'): Promise<boolean> {
  const db = await database();
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const request = store.get(projectId);
      let granted = false;
      request.onsuccess = () => {
        const now = Date.now();
        const old = request.result as Lease | undefined;
        if (action === 'acquire') {
          // A clock rollback cannot extend an old lease beyond one lease interval.
          granted = !old || old.expiresAt <= now || old.expiresAt > now + LEASE_MS;
          if (granted) store.put({ projectId, owner, expiresAt: now + LEASE_MS } satisfies Lease);
        } else if (old?.owner === owner) {
          granted = action === 'release' || old.expiresAt > now && old.expiresAt <= now + LEASE_MS;
          if (action === 'release') store.delete(projectId);
          else if (granted) store.put({ projectId, owner, expiresAt: now + LEASE_MS } satisfies Lease);
        }
      };
      tx.oncomplete = () => resolve(granted);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function withLease<T>(projectId: Id, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const owner = `${OWNER}:${crypto.randomUUID()}`, start = performance.now();
  while (!await leaseTransaction(projectId, owner, 'acquire')) {
    if (performance.now() - start >= LEASE_MS) throw new Error('等待其他标签页保存超时');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const controller = new AbortController();
  let deadline = performance.now() + LEASE_MS, lastWall = Date.now(), stopped = false;
  let pending: Promise<void> | null = null;
  const renew = (): Promise<void> => {
    if (pending) return pending;
    pending = (async () => {
      if (stopped || controller.signal.aborted) return;
      const monotonic = performance.now(), wall = Date.now();
      if (monotonic >= deadline || wall < lastWall) { controller.abort(); return; }
      try {
        const valid = await leaseTransaction(projectId, owner, 'renew');
        if (!valid || Date.now() < wall || performance.now() >= monotonic + LEASE_MS) controller.abort();
        else { deadline = monotonic + LEASE_MS; lastWall = wall; }
      } catch { controller.abort(); }
    })().finally(() => { pending = null; });
    return pending;
  };
  const unregister = registerSaveLockGuard(controller.signal, renew);
  const timer = setInterval(() => { void renew(); }, RENEW_MS);
  try {
    await checkSaveLock(controller.signal);
    const result = await fn(controller.signal);
    await checkSaveLock(controller.signal);
    return result;
  } finally {
    stopped = true;
    clearInterval(timer);
    unregister();
    await pending;
    try { await leaseTransaction(projectId, owner, 'release'); } catch { /* expired lease remains bounded */ }
  }
}

/** Serializes this tab's writes, then holds an origin-wide project lock for the write sequence. */
export function withProjectSaveLock<T>(projectId: Id, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const previous = queues.get(projectId) ?? Promise.resolve();
  const work: Promise<T> = previous.catch(() => undefined).then(async () => {
    if (navigator.locks?.request) return await navigator.locks.request(`comia-save:${projectId}`, { mode: 'exclusive' }, async () => await fn(new AbortController().signal));
    return await withLease(projectId, fn);
  });
  queues.set(projectId, work);
  void work.finally(() => { if (queues.get(projectId) === work) queues.delete(projectId); }).catch(() => undefined);
  return work;
}

export async function detectGenerationConflict(handle: FileSystemDirectoryHandle, expected: Id | null): Promise<Result<Id | null>> {
  try {
    const actual = await readDirectoryGeneration(handle);
    return actual === expected ? ok(actual) : fail(problem('directory/conflict', '目录已被其他标签页或程序修改，请重新加载、另存副本或取消'));
  } catch { return fail(problem('directory/current-corrupt', '目录版本指针损坏，请打开目录选择恢复版本')); }
}

const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('comia-directory-generations-v1') : null;
export function announceDirectoryGeneration(projectId: Id, generation: Id): void { channel?.postMessage({ projectId, generation }); }
export function onDirectoryGeneration(listener: (projectId: Id, generation: Id) => void): () => void {
  if (!channel) return () => undefined;
  const handler = (event: MessageEvent) => {
    const value = event.data as { projectId?: unknown; generation?: unknown };
    if (typeof value?.projectId === 'string' && typeof value?.generation === 'string') listener(value.projectId, value.generation);
  };
  channel.addEventListener('message', handler);
  return () => channel.removeEventListener('message', handler);
}
