import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import { replaceDocument } from '../../src/history/commandBus';
import { getDocument } from '../../src/state/documentStore';
import { runtimeStore } from '../../src/state/runtimeStore';
import { sessionStore } from '../../src/state/sessionStore';
import { replaceRuntimeResources } from '../../src/storage/blobRepository';
import { installLoadedProject } from '../../src/storage/fileSave';

const sharedHash = 'a'.repeat(64), otherHash = 'b'.repeat(64);
function sharedDisplayFixture() {
  const project = createProject(), pageId = project.pageOrder[0];
  for (const [index, renderHash] of [sharedHash, sharedHash, otherHash].entries()) {
    const image = createLayer('image', pageId);
    if (image.type !== 'image') throw Error('image factory');
    image.assetId = crypto.randomUUID(); image.width = image.height = 32;
    project.layers[image.id] = image; project.pages[pageId].roots.push(image.id);
    project.assets[image.assetId] = {
      id: image.assetId, name: `原图${index}`, originalMime: 'image/png',
      originalHash: String(index + 1).repeat(64), renderHash, renderMime: 'image/png',
      width: 32, height: 32, originalBytes: 1, renderBytes: 1,
      framePolicy: 'still', normalizedOrientation: true,
    };
  }
  return { project, shared: new Blob(['a']), other: new Blob(['b']) };
}
function bitmap() { return { width: 32, height: 32, close: vi.fn() }; }

beforeEach(() => {
  sessionStore.setState({ textEditingId: null, toolMode: 'select' });
  runtimeStore.setState({ gestureActive: false });
  replaceRuntimeResources(new Map(), new Map());
  expect(replaceDocument(createProject()).ok).toBe(true);
});
afterEach(() => { replaceRuntimeResources(new Map(), new Map()); vi.unstubAllGlobals(); });

describe('opening assets with shared normalized pixels', () => {
  it('decodes each display hash once while preserving all three independent assets and layers', async () => {
    const { project, shared, other } = sharedDisplayFixture(), first = bitmap(), second = bitmap();
    const decode = vi.fn(async (source: Blob) => source === shared ? first : second);
    vi.stubGlobal('createImageBitmap', decode);
    const result = await installLoadedProject(project, new Map([[sharedHash, shared], [otherHash, other]]));
    expect(result.ok).toBe(true); expect(decode).toHaveBeenCalledTimes(2);
    expect(getDocument().project).toEqual(project);
    expect(runtimeStore.getState().images.size).toBe(2);
    expect(runtimeStore.getState().images.get(sharedHash)).toBe(first);
    expect(first.close).not.toHaveBeenCalled(); expect(second.close).not.toHaveBeenCalled();
  });

  it('closes every allocated bitmap exactly once and leaves the current document unchanged if a later blob is missing', async () => {
    const { project, shared } = sharedDisplayFixture(), allocated: ReturnType<typeof bitmap>[] = [];
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { const value = bitmap(); allocated.push(value); return value; }));
    const before = getDocument(), resources = runtimeStore.getState().images;
    const result = await installLoadedProject(project, new Map([[sharedHash, shared]]));
    expect(result.ok).toBe(false); expect(allocated).toHaveLength(1);
    for (const value of allocated) expect(value.close).toHaveBeenCalledOnce();
    expect(getDocument()).toEqual(before); expect(runtimeStore.getState().images).toBe(resources);
  });

  it('releases the unique decoded source and preserves document and resources when the next image decoder rejects', async () => {
    const { project, shared, other } = sharedDisplayFixture(), allocated: ReturnType<typeof bitmap>[] = [];
    vi.stubGlobal('createImageBitmap', vi.fn(async (source: Blob) => {
      if (source === other) throw new DOMException('damaged PNG', 'InvalidStateError');
      const value = bitmap(); allocated.push(value); return value;
    }));
    const before = getDocument(), resources = runtimeStore.getState().images;
    const result = await installLoadedProject(project, new Map([[sharedHash, shared], [otherHash, other]]));
    expect(result.ok).toBe(false); expect(allocated).toHaveLength(1);
    for (const value of allocated) expect(value.close).toHaveBeenCalledOnce();
    expect(getDocument()).toEqual(before); expect(runtimeStore.getState().images).toBe(resources);
  });
});
