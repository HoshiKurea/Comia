import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecodedAsset } from '../../src/assets/importImage';
import type { ImageLayer, PanelLayer } from '../../src/domain/types';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject, toLegacy } from '../helpers/contentProject';
import { validateProject } from '../../src/domain/validate';
import { migrateProject } from '../../src/storage/migrateProject';
import { prepareProjectForStorage, requiredHashes } from '../../src/storage/codec';
import { addLibraryAssets, placeLibraryAsset, removeLibraryAsset } from '../../src/assets/libraryCommands';
import { replaceDocument, execute, undo, redo, clearHistory } from '../../src/history/commandBus';
import { getDocument, getProject } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';
import { runtimeStore } from '../../src/state/runtimeStore';
import { collectUnreferencedBlobs, registerRecoveryReferences, replaceRuntimeResources } from '../../src/storage/blobRepository';
import { beginMaskEdit, cancelMaskEdit, commitMaskEdit, currentMaskEdit, previewMaskImage } from '../../src/images/maskController';
import { defaultMask, maskContains, preserveUnlinkedMasks } from '../../src/images/maskGeometry';
import { bindImageToPanel, enableFreeImage } from '../../src/images/freeImage';
import { detachOwned } from '../../src/layers/reparent';
import { commitCut } from '../../src/panels/cutPanel';
import { multiply, worldMatrix } from '../../src/geometry/matrix';
import { setDimensions, setRotation } from '../../src/interaction/transformCommands';
import { moveByKeyboard, commitKeyboardMove } from '../../src/interaction/keyboardMove';
import { resolveCrop } from '../../src/images/crop';

const hash = 'a'.repeat(64), renderHash = 'b'.repeat(64);
function decoded(): DecodedAsset {
  return { meta: { id: crypto.randomUUID(), name: '拼贴原图.png', width: 320, height: 240, originalMime: 'image/png', renderMime: 'image/png', originalHash: hash, renderHash, originalBytes: 1, renderBytes: 1, framePolicy: 'still' as const, normalizedOrientation: true as const }, original: new Blob(['o']), render: new Blob(['r']), bitmap: { width: 320, height: 240, close: vi.fn() } as unknown as ImageBitmap };
}
function fixture() {
  const project = createProject(), pageId = project.pageOrder[0]; expect(replaceDocument(project).ok).toBe(true);
  const asset = decoded(), added = addLibraryAssets([asset]); if (!added.ok) throw Error('import');
  const placed = placeLibraryAsset(added.value[0], pageId, { x: 200, y: 200 }); if (!placed.ok) throw Error('place');
  return { pageId, imageId: placed.value, assetId: added.value[0], asset };
}
function panel(pageId: string) {
  const p = createLayer('panel', pageId) as PanelLayer; p.matrix = [1.2, .4, -.2, 1.1, 40, 80];
  expect(execute({ label: '分镜', context: { pageId, selection: [] }, mutate(draft) { draft.layers[p.id] = p; draft.pages[pageId].roots.push(p.id); } }).ok).toBe(true); return p;
}
beforeEach(() => { registerRecoveryReferences(async () => new Set()); cancelMaskEdit(); replaceRuntimeResources(new Map(), new Map()); });
afterEach(cancelMaskEdit);

