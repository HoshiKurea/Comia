import { afterEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { withProjectSaveLock } from '../../src/storage/saveCoordinator';
import { checkSaveLock } from '../../src/storage/saveLockGuard';

const originalLocks = navigator.locks;
afterEach(() => { vi.restoreAllMocks(); Object.defineProperty(navigator, 'locks', { configurable: true, value: originalLocks }); });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function leaseRecord(projectId: string, replacement?: { owner: string; expiresAt: number }) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('comia-save-leases-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('leases', { keyPath: 'projectId' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<{ owner: string; expiresAt: number } | undefined>((resolve, reject) => {
      const tx = db.transaction('leases', 'readwrite'), store = tx.objectStore('leases');
      const request = store.get(projectId);
      request.onsuccess = () => { if (replacement) store.put({ projectId, ...replacement }); };
      tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

describe('project save coordination', () => {
  it('serializes three same-project writes while allowing a different project to proceed', async () => {
    const lockQueues = new Map<string, Promise<unknown>>();
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: (name: string, _options: unknown, fn: () => Promise<unknown>) => {
        const previous = lockQueues.get(name) ?? Promise.resolve();
        const next = previous.then(fn);
        lockQueues.set(name, next.catch(() => undefined));
        return next;
      },
    } });
    const events: string[] = [];
    const project = crypto.randomUUID(), other = crypto.randomUUID();
    const run = (label: string, id: string) => withProjectSaveLock(id, async () => {
      events.push(`${label}:start`);
      await pause(10);
      events.push(`${label}:end`);
      return label;
    });
    expect(await Promise.all([run('a', project), run('b', project), run('c', project), run('x', other)])).toEqual(['a', 'b', 'c', 'x']);
    expect(events.indexOf('a:end')).toBeLessThan(events.indexOf('b:start'));
    expect(events.indexOf('b:end')).toBeLessThan(events.indexOf('c:start'));
    expect(events.indexOf('x:start')).toBeLessThan(events.indexOf('c:start'));
  });

  it('uses an IndexedDB lease when Web Locks are absent', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    const events: string[] = [], project = crypto.randomUUID();
    const run = (label: string) => withProjectSaveLock(project, async (signal) => {
      expect(signal.aborted).toBe(false);
      events.push(`${label}:start`);
      await pause(5);
      events.push(`${label}:end`);
      return label;
    });
    expect(await Promise.all([run('one'), run('two')])).toEqual(['one', 'two']);
    expect(events).toEqual(['one:start', 'one:end', 'two:start', 'two:end']);
  });

  it('takes over an expired crashed-tab lease and removes only its own lease on completion', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    const project = crypto.randomUUID();
    await leaseRecord(project, { owner: 'crashed-tab', expiresAt: Date.now() - 1 });
    await withProjectSaveLock(project, async (signal) => {
      await checkSaveLock(signal);
      expect((await leaseRecord(project))?.owner).not.toBe('crashed-tab');
    });
    expect(await leaseRecord(project)).toBeUndefined();
  });

  it('aborts when another tab replaces the owner, and does not release the replacement lease', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    const project = crypto.randomUUID();
    await expect(withProjectSaveLock(project, async (signal) => {
      await leaseRecord(project, { owner: 'new-holder', expiresAt: Date.now() + 30_000 });
      await checkSaveLock(signal);
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect((await leaseRecord(project))?.owner).toBe('new-holder');
  });

  it.each(['expiration', 'rollback'] as const)('refuses a write checkpoint after %s without waiting for the timer', async (kind) => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    const wall = Date.now(), monotonic = performance.now();
    const wallClock = vi.spyOn(Date, 'now').mockReturnValue(wall);
    const localClock = vi.spyOn(performance, 'now').mockReturnValue(monotonic);
    await expect(withProjectSaveLock(crypto.randomUUID(), async (signal) => {
      if (kind === 'expiration') { localClock.mockReturnValue(monotonic + 30_001); wallClock.mockReturnValue(wall + 30_001); }
      else wallClock.mockReturnValue(wall - 60_000);
      await checkSaveLock(signal);
    })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('times out waiting using monotonic time when wall time does not advance', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    const project = crypto.randomUUID(), wall = Date.now();
    await leaseRecord(project, { owner: 'busy-tab', expiresAt: wall + 30_000 });
    vi.spyOn(Date, 'now').mockReturnValue(wall);
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(30_001);
    await expect(withProjectSaveLock(project, async () => 'must not run')).rejects.toThrow('等待其他标签页保存超时');
    expect((await leaseRecord(project))?.owner).toBe('busy-tab');
  });
});
