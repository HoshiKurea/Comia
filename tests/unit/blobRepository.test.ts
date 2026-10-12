import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import { getDocument, getProject, documentStore } from '../../src/state/documentStore';
import { runtimeStore } from '../../src/state/runtimeStore';
import { sessionStore } from '../../src/state/sessionStore';
import { clearHistory, execute, replaceDocument, undo, redo } from '../../src/history/commandBus';
import { clearClipboard, copyToClipboard, pasteFromClipboard } from '../../src/layers/clipboard';
import { collectUnreferencedBlobs, registerRecoveryReferences, replaceRuntimeResources, retainResources } from '../../src/storage/blobRepository';
const hash = 'a'.repeat(64), other = 'b'.repeat(64);
function fixture() {
  const project = createProject(), pageId = project.pageOrder[0], image = createLayer('image', pageId); if (image.type !== 'image') throw Error('factory');
  image.assetId = crypto.randomUUID(); image.width = image.height = 32; project.layers[image.id] = image; project.pages[pageId].roots = [image.id];
  project.assets[image.assetId] = { id: image.assetId, name: '图片', originalMime: 'image/png', originalHash: hash, renderHash: hash, renderMime: 'image/png', width: 32, height: 32, originalBytes: 1, renderBytes: 1, framePolicy: 'still', normalizedOrientation: true };
  expect(replaceDocument(project).ok).toBe(true); sessionStore.setState({ activePageId: pageId, selection: [image.id], textEditingId: null, toolMode: 'select' });
  const bitmap = { close: vi.fn(), width: 32, height: 32 } as unknown as ImageBitmap; replaceRuntimeResources(new Map([[hash, new Blob(['a'])]]), new Map([[hash, bitmap]]));
  return { project, pageId, image, bitmap };
}
beforeEach(() => { clearClipboard(); registerRecoveryReferences(async () => new Set()); runtimeStore.setState({ gestureActive: false }); });
afterEach(() => { clearClipboard(); registerRecoveryReferences(async () => new Set()); });
describe('resource owners and history maintenance', () => {
  it('retains a deleted last image through undo/redo, then reclaims it only after history is cleared', async () => {
    const { project, pageId, image, bitmap } = fixture();
    expect(execute({ label: '删除图片', context: { pageId, selection: [image.id] }, mutate(draft) { delete draft.layers[image.id]; draft.pages[pageId].roots = []; } }).ok).toBe(true);
    expect(getProject().assets[image.assetId]).toBeUndefined(); await collectUnreferencedBlobs(); expect(bitmap.close).not.toHaveBeenCalled();
    expect(undo().ok).toBe(true); expect(getProject()).toEqual(project); await collectUnreferencedBlobs(); expect(bitmap.close).not.toHaveBeenCalled();
    expect(redo().ok).toBe(true); expect(clearHistory(true).ok).toBe(true); const result = await collectUnreferencedBlobs(); expect(result).toEqual({ blobs: 1, bitmaps: 1, skipped: false }); expect(bitmap.close).toHaveBeenCalledOnce();
  });
  it('keeps current project shared data after clearing history and removes only unowned hashes', async () => {
    const { bitmap } = fixture(); runtimeStore.setState((state) => ({ blobs: new Map([...state.blobs, [other, new Blob(['extra'])]]) }));
    expect(clearHistory(true).ok).toBe(true); expect(await collectUnreferencedBlobs()).toEqual({ blobs: 1, bitmaps: 0, skipped: false }); expect(bitmap.close).not.toHaveBeenCalled(); expect(runtimeStore.getState().blobs.has(hash)).toBe(true);
  });
  it('retains clipboard sources when another project replaces runtime maps and pastes a live source into it', async () => {
    const { image, bitmap } = fixture(); expect(copyToClipboard([image.id]).ok).toBe(true);
    const next = createProject(); expect(replaceDocument(next).ok).toBe(true); replaceRuntimeResources(new Map(), new Map()); expect(bitmap.close).not.toHaveBeenCalled();
    expect(pasteFromClipboard(next.pageOrder[0]).ok).toBe(true); expect(runtimeStore.getState().images.get(hash)).toBe(bitmap); expect(bitmap.close).not.toHaveBeenCalled();
    clearClipboard(); await collectUnreferencedBlobs(); expect(bitmap.close).not.toHaveBeenCalled();
  });
  it('keeps snapshot resources while detached, closes once after the last owner releases, and does not close caller-owned sources', async () => {
    const { project, bitmap } = fixture(), a = retainResources(project), b = retainResources(project);
    replaceDocument(createProject()); replaceRuntimeResources(new Map(), new Map()); a(); expect(bitmap.close).not.toHaveBeenCalled(); b(); expect(bitmap.close).toHaveBeenCalledOnce(); b(); expect(bitmap.close).toHaveBeenCalledOnce();
    const external = { close: vi.fn() } as unknown as ImageBitmap, release = retainResources(project, new Map(), new Map([[hash, external]])); release(); expect(external.close).not.toHaveBeenCalled();
  });
  it('respects recovery generations and skips collection when persistent ownership cannot be read', async () => {
    const { bitmap } = fixture(); replaceDocument(createProject()); registerRecoveryReferences(async () => new Set([hash])); await collectUnreferencedBlobs(); expect(bitmap.close).not.toHaveBeenCalled();
    registerRecoveryReferences(async () => { throw Error('database denied'); }); expect((await collectUnreferencedBlobs()).skipped).toBe(true); expect(bitmap.close).not.toHaveBeenCalled();
    registerRecoveryReferences(async () => new Set()); await collectUnreferencedBlobs(); expect(bitmap.close).toHaveBeenCalledOnce();
  });
  it('cancels clear without changing state/save marker and refuses to clear an active edit', () => {
    const { pageId, image } = fixture(); execute({ label: '移动', context: { pageId, selection: [image.id] }, mutate(draft) { draft.layers[image.id].matrix = [1, 0, 0, 1, 4, 0]; } }); documentStore.setState({ savedStateId: getDocument().history.stateId });
    const before = getDocument(); clearHistory(false); expect(getDocument()).toEqual(before); runtimeStore.setState({ gestureActive: true }); expect(clearHistory(true).ok).toBe(false); expect(getDocument()).toEqual(before);
    runtimeStore.setState({ gestureActive: false }); clearHistory(true); expect(getDocument().project).toEqual(before.project); expect(getDocument().history.stateId).toBe(before.history.stateId); expect(getDocument().savedStateId).toBe(before.savedStateId);
  });
  it('retains the latest 200 transactions, supports 120 undo/redo steps and releases only dropped independent resources', () => {
    const { pageId, image } = fixture();
    for (let step = 1; step <= 205; step++) expect(execute({ label: `移动${step}`, context: { pageId, selection: [image.id] }, mutate(draft) { draft.layers[image.id].matrix = [1, 0, 0, 1, step, 0]; } }).ok).toBe(true);
    expect(getDocument().history.past).toHaveLength(200); for (let step = 0; step < 120; step++) expect(undo().ok).toBe(true); expect(getProject().layers[image.id].matrix[4]).toBe(85);
    for (let step = 0; step < 120; step++) expect(redo().ok).toBe(true); expect(getProject().layers[image.id].matrix[4]).toBe(205);
    undo(); execute({ label: '新分支', context: { pageId, selection: [image.id] }, mutate(draft) { draft.layers[image.id].matrix = [1, 0, 0, 1, draft.layers[image.id].matrix[4], 12]; } }); expect(getDocument().history.future).toHaveLength(0);
  });
});
