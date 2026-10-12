import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContentProject as createProject, toLegacy } from '../helpers/contentProject';
import { replaceDocument } from '../../src/history/commandBus';
import { addObject } from '../../src/app/actions';
import { documentStore, getDocument, getProject } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';
import { discardRecovery, installRecovery, listRecoveries, markRecoverySaved, recordNormalClose, restoreRecovery, scheduleRecovery } from '../../src/storage/recovery';

async function recoveryDb() {
  return new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('comia-recovery-v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
async function putDraft(key: string, project: ReturnType<typeof createProject>, stateId: string) {
  const db = await recoveryDb();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction('drafts', 'readwrite'); tx.objectStore('drafts').put({ key, project, stateId, createdAt: Date.now(), blobs: [] }); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 2250));
afterEach(() => { vi.restoreAllMocks(); });

describe('automatic local recovery', () => {
  it('restores legacy drafts as editable schema seven and rejects an unknown version without replacing current work', async () => {
    installRecovery(); expect((await listRecoveries()).ok).toBe(true); const legacy = toLegacy(createProject(), 1); const key = `${legacy.id}:legacy-extension`;
    await putDraft(key, legacy, crypto.randomUUID()); replaceDocument(createProject());
    expect((await restoreRecovery(key)).ok).toBe(true); expect(getProject().schemaVersion).toBe(10); expect(toLegacy(getProject(), 1)).toEqual(legacy); expect(legacy.schemaVersion).toBe(1);
    const before = getDocument(), broken = { ...legacy, schemaVersion: 8 } as unknown as ReturnType<typeof createProject>;
    await putDraft(`${key}:invalid`, broken, crypto.randomUUID()); expect((await restoreRecovery(`${key}:invalid`)).ok).toBe(false);
    expect(getDocument()).toBe(before); await discardRecovery(key); await discardRecovery(`${key}:invalid`);
  });
  it('filters only the safe-closed tab generation, retains peer and dirty reload drafts, and permits newer records', async () => {
    installRecovery(); const project = createProject(); replaceDocument(project); addObject('rect-panel', project.pageOrder[0], { x: 40, y: 50 }); await settle();
    const listed = await listRecoveries(); if (!listed.ok) throw Error('list');
    const own = listed.value.find((entry) => entry.key.startsWith(`${project.id}:`))!;
    expect(own).toBeDefined(); recordNormalClose();
    expect((await listRecoveries()).ok && JSON.stringify(await listRecoveries())).toContain(own.key);
    await putDraft(`${project.id}:peer`, project, 'peer');
    documentStore.setState({ savedStateId: getDocument().history.stateId }); recordNormalClose();
    const after = await listRecoveries(); if (!after.ok) throw Error('list');
    expect(after.value.some((entry) => entry.key === own.key)).toBe(false); expect(after.value.some((entry) => entry.key === `${project.id}:peer`)).toBe(true);
    // A later successfully committed dirty generation clears the marker, even after wall-clock rollback.
    vi.spyOn(Date, 'now').mockReturnValue(1); addObject('rect-panel', project.pageOrder[0], { x: 80, y: 80 }); await settle();
    const newer = await listRecoveries(); if (!newer.ok) throw Error('list'); expect(newer.value.find((entry) => entry.key === own.key)?.layerCount).toBe(2);
    vi.restoreAllMocks(); await discardRecovery(own.key); await discardRecovery(`${project.id}:peer`);
  });
  it('does not hide a recovery when the synchronous normal-close marker cannot be written', async () => {
    installRecovery(); const project = createProject(); replaceDocument(project); addObject('rect-panel', project.pageOrder[0], { x: 40, y: 50 }); await settle();
    const listed = await listRecoveries(); if (!listed.ok) throw Error('list'); const key = listed.value.find((entry) => entry.key.startsWith(`${project.id}:`))!.key;
    documentStore.setState({ savedStateId: getDocument().history.stateId });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    expect(() => recordNormalClose()).not.toThrow(); const after = await listRecoveries(); if (!after.ok) throw Error('list'); expect(after.value.some((entry) => entry.key === key)).toBe(true);
    vi.restoreAllMocks(); await discardRecovery(key);
  });
  it('writes a complete generation after debounce and restores an unsaved tree', async () => {
    installRecovery();
    expect(replaceDocument(createProject()).ok).toBe(true);
    const pageId = getProject().pageOrder[0];
    expect(addObject('rect-panel', pageId, { x: 40, y: 50 }).ok).toBe(true);
    const originalId = getProject().id;
    await new Promise((resolve) => setTimeout(resolve, 2250));
    const listed = await listRecoveries();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const candidate = listed.value.find((entry) => entry.key.startsWith(`${originalId}:`));
    expect(candidate?.layerCount).toBe(1);
    expect(replaceDocument(createProject()).ok).toBe(true);
    expect(Object.keys(getProject().layers)).toHaveLength(0);
    expect((await restoreRecovery(candidate!.key)).ok).toBe(true);
    expect(Object.keys(getProject().layers)).toHaveLength(1);
    expect(getDocument().savedStateId).toBeNull();
    expect((await discardRecovery(candidate!.key)).ok).toBe(true);
    const after = await listRecoveries();
    expect(after.ok && after.value.some((entry) => entry.key === candidate!.key)).toBe(false);
  });

  it('preserves another tab draft while writing and marking this tab snapshot saved', async () => {
    installRecovery(); const project = createProject(); replaceDocument(project); const peerKey = `${project.id}:other-tab`;
    await putDraft(peerKey, project, 'peer-state'); addObject('rect-panel', project.pageOrder[0], { x: 40, y: 50 }); await settle();
    const listed = await listRecoveries(); expect(listed.ok).toBe(true); if (!listed.ok) return;
    expect(listed.value.filter((item) => item.key.startsWith(`${project.id}:`))).toHaveLength(2);
    await markRecoverySaved(project.id, getDocument().history.stateId);
    const after = await listRecoveries(); expect(after.ok && after.value.some((item) => item.key === peerKey)).toBe(true);
    expect(after.ok && after.value.filter((item) => item.key.startsWith(`${project.id}:`))).toHaveLength(1);
    await discardRecovery(peerKey);
  });

  it('quota failure leaves the previous complete generation and dirty marker intact while editing can continue', async () => {
    installRecovery(); const project = createProject(); replaceDocument(project); addObject('rect-panel', project.pageOrder[0], { x: 40, y: 50 }); await settle();
    const before = await listRecoveries(); expect(before.ok).toBe(true); if (!before.ok) return;
    const key = before.value.find((item) => item.key.startsWith(`${project.id}:`))!.key;
    addObject('rect-panel', project.pageOrder[0], { x: 80, y: 80 }); const marker = getDocument().savedStateId;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('quota full', 'QuotaExceededError'); });
    scheduleRecovery(); await settle();
    expect(getDocument().savedStateId).toBe(marker); expect(getDocument().savedStateId).not.toBe(getDocument().history.stateId);
    const after = await listRecoveries(); expect(after.ok && after.value.find((item) => item.key === key)?.layerCount).toBe(1);
    expect(sessionStore.getState().notices.some((notice) => notice.message.includes('自动恢复不可用'))).toBe(true);
    expect(addObject('rect-panel', project.pageOrder[0], { x: 100, y: 100 }).ok).toBe(true);
    vi.restoreAllMocks(); await discardRecovery(key);
  });

  it('does not overwrite an edit made while an asynchronous recovery read is pending', async () => {
    installRecovery(); const source = createProject(), key = source.id; await putDraft(key, source, 'legacy-state');
    replaceDocument(createProject()); const pending = restoreRecovery(key); addObject('rect-panel', getProject().pageOrder[0], { x: 10, y: 10 });
    const current = getProject(); const result = await pending; expect(result.ok).toBe(false); if (!result.ok) expect(result.problems[0].code).toBe('recovery/stale'); expect(getProject()).toEqual(current);
    await discardRecovery(key);
  });

  it('adopts a legacy project-key draft only after the new generation commits', async () => {
    installRecovery(); const project = createProject(); await putDraft(project.id, project, 'legacy-state');
    expect((await restoreRecovery(project.id)).ok).toBe(true); addObject('rect-panel', project.pageOrder[0], { x: 20, y: 20 }); await settle();
    const listed = await listRecoveries(); expect(listed.ok).toBe(true); if (!listed.ok) return;
    expect(listed.value.some((item) => item.key === project.id)).toBe(false); expect(listed.value.find((item) => item.key.startsWith(`${project.id}:`))?.layerCount).toBe(1);
    await markRecoverySaved(project.id, getDocument().history.stateId);
  });
  it('replacing a document cancels the prior debounce instead of writing a phantom empty new-project recovery', async () => {
    installRecovery(); const old = createProject(); replaceDocument(old); addObject('rect-panel', old.pageOrder[0], { x: 10, y: 10 }); const next = createProject(); replaceDocument(next); await settle();
    const listed = await listRecoveries(); expect(listed.ok).toBe(true); if (!listed.ok) return;
    expect(listed.value.some((item) => item.key.startsWith(`${next.id}:`) || item.key.startsWith(`${old.id}:`))).toBe(false);
  });
});
