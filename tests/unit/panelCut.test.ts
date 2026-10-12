import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import type { ImageLayer, PanelLayer } from '../../src/domain/types';
import { replaceDocument, undo, redo } from '../../src/history/commandBus';
import { createPanelCut } from '../../src/app/actions';
import { getProject } from '../../src/state/documentStore';
import { cropFromMapping, resolveCrop } from '../../src/images/crop';
import { commitCut, previewCut } from '../../src/panels/cutPanel';
import { metrics, polyBounds } from '../../src/geometry/polygon';
import { getDocument } from '../../src/state/documentStore';
import { execute } from '../../src/history/commandBus';

let panelId = '';
let oldImageId = '';
beforeEach(() => {
  const project = createProject();
  const pageId = project.pageOrder[0];
  const panel = createLayer('panel', pageId) as PanelLayer;
  const image = createLayer('image', pageId) as ImageLayer;
  image.parentId = panel.id;
  image.assetId = crypto.randomUUID();
  image.width = 400;
  image.height = 200;
  image.crop = { focus: { u: 0.45, v: 0.5 }, zoom: 2 };
  panel.children.push(image.id);
  project.pages[pageId].roots.push(panel.id);
  project.layers[panel.id] = panel;
  project.layers[image.id] = image;
  project.assets[image.assetId] = {
    id: image.assetId, name: 'test.png', originalMime: 'image/png', originalHash: 'a'.repeat(64),
    renderHash: 'b'.repeat(64), renderMime: 'image/png', width: 400, height: 200,
    originalBytes: 1000, renderBytes: 900, framePolicy: 'still', normalizedOrientation: true,
  };
  const result = replaceDocument(project);
  expect(result.ok).toBe(true);
  panelId = panel.id;
  oldImageId = image.id;
});

