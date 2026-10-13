import { describe, expect, it } from 'vitest';
import { createContentProject } from '../helpers/contentProject';
import { createLayer } from '../../src/domain/factories';
import { selectionTransformBounds, transformSelectionDraft } from '../../src/interaction/selectionTransform';
import { apply, multiply, rotationRad, translation, worldMatrix } from '../../src/geometry/matrix';
import { freeImage } from '../../src/images/freeImage';
import { resizeProject } from '../../src/interaction/resize';
import { localLayerBounds } from '../../src/interaction/layerBounds';
import { newId } from '../../src/domain/id';
describe('shared selection affine transforms', () => {
  function fixture() {
    const p = createContentProject(), pid = p.pageOrder[0], g = createLayer('group', pid), b = createLayer('bubble', pid), image = createLayer('image', pid);
    if (g.type !== 'group' || image.type !== 'image') throw Error('factory');
    g.matrix = multiply(translation(20, 30), rotationRad(.3)); g.children = [b.id]; b.parentId = g.id; image.width = 100; image.height = 80; image.matrix = translation(300, 100);
    [g, b, image].forEach(l => p.layers[l.id] = l); p.pages[pid].roots = [g.id, image.id]; return { p, g, b, image };
  }
  it('scales heterogeneous roots about a common anchor and never transforms a selected descendant twice', () => {
    const { p, g, b, image } = fixture(), original = structuredClone(p), T = [2, 0, 0, 1.5, -10, 15] as const;
    const r = transformSelectionDraft(p, [g.id, b.id, image.id], T); expect(r.ok).toBe(true); if (!r.ok) return;
    for (const id of [g.id, b.id, image.id]) { const q = { x: 19, y: 25 }, actual = apply(worldMatrix(r.value, id), q), expected = apply(T, apply(worldMatrix(p, id), q)); expect(actual.x).toBeCloseTo(expected.x); expect(actual.y).toBeCloseTo(expected.y); }
    expect(r.value.layers[b.id].matrix).toEqual(b.matrix); expect(p).toEqual(original); expect(r.value.pages).toBe(p.pages);
    expect(selectionTransformBounds(p, [g.id, b.id, image.id])).toEqual(selectionTransformBounds(p, [g.id, image.id]));
  });
  it('rotates objects with different parents using the inverse of each original parent world matrix', () => {
    const { p, g, b, image } = fixture(), T = multiply(translation(7, 8), rotationRad(.9)), r = transformSelectionDraft(p, [b.id, image.id], T); expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.value.layers[g.id]).toBe(g);
    for (const id of [b.id, image.id]) { const actual = worldMatrix(r.value, id), expected = multiply(T, worldMatrix(p, id)); actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i])); }
  });
  it('rejects locked subtrees, empty/missing selections, background and singular or extreme transforms atomically', () => {
    const { p, g, b, image } = fixture(); b.locked = true; expect(transformSelectionDraft(p, [g.id, image.id], translation(2, 3)).ok).toBe(false); b.locked = false;
    for (const ids of [[], ['missing']]) expect(transformSelectionDraft(p, ids, translation(2, 3)).ok).toBe(false);
    for (const T of [[0, 0, 0, 0, 0, 0], [1, 0, 0, 1, NaN, 0], [1e6, 0, 0, 1, 0, 0]]) expect(transformSelectionDraft(p, [g.id, image.id], T as any).ok).toBe(false);
    const bg = createLayer('pageBackground', p.pageOrder[0]); p.layers[bg.id] = bg; expect(transformSelectionDraft(p, [bg.id, image.id], translation(2, 3)).ok).toBe(false);
  });
  it('converts a legacy cropped image to equivalent free coordinates while retaining its panel clip and ownership', () => {
    const { p, image, b } = fixture(), panel = createLayer('panel', image.pageId); if (panel.type !== 'panel') throw Error('type');
    panel.children = [image.id]; panel.matrix = translation(50, 30); image.parentId = panel.id; image.matrix = [1, 0, 0, 1, 0, 0]; image.crop = { focus: { u: .5, v: .5 }, zoom: 1 };
    p.layers[panel.id] = panel; const old = freeImage(p, image.id), T = translation(12, 23), r = transformSelectionDraft(p, [image.id, b.id], T); expect(r.ok).toBe(true); if (!r.ok) return;
    const next = r.value.layers[image.id]; expect(next).toMatchObject({ parentId: panel.id, crop: null }); const expected = multiply(T, multiply(worldMatrix(p, panel.id), old.matrix)); worldMatrix(r.value, image.id).forEach((v, i) => expect(v).toBeCloseTo(expected[i]));
  });
  it('single freehand resizing preserves the affine position of details outside its body', () => {
    const { p, b } = fixture(); p.schemaVersion = 11; if (b.type !== 'bubble') throw Error('type'); b.shape = 'freehand'; b.width = 100; b.height = 80; b.style.borderWidth = 0;
    b.freehandSource = { version: 2, width: 100, height: 80, baseRing: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }], edits: [], ink: [{ id: newId(), tool: 'pen', width: 2, opacity: 1, color: '#FF0000FF', pressureMode: 'fixed', points: [{ x: -20, y: 40, pressure: .5, dt: 0 }] }] };
    const box = localLayerBounds(p, b.id)!, next = { x: 10, y: 20, width: box.width * 2, height: box.height * 2 }, r = resizeProject(p, b.id, next); expect(r.ok, JSON.stringify(r)).toBe(true); if (!r.ok) return;
    const updated = r.value.layers[b.id]; expect(updated).toMatchObject({ width: 200, height: 160 });
    const actual = apply(updated.matrix, { x: -40, y: 80 }), expected = apply(b.matrix, { x: next.x + (-20 - box.x) * 2, y: next.y + (40 - box.y) * 2 }); expect(actual.x).toBeCloseTo(expected.x); expect(actual.y).toBeCloseTo(expected.y);
  });
});
