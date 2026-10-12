import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import type { ImageLayer, PanelLayer } from '../../src/domain/types';
import { execute, replaceDocument, undo, redo } from '../../src/history/commandBus';
import { getDocument, getProject } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';
import { runtimeStore } from '../../src/state/runtimeStore';
import { beginCropEdit, cancelCropEdit, commitCropEdit, currentCropEdit, previewCropParams, previewCropZoom, selectCropImage } from '../../src/images/cropController';
import { resolveCrop } from '../../src/images/crop';
import { replaceRuntimeResources } from '../../src/storage/blobRepository';

function fixture(zoom = 1) {
  const project = createProject(), pageId = project.pageOrder[0], panel = createLayer('panel', pageId) as PanelLayer;
  panel.geometry = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  project.layers[panel.id] = panel; project.pages[pageId].roots = [panel.id];
  const images = [0, 1, 2].map((index) => {
    const image = createLayer('image', pageId) as ImageLayer; image.parentId = panel.id; image.width = 400; image.height = 200; image.assetId = crypto.randomUUID(); image.crop = { focus: { u: .5, v: .5 }, zoom }; image.locked = index === 2;
    project.assets[image.assetId] = { id: image.assetId, name: 'crop.png', originalHash: 'a'.repeat(64), renderHash: 'b'.repeat(64), originalMime: 'image/png', renderMime: 'image/png', width: 400, height: 200, originalBytes: 1, renderBytes: 1, framePolicy: 'still', normalizedOrientation: true };
    project.layers[image.id] = image; panel.children.push(image.id); return image;
  });
  expect(replaceDocument(project).ok).toBe(true); return { project, panel, images, pageId };
}
beforeEach(() => { cancelCropEdit(); runtimeStore.setState({ gestureActive: false }); });
describe('crop sessions with one source document and one undo action', () => {
  it('chooses the top editable image, rejects the locked image, edits two targets and commits both as one undo step', () => {
    const { project, panel, images } = fixture(); expect(beginCropEdit(panel.id).ok).toBe(true); expect(currentCropEdit()!.imageId).toBe(images[1].id);
    expect(selectCropImage(images[2].id).ok).toBe(false);
    for (let index = 0; index < 100; index++) expect(previewCropZoom(1 + index / 20).ok).toBe(true);
    expect(selectCropImage(images[0].id).ok).toBe(true); previewCropParams({ focus: { u: .1, v: .8 }, zoom: 2 });
    expect(getProject()).toEqual(project); expect(getDocument().history.past).toHaveLength(0);
    expect(commitCropEdit().ok).toBe(true); expect(getDocument().history.past).toHaveLength(1);
    const committed = getProject(); expect((committed.layers[images[0].id] as ImageLayer).crop).not.toEqual(images[0].crop); expect((committed.layers[images[1].id] as ImageLayer).crop).not.toEqual(images[1].crop); expect((committed.layers[images[2].id] as ImageLayer).crop).toEqual(images[2].crop);
    undo(); expect(getProject()).toEqual(project); redo(); expect(getProject()).toEqual(committed);
  });
  it('clamps focus to cover edges and rejects empty/nonfinite/out-of-range values without changing draft', () => {
    const { panel } = fixture(); beginCropEdit(panel.id); previewCropParams({ focus: { u: 0, v: 1 }, zoom: 1 });
    const active = currentCropEdit()!, image = active.preview.layers[active.imageId] as ImageLayer;
    expect(resolveCrop(panel.geometry, { x: 400, y: 200 }, image.crop!)).toEqual({ scale: .5, tx: 0, ty: 0 });
    for (const crop of [{ focus: { u: NaN, v: .5 }, zoom: 1 }, { focus: { u: -1, v: .5 }, zoom: 1 }, { focus: { u: .5, v: 2 }, zoom: 1 }, { focus: { u: .5, v: .5 }, zoom: 0 }, { focus: { u: .5, v: .5 }, zoom: 17 }]) expect(previewCropParams(crop).ok).toBe(false);
    expect(currentCropEdit()!.preview).toBe(active.preview); expect(previewCropZoom(Infinity).ok).toBe(false);
  });
  it('retains the inherited >16 limit after reducing zoom, and clamps wheel overshoot to that initial limit', () => {
    const { panel } = fixture(40); beginCropEdit(panel.id); previewCropZoom(2); previewCropZoom(40); expect((currentCropEdit()!.preview.layers[currentCropEdit()!.imageId] as ImageLayer).crop!.zoom).toBe(40);
    previewCropZoom(1000); expect((currentCropEdit()!.preview.layers[currentCropEdit()!.imageId] as ImageLayer).crop!.zoom).toBe(40);
    previewCropZoom(-100); expect((currentCropEdit()!.preview.layers[currentCropEdit()!.imageId] as ImageLayer).crop!.zoom).toBe(1);
  });
  it('cancel, tool/page switch, competing transactions and project replacement cannot leak drafts into the current document', () => {
    const { project, panel, pageId } = fixture(); beginCropEdit(panel.id); previewCropZoom(4); cancelCropEdit(); expect(getProject()).toEqual(project); expect(getDocument().history.past).toHaveLength(0);
    beginCropEdit(panel.id); previewCropZoom(3); sessionStore.setState({ toolMode: 'select' }); expect(currentCropEdit()).toBeNull();
    beginCropEdit(panel.id); previewCropZoom(2); execute({ label: 'rename', context: { pageId, selection: [panel.id] }, mutate(draft) { draft.layers[panel.id].name = 'new'; } }); expect(currentCropEdit()).toBeNull(); expect((getProject().layers[panel.children[0]] as ImageLayer).crop!.zoom).toBe(1);
    beginCropEdit(panel.id); previewCropZoom(5); replaceDocument(createProject()); expect(currentCropEdit()).toBeNull(); expect(commitCropEdit().ok).toBe(false);
  });
  it('rejects locked ancestors, hidden or foreign images and split parents before starting', () => {
    const { project, panel, images } = fixture(); expect(beginCropEdit(panel.id, images[2].id).ok).toBe(false);
    panel.locked = true; replaceDocument(project); expect(beginCropEdit(panel.id).ok).toBe(false); panel.locked = false; panel.visible = false; replaceDocument(project); expect(beginCropEdit(panel.id).ok).toBe(false);
  });
  it('keeps its source bitmap alive through runtime replacement and releases the last retired owner on cancel', () => {
    const { panel } = fixture(), bitmap = { width: 400, height: 200, close: vi.fn() } as unknown as ImageBitmap;
    replaceRuntimeResources(new Map(), new Map([['b'.repeat(64), bitmap]])); beginCropEdit(panel.id);
    replaceRuntimeResources(new Map(), new Map()); expect(bitmap.close).not.toHaveBeenCalled(); cancelCropEdit(); expect(bitmap.close).toHaveBeenCalledOnce();
  });
});