describe('cutting an illustrated panel', () => {
  it('previews arbitrary valid ratios without creating history and with gap zero preserves total area', () => {
    const original = getProject(), panel = original.layers[panelId] as PanelLayer;
    const result = previewCut(panelId, { axis: 'vertical', ratio: .3, gap: 0 }); expect(result.ok).toBe(true); if (!result.ok) return;
    expect(polyBounds(result.value.polygons[0]).width).toBeCloseTo(180, 6); expect(polyBounds(result.value.polygons[1]).width).toBeCloseTo(420, 6);
    const area = (polygon: typeof panel.geometry) => { const measured = metrics(polygon); if (!measured.ok) throw Error('metrics'); return measured.value.signedArea; };
    expect(area(result.value.polygons[0]) + area(result.value.polygons[1])).toBeCloseTo(area(panel.geometry), 6); expect(getProject()).toEqual(original); expect(getDocument().history.past).toHaveLength(0);
  });
  it('rejects empty/extreme specs, oversized gaps, small children and locked descendants before changing the tree', () => {
    const before = getProject();
    for (const spec of [{ axis: 'vertical' as const, ratio: NaN, gap: 16 }, { axis: 'vertical' as const, ratio: .001, gap: 0 }, { axis: 'horizontal' as const, ratio: .99, gap: 256 }, { axis: 'vertical' as const, ratio: .5, gap: 257 }, { axis: 'vertical' as const, ratio: .01, gap: 0 }]) expect(commitCut(panelId, spec).ok).toBe(false);
    expect(getProject()).toEqual(before); expect(getDocument().history.past).toHaveLength(0);
    const project = structuredClone(before); project.layers[oldImageId].locked = true; replaceDocument(project); expect(previewCut(panelId, { axis: 'vertical', ratio: .5, gap: 0 }).ok).toBe(false); expect(getProject()).toEqual(project);
  });
  it('supports cutting a leaf within a split and restores the complete tree through two undo steps', () => {
    const before = getProject(); const first = commitCut(panelId, { axis: 'vertical', ratio: .4, gap: 20 }); expect(first.ok).toBe(true); if (!first.ok) return;
    const split = getProject(); expect(commitCut(panelId, { axis: 'horizontal', ratio: .5, gap: 16 }).ok).toBe(false);
    expect(commitCut(first.value[0], { axis: 'horizontal', ratio: .6, gap: 0 }).ok).toBe(true); expect(getDocument().history.past).toHaveLength(2); undo(); expect(getProject()).toEqual(split); undo(); expect(getProject()).toEqual(before);
  });
  it('uses local axes of a rotated trapezoid and keeps every image mapping and property', () => {
    const pageId = getProject().pageOrder[0]; execute({ label: '旋转梯形', context: { pageId, selection: [panelId] }, mutate(project) { const panel = project.layers[panelId] as PanelLayer; panel.geometry = [{ x: 80, y: 0 }, { x: 520, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }]; panel.matrix = [0, 1, -1, 0, 200, 150]; project.layers[oldImageId].visible = false; project.layers[oldImageId].colorLabel = 'blue'; } });
    const original = getProject(), parent = original.layers[panelId] as PanelLayer, source = original.layers[oldImageId] as ImageLayer, mapping = resolveCrop(parent.geometry, { x: source.width, y: source.height }, source.crop!);
    const result = commitCut(panelId, { axis: 'vertical', ratio: .4, gap: 30 }); expect(result.ok).toBe(true); if (!result.ok) return;
    for (const id of result.value) { const panel = getProject().layers[id] as PanelLayer, image = getProject().layers[panel.children[0]] as ImageLayer, actual = resolveCrop(panel.geometry, { x: image.width, y: image.height }, image.crop!); expect(panel.matrix).toEqual(parent.matrix); expect(panel.parentId).toBeNull(); expect(panel.style.borderWidth).toBe(parent.style.borderWidth); expect(actual.scale).toBeCloseTo(mapping.scale, 8); expect(actual.tx).toBeCloseTo(mapping.tx, 8); expect(actual.ty).toBeCloseTo(mapping.ty, 8); expect(image.visible).toBe(false); expect(image.colorLabel).toBe('blue'); }
    undo(); expect(getProject()).toEqual(original);
  });
  it('keeps each child image at the original source-pixel mapping and restores undo/redo', () => {
    const parent = getProject().layers[panelId] as PanelLayer;
    const image = getProject().layers[oldImageId] as ImageLayer;
    const original = resolveCrop(parent.geometry, { x: image.width, y: image.height }, image.crop!);
    const cut = createPanelCut(panelId, 'vertical');
    expect(cut.ok).toBe(true);
    const project = getProject();
    expect(project.layers[panelId]).toBeUndefined();
    const leaves = Object.values(project.layers).filter((l): l is PanelLayer => l.type === 'panel');
    expect(leaves).toHaveLength(2);
    expect(leaves.every(l => l.role === 'leaf' && l.parentId === null)).toBe(true);
    expect(project.layers[oldImageId]).toBeUndefined();
    for (const child of leaves) {
      expect(child.children).toHaveLength(1);
      const owned = project.layers[child.children[0]] as ImageLayer;
      expect(owned.assetId).toBe(image.assetId);
      const map = resolveCrop(child.geometry, { x: owned.width, y: owned.height }, owned.crop!);
      expect(map.scale).toBeCloseTo(original.scale, 8);
      expect(map.tx).toBeCloseTo(original.tx, 8);
      expect(map.ty).toBeCloseTo(original.ty, 8);
      expect(cropFromMapping(child.geometry, { x: owned.width, y: owned.height }, original)).toEqual(owned.crop);
    }
    expect(undo().ok).toBe(true);
    expect((getProject().layers[panelId] as PanelLayer).role).toBe('leaf');
    expect(getProject().layers[oldImageId]).toBeDefined();
    expect(redo().ok).toBe(true);
    expect(getProject().layers[panelId]).toBeUndefined();
    expect(getProject()).toEqual(project);
  });
});
