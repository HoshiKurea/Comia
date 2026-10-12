import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentProject as createProject } from '../helpers/contentProject';
import { execute, replaceDocument } from '../../src/history/commandBus';
import { getDocument } from '../../src/state/documentStore';
import { saveToDirectory, resetDirectorySession } from '../../src/storage/directorySession';
const mocks = vi.hoisted(() => ({ save: vi.fn(), recover: vi.fn() }));
vi.mock('../../src/storage/directorySave', () => ({ saveDirectory: mocks.save }));
vi.mock('../../src/storage/recovery', () => ({ markRecoverySaved: mocks.recover }));
vi.mock('../../src/storage/saveCoordinator', () => ({ withProjectSaveLock: async (_id: string, fn: (signal: AbortSignal) => Promise<unknown>) => fn(new AbortController().signal), announceDirectoryGeneration: vi.fn(), onDirectoryGeneration: () => undefined }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const handle = (name: string) => ({ name, isSameEntry: async (other: { name: string }) => name === other.name }) as unknown as FileSystemDirectoryHandle;
const receipt = (stateId: string, generation: string) => ({ ok: true as const, value: { stateId, generation, mode: 'directory' as const, verified: true, completedAt: Date.now() } });
const originalPicker = Object.getOwnPropertyDescriptor(window, 'showDirectoryPicker'), originalSecure = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
beforeEach(() => { resetDirectorySession(); mocks.save.mockReset(); mocks.recover.mockReset(); replaceDocument(createProject()); Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true }); });
afterEach(() => { resetDirectorySession(); if (originalPicker) Object.defineProperty(window, 'showDirectoryPicker', originalPicker); else Reflect.deleteProperty(window, 'showDirectoryPicker'); if (originalSecure) Object.defineProperty(window, 'isSecureContext', originalSecure); else Reflect.deleteProperty(window, 'isSecureContext'); });
function rename(name: string) { const doc = getDocument(); expect(execute({ label: 'name', context: { pageId: doc.project.pageOrder[0], selection: [] }, mutate(project) { project.name = name; } }).ok).toBe(true); return getDocument().history.stateId; }
describe('frozen directory save requests', () => {
  it('writes first then latest queued snapshot, shares only the normal picker, returns latest receipt and clears dirty only for actual saved state', async () => {
    const entered = deferred<void>(), finish = deferred<void>(), picker = vi.fn(async () => handle('normal')); Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: picker });
    mocks.save.mockImplementationOnce(async (_handle, snapshot, expected) => { expect(expected).toBeNull(); entered.resolve(); await finish.promise; return receipt(snapshot.stateId, 'g1'); })
      .mockImplementationOnce(async (_handle, snapshot, expected) => { expect(expected).toBe('g1'); return receipt(snapshot.stateId, 'g2'); });
    const firstId = getDocument().history.stateId, first = saveToDirectory(); await entered.promise;
    rename('obsolete'); const second = saveToDirectory(); const latestId = rename('latest'); const third = saveToDirectory();
    await new Promise((resolve) => setTimeout(resolve, 0)); expect(getDocument().savedStateId).toBeNull(); finish.resolve();
    const results = await Promise.all([first, second, third]); expect(results).toEqual([receipt(firstId, 'g1'), receipt(latestId, 'g2'), receipt(latestId, 'g2')].map((r, i) => ({ ...r, value: { ...r.value, completedAt: results[i].ok ? results[i].value.completedAt : 0 } })));
    expect(mocks.save).toHaveBeenCalledTimes(2); expect(mocks.save.mock.calls.map((call) => call[1].project.name)).toEqual(['未命名项目', 'latest']); expect(picker).toHaveBeenCalledOnce(); expect(getDocument().savedStateId).toBe(latestId);
  });
  it('keeps an explicit copy target and snapshot independent while an older normal save is pending', async () => {
    const entered = deferred<void>(), finish = deferred<void>(), a = handle('a'), b = handle('b');
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: vi.fn().mockResolvedValueOnce(a).mockResolvedValueOnce(b) });
    mocks.save.mockImplementation(async (target, snapshot) => { if (target === a) { entered.resolve(); await finish.promise; } return receipt(snapshot.stateId, target.name); });
    const first = saveToDirectory(); await entered.promise; const copyId = rename('copy'); const copy = await saveToDirectory(true); expect(copy.ok && copy.value.stateId).toBe(copyId); finish.resolve(); await first;
    // The old completion must not move the active target back from b to a.
    await saveToDirectory(); expect(mocks.save.mock.calls.map((call) => call[0].name)).toEqual(['a', 'b', 'b']); expect(mocks.save.mock.calls[0][1].project.name).not.toBe('copy');
  });
  it('does not attach an old picker target to a replacement project with the same project ID', async () => {
    const picked = deferred<FileSystemDirectoryHandle>(), picker = vi.fn().mockReturnValueOnce(picked.promise).mockResolvedValue(handle('new'));
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: picker }); mocks.save.mockImplementation(async (target, snapshot) => receipt(snapshot.stateId, target.name));
    const first = saveToDirectory(), replacement = structuredClone(getDocument().project); replacement.name = 'new epoch'; replaceDocument(replacement); picked.resolve(handle('old')); await first; expect(getDocument().savedStateId).toBeNull();
    await saveToDirectory(); expect(picker).toHaveBeenCalledTimes(2); expect(mocks.save.mock.calls.map((call) => call[0].name)).toEqual(['old', 'new']);
  });
  it('a failed picker can be retried and a failed queued write never marks dirty state saved', async () => {
    const picker = vi.fn().mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError')).mockResolvedValue(handle('retry')); Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: picker });
    mocks.save.mockResolvedValue({ ok: false, problems: [{ code: 'directory/write', message: 'disk failure' }] }); expect((await saveToDirectory()).ok).toBe(false); expect((await saveToDirectory()).ok).toBe(false); expect(picker).toHaveBeenCalledTimes(2); expect(getDocument().savedStateId).toBeNull();
  });
});