describe('independent materials and non-destructive masks', () => {
  it('imports without creating a layer, deduplicates originals, selects centered independent instances and undoes placements', () => {
    const p = createProject(); replaceDocument(p); const a = decoded(), b = decoded();
    const result = addLibraryAssets([a, b]); expect(result).toMatchObject({ ok: true, value: [a.meta.id] }); expect(b.bitmap.close).toHaveBeenCalledOnce();
    expect(Object.keys(getProject().layers)).toHaveLength(0); expect(getDocument().history.past).toHaveLength(1);
    const placed = placeLibraryAsset(a.meta.id, p.pageOrder[0]); if (!placed.ok) throw Error('place'); const image = getProject().layers[placed.value] as ImageLayer;
    expect(image.parentId).toBeNull(); expect(sessionStore.getState().selection).toEqual([image.id]);
    expect(image.matrix[4] + image.width * image.matrix[0] / 2).toBe(p.pages[p.pageOrder[0]].width / 2);
    expect(undo().ok).toBe(true); expect(Object.keys(getProject().layers)).toHaveLength(0); expect(getProject().libraryAssetIds).toEqual([a.meta.id]);
    expect(redo().ok).toBe(true); expect(getProject().layers[image.id]).toEqual(image);
  });
  it('saves unused library resources and keeps original ownership after deleting the last instance', async () => {
    const f = fixture(); execute({ label: '删除', context: { pageId: f.pageId, selection: [] }, mutate(draft) { delete draft.layers[f.imageId]; draft.pages[f.pageId].roots = []; } });
    expect(prepareProjectForStorage(getProject())).toMatchObject({ ok: true, value: { assets: { [f.assetId]: f.asset.meta } } });
    expect(requiredHashes(getProject())).toEqual(new Set([hash, renderHash])); clearHistory(true); await collectUnreferencedBlobs(); expect(f.asset.bitmap.close).not.toHaveBeenCalled();
    expect(removeLibraryAsset(f.assetId).ok).toBe(true); expect(getProject().assets[f.assetId]).toBeUndefined(); await collectUnreferencedBlobs(); expect(f.asset.bitmap.close).not.toHaveBeenCalled();
    undo(); expect(getProject().assets[f.assetId]).toEqual(f.asset.meta); redo(); clearHistory(true); await collectUnreferencedBlobs(); expect(f.asset.bitmap.close).toHaveBeenCalledOnce();
  });
  it('removing a library entry preserves every placed instance, and rejects placing a removed entry', () => {
    const f = fixture(), before = getProject().layers[f.imageId]; removeLibraryAsset(f.assetId);
    expect(getProject().layers[f.imageId]).toEqual(before); expect(getProject().assets[f.assetId]).toEqual(f.asset.meta);
    expect(placeLibraryAsset(f.assetId, f.pageId).ok).toBe(false); undo(); expect(getProject().libraryAssetIds).toEqual([f.assetId]);
  });
  it('binds and unbinds under sheared ancestors without moving pixels, and permits independent position/size/rotation', () => {
    const f = fixture(), p = panel(f.pageId), initial = worldMatrix(getProject(), f.imageId);
    expect(bindImageToPanel(f.imageId, p.id).ok).toBe(true);
    worldMatrix(getProject(), f.imageId).forEach((n, i) => expect(n).toBeCloseTo(initial[i], 10));
    expect(setDimensions(f.imageId, 400, 280).ok).toBe(true); expect(setRotation(f.imageId, 27).ok).toBe(true);
    expect(moveByKeyboard(12, -5).ok).toBe(true); expect(commitKeyboardMove().ok).toBe(true);
    const bound = worldMatrix(getProject(), f.imageId); expect(detachOwned(f.imageId).ok).toBe(true);
    worldMatrix(getProject(), f.imageId).forEach((n, i) => expect(n).toBeCloseTo(bound[i], 10));
    expect(undo().ok).toBe(true); expect(getProject().layers[f.imageId].parentId).toBe(p.id);
  });
  it('converts legacy cover mapping exactly instead of recropping, and undo restores legacy parameters', () => {
    const f = fixture(), p = panel(f.pageId);
    execute({ label: '旧图片', context: { pageId: f.pageId, selection: [] }, mutate(draft) { const image = draft.layers[f.imageId] as ImageLayer; image.matrix = [1, 0, 0, 1, 0, 0]; image.parentId = p.id; image.crop = { focus: { u: .35, v: .7 }, zoom: 2 }; (draft.layers[p.id] as PanelLayer).children = [image.id]; draft.pages[f.pageId].roots = [p.id]; } });
    const old = structuredClone(getProject()), image = old.layers[f.imageId] as ImageLayer, m = resolveCrop(p.geometry, { x: image.width, y: image.height }, image.crop!);
    expect(enableFreeImage(f.imageId).ok).toBe(true); expect(getProject().layers[f.imageId].matrix).toEqual([m.scale, 0, 0, m.scale, m.tx, m.ty]); expect(undo().ok).toBe(true); expect(getProject()).toEqual(old);
  });
  it('records a hundred legal previews as a single undoable transaction, cancellation leaves original bytes and project intact', () => {
    const f = fixture(), before = getProject(), count = getDocument().history.past.length;
    expect(beginMaskEdit(f.imageId, 'ellipse').ok).toBe(true);
    for (let i = 0; i < 100; i++) { const image = currentMaskEdit()!.preview.layers[f.imageId] as ImageLayer; expect(previewMaskImage({ ...image, mask: { ...image.mask!, matrix: [1, 0, 0, 1, i, 0] } }).ok).toBe(true); }
    expect(getProject()).toBe(before); expect(getDocument().history.past.length).toBe(count); expect(commitMaskEdit().ok).toBe(true);
    expect(getDocument().history.past.length).toBe(count + 1); const after = getProject(); undo(); expect(getProject()).toEqual(before); redo(); expect(getProject()).toEqual(after);
    const restored = getProject(), bytes = runtimeStore.getState().blobs.get(hash); beginMaskEdit(f.imageId, 'polygon'); cancelMaskEdit(); expect(getProject()).toBe(restored); expect(runtimeStore.getState().blobs.get(hash)).toBe(bytes);
  });
  it('unlinked image transforms keep the mask stationary and replay the exact result through undo/redo', () => {
    const f = fixture(); beginMaskEdit(f.imageId); const image = currentMaskEdit()!.preview.layers[f.imageId] as ImageLayer; previewMaskImage({ ...image, mask: { ...image.mask!, linked: false } }); commitMaskEdit();
    const before = getProject(), old = before.layers[f.imageId] as ImageLayer, fixed = multiply(old.matrix, old.mask!.matrix);
    expect(setRotation(f.imageId, 46).ok).toBe(true); expect(setDimensions(f.imageId, 430, 190).ok).toBe(true);
    const next = getProject().layers[f.imageId] as ImageLayer; multiply(next.matrix, next.mask!.matrix).forEach((n, i) => expect(n).toBeCloseTo(fixed[i], 9));
    const final = getProject(); undo(); undo(); expect(getProject()).toEqual(before); redo(); redo(); expect(getProject()).toEqual(final);
    const preview = structuredClone(final), current = final.layers[f.imageId] as ImageLayer; preview.layers[f.imageId].matrix = [1, .1, .2, 1, 50, 50]; preserveUnlinkedMasks(final, preview);
    multiply(preview.layers[f.imageId].matrix, (preview.layers[f.imageId] as ImageLayer).mask!.matrix).forEach((n, i) => expect(n).toBeCloseTo(multiply(current.matrix, current.mask!.matrix)[i], 9));
  });
  it('linked masks move with the image, disabled masks reveal full source including former corners', () => {
    const f = fixture(), image = getProject().layers[f.imageId] as ImageLayer, mask = defaultMask(image, 'ellipse');
    expect(maskContains(mask, { x: 160, y: 120 })).toBe(true); expect(maskContains(mask, { x: 32, y: 24 })).toBe(false); expect(maskContains({ ...mask, enabled: false }, { x: 0, y: 0 })).toBe(true);
    const before = structuredClone(getProject()); (before.layers[image.id] as ImageLayer).mask = mask; const after = structuredClone(before); after.layers[image.id].matrix = [2, 0, 0, 3, 50, 90]; preserveUnlinkedMasks(before, after); expect((after.layers[image.id] as ImageLayer).mask).toEqual(mask);
  });
  it('rejects self-intersections, singular matrices, malformed shapes and duplicate library ownership without changing the last valid preview', () => {
    const f = fixture(); beginMaskEdit(f.imageId, 'polygon'); const before = currentMaskEdit()!.preview, image = before.layers[f.imageId] as ImageLayer;
    expect(previewMaskImage({ ...image, mask: { ...image.mask!, geometry: [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 50, y: 0 }, { x: 0, y: 50 }] } }).ok).toBe(false);
    expect(currentMaskEdit()!.preview).toBe(before);
    expect(previewMaskImage({ ...image, mask: { ...image.mask!, matrix: [1, 0, 0, 0, 0, 0] } }).ok).toBe(false);
    expect(validateProject({ ...getProject(), libraryAssetIds: [f.assetId, f.assetId] }).ok).toBe(false);
    expect(validateProject({ ...getProject(), libraryAssetIds: [crypto.randomUUID()] }).ok).toBe(false);
  });
  it('accepts one-pixel originals and true ellipse/multivertex shapes, refusing mask data in legacy schemas', () => {
    const f = fixture(), p = structuredClone(getProject()), image = p.layers[f.imageId] as ImageLayer; image.width = image.height = 1; image.mask = defaultMask(image, 'ellipse');
    expect(validateProject(p).ok).toBe(true); p.schemaVersion = 2; expect(validateProject(p).ok).toBe(false);
    expect(migrateProject({ ...p, schemaVersion: 5 }).ok).toBe(false);
  });
  it('migrates valid format1/2 to the new editable library while preserving crop and original input', () => {
    const f = fixture(), p = toLegacy(getProject(), 2);
    const upgraded = migrateProject(p); expect(upgraded.ok).toBe(true); if (!upgraded.ok) throw Error('migration'); expect(upgraded.value.schemaVersion).toBe(14); expect(upgraded.value.libraryAssetIds).toEqual([f.assetId]); expect(toLegacy(upgraded.value, 2)).toEqual(p); expect(p.schemaVersion).toBe(2); expect(p.libraryAssetIds).toBeUndefined();
  });
  it('cuts a frame containing a free masked image into separate editable children without changing source mapping', () => {
    const f = fixture(), p = panel(f.pageId); bindImageToPanel(f.imageId, p.id); beginMaskEdit(f.imageId, 'polygon'); commitMaskEdit();
    const before = getProject(), image = before.layers[f.imageId] as ImageLayer, result = commitCut(p.id, { axis: 'vertical', ratio: .5, gap: 0 }); if (!result.ok) throw Error(JSON.stringify(result));
    const children = result.value.map(id => getProject().layers[id] as PanelLayer), clones = children.map(child => getProject().layers[child.children[0]] as ImageLayer);
    expect(new Set(clones.map(clone => clone.id)).size).toBe(2); clones.forEach(clone => { expect(clone.matrix).toEqual(image.matrix); expect(clone.mask).toEqual(image.mask); expect(clone.crop).toBeNull(); });
    expect(undo().ok).toBe(true); expect(getProject()).toEqual(before); redo(); expect(setRotation(clones[0].id, 12).ok).toBe(true); expect((getProject().layers[clones[1].id] as ImageLayer).matrix).toEqual(clones[1].matrix);
  });
  it('project replacement cancels editing and rejects stale target commits', () => {
    const f = fixture(); beginMaskEdit(f.imageId); const p = createProject(); replaceDocument(p); expect(currentMaskEdit()).toBeNull(); expect(getProject()).toBe(p); expect(commitMaskEdit().ok).toBe(true); expect(getDocument().history.past).toHaveLength(0);
  });
});
