import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { createProject } from '../../src/domain/factories';
import { addObject } from '../../src/app/actions';
import { documentStore, getDocument } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';
import { runtimeStore } from '../../src/state/runtimeStore';
import { undo } from '../../src/history/commandBus';
import { createWorkspace, switchWorkspace, openWorkspace, workspaceStore, closeActiveWorkspace, hasUnsavedWorkspaces } from '../../src/projects/workspaces';
import { getActiveFileHandle, setActiveFileHandle } from '../../src/storage/fileSave';
import { getDirectoryBinding, setDirectoryBinding } from '../../src/storage/directorySession';
import { installRecovery, listRecoveries } from '../../src/storage/recovery';

describe('multiple workspace lifecycle', () => {
  it('restores independent history, page session, save targets and unsaved protection', async () => {
    installRecovery(); const p = createProject(); p.name = 'A'; expect((await createWorkspace(p)).ok).toBe(true);
    const a = workspaceStore.getState().activeId, pageId = p.pageOrder[0]; const created = addObject('rect-panel', pageId, { x: 10, y: 20 }); if (!created.ok) throw Error('object');
    sessionStore.setState({ selection: [created.value], viewportByPage: { [pageId]: { pan: { x: 45, y: 60 }, zoom: 2 } } });
    const file = { name: 'A.json' } as FileSystemFileHandle, dir = { handle: { name: 'A' } as FileSystemDirectoryHandle, generation: 'g1', projectId: p.id };
    setActiveFileHandle(file); setDirectoryBinding(dir); const oldHistory = getDocument().history;
    const bProject = createProject(); bProject.name = 'B'; expect((await createWorkspace(bProject)).ok).toBe(true); const b = workspaceStore.getState().activeId;
    expect(getActiveFileHandle()).toBeNull(); expect(getDirectoryBinding()).toBeNull(); expect(getDocument().history.past).toHaveLength(0);
    documentStore.setState({ savedStateId: getDocument().history.stateId }); expect(hasUnsavedWorkspaces()).toBe(true);
    expect((await switchWorkspace(a)).ok).toBe(true); expect(getDocument().history).toBe(oldHistory); expect(getActiveFileHandle()).toBe(file); expect(getDirectoryBinding()).toBe(dir);
    expect(sessionStore.getState().selection).toEqual([created.value]); expect(sessionStore.getState().viewportByPage[pageId]).toEqual({ pan: { x: 45, y: 60 }, zoom: 2 });
    expect(undo().ok).toBe(true); expect(getDocument().project.layers[created.value]).toBeUndefined();
    expect((await switchWorkspace(b)).ok).toBe(true); expect(getDocument().project.name).toBe('B'); expect(getDocument().history.past).toHaveLength(0);
    const drafts = await listRecoveries(); expect(drafts.ok && drafts.value.some(d => d.projectName === 'A')).toBe(true);
  });
  it('retains undo-only bitmaps while parked, releases them on final close, and rejects preview or failed opens', async () => {
    const p = createProject(); p.name = 'resource'; await createWorkspace(p); const a = workspaceStore.getState().activeId;
    const close = vi.fn(), bitmap = { close } as unknown as ImageBitmap;
    runtimeStore.setState({ blobs: new Map([['undo-only', new Blob(['old'])]]), images: new Map([['undo-only', bitmap]]) });
    await createWorkspace(createProject()); expect(close).not.toHaveBeenCalled(); await switchWorkspace(a); expect(runtimeStore.getState().images.get('undo-only')).toBe(bitmap);
    runtimeStore.setState({ gestureActive: true }); expect((await createWorkspace(createProject())).ok).toBe(false); runtimeStore.setState({ gestureActive: false });
    const count = workspaceStore.getState().tabs.length; const result = await openWorkspace(async () => ({ ok: false as const, problems: [{ code: 'invalid', message: 'bad' }] })); expect(result.ok).toBe(false); expect(workspaceStore.getState().tabs).toHaveLength(count);
    await closeActiveWorkspace(createProject()); expect(close).toHaveBeenCalledTimes(1);
  });
  it('rejects a concurrent switch while preserving a transaction committed during recovery flush', async () => {
    const p = createProject(); p.name = 'concurrency'; await createWorkspace(p);
    const active = workspaceStore.getState().activeId, count = workspaceStore.getState().tabs.length;
    const pending = createWorkspace(createProject());
    expect((await createWorkspace(createProject())).ok).toBe(false);
    const added = addObject('rect-panel', p.pageOrder[0], { x: 31, y: 47 }); if (!added.ok) throw Error(JSON.stringify(added));
    const changed = getDocument(); expect((await pending).ok).toBe(false);
    expect(workspaceStore.getState().activeId).toBe(active); expect(workspaceStore.getState().tabs).toHaveLength(count);
    expect(getDocument().project).toBe(changed.project); expect(getDocument().history).toBe(changed.history);
    expect(sessionStore.getState().selection).toEqual([added.value]);
  });
});
