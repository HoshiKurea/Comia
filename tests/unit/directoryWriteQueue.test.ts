import { describe, expect, it } from 'vitest';
import { DirectoryWriteQueue } from '../../src/storage/directoryWriteQueue';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const target = (name: string) => ({ name, isSameEntry: async (other: { name: string }) => name === other.name }) as unknown as FileSystemDirectoryHandle;
describe('directory target snapshot queues', () => {
  it('never replaces a running snapshot, merges only pending same bindings and returns the actually saved receipt to every waiter', async () => {
    const queue = new DirectoryWriteQueue<string>(), handle = target('a'), key = {}, entered = deferred<void>(), finish = deferred<string>(), writes: string[] = [];
    const first = queue.enqueue(handle, key, async () => { writes.push('first'); entered.resolve(); return finish.promise; });
    await entered.promise;
    const second = queue.enqueue(handle, key, async () => { writes.push('obsolete'); return 'obsolete'; });
    const third = queue.enqueue(handle, key, async () => { writes.push('latest'); return 'latest'; });
    // Let the alias resolution lane enqueue both before releasing the in-flight write.
    await new Promise((resolve) => setTimeout(resolve, 0)); finish.resolve('first');
    expect(await Promise.all([first, second, third])).toEqual(['first', 'latest', 'latest']); expect(writes).toEqual(['first', 'latest']);
  });
  it('lets a different target progress and never merges it merely because its project binding is the same', async () => {
    const queue = new DirectoryWriteQueue<string>(), key = {}, entered = deferred<void>(), finish = deferred<string>();
    const first = queue.enqueue(target('a'), key, async () => { entered.resolve(); return finish.promise; }); await entered.promise;
    expect(await queue.enqueue(target('b'), key, async () => 'copy-b')).toBe('copy-b'); finish.resolve('a'); expect(await first).toBe('a');
  });
  it('serializes alias handles while retaining independent bindings rather than silently saving a different project', async () => {
    const queue = new DirectoryWriteQueue<string>(), entered = deferred<void>(), finish = deferred<string>(), order: string[] = [];
    const first = queue.enqueue(target('same'), {}, async () => { order.push('a-start'); entered.resolve(); const result = await finish.promise; order.push('a-end'); return result; }); await entered.promise;
    const second = queue.enqueue(target('same'), {}, async () => { order.push('b'); return 'b'; });
    await new Promise((resolve) => setTimeout(resolve, 0)); expect(order).toEqual(['a-start']); finish.resolve('a'); expect(await Promise.all([first, second])).toEqual(['a', 'b']); expect(order).toEqual(['a-start', 'a-end', 'b']);
  });
  it('rejects failed receipts without stalling pending or future saves and releases idle target handles', async () => {
    const queue = new DirectoryWriteQueue<string>(), handle = target('a'), key = {};
    await expect(queue.enqueue(handle, key, async () => { throw Error('disk failure'); })).rejects.toThrow('disk failure');
    expect(await queue.enqueue(handle, key, async () => 'retry')).toBe('retry');
  });
});
