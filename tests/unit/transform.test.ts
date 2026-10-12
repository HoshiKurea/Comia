import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import type { Project, Point } from '../../src/domain/types';
import { apply, decompose, multiply, rotationRad, translation, worldMatrix } from '../../src/geometry/matrix';
import { rectHandle, resizedRect, resizeProject, quantize16 } from '../../src/interaction/resize';
import { matrixAtAngle, rotateAround, snappedRotation, unwrapStep } from '../../src/interaction/rotate';
import { setDimensions, setRotation } from '../../src/interaction/transformCommands';
import { constrainPanelGeometry, isParallelogram, moveVertex } from '../../src/panels/editGeometry';
import { getDocument, getProject } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';
import { replaceDocument, undo, redo } from '../../src/history/commandBus';
import { containsConvex, validateConvex } from '../../src/geometry/polygon';
import { GEOMETRY_POLICY } from '../../src/domain/limits';
import { resolveCrop } from '../../src/images/crop';

const closePoint = (a: Point, b: Point) => { expect(a.x).toBeCloseTo(b.x, 7); expect(a.y).toBeCloseTo(b.y, 7); };
function fixture() {
  const project = createProject(), pageId = project.pageOrder[0], group = createLayer('group', pageId), panel = createLayer('panel', pageId);
  if (group.type !== 'group' || panel.type !== 'panel') throw Error('factory');
  group.children = [panel.id]; group.matrix = multiply(translation(80, 40), multiply(rotationRad(.7), [2, 0, .3, .5, 0, 0]));
  panel.parentId = group.id; panel.matrix = multiply(translation(120, 130), rotationRad(.3));
  project.layers[group.id] = group; project.layers[panel.id] = panel; project.pages[pageId].roots = [group.id];
  return { project, pageId, group, panel };
}
describe('transform geometry', () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7])('keeps the opposite page-space anchor fixed for handle %i under shear and rotation', (index) => {
    const { project, panel } = fixture(), box = { x: 0, y: 0, width: 600, height: 400 };
    const h = rectHandle(box, index), anchor = rectHandle(box, (index + 4) % 8);
    const pointer = { x: anchor.x + (h.x - anchor.x) * 1.4, y: anchor.y + (h.y - anchor.y) * 1.2 };
    const next = resizedRect(box, index, pointer, { proportional: false, snap16: false }); expect(next.ok).toBe(true); if (!next.ok) return;
    const result = resizeProject(project, panel.id, next.value); expect(result.ok).toBe(true); if (!result.ok) return;
    const oldPage = apply(worldMatrix(project, panel.id), anchor), newAnchor = rectHandle(next.value, (index + 4) % 8);
    closePoint(oldPage, apply(worldMatrix(result.value, panel.id), newAnchor));
    expect(project.layers[panel.id]).toEqual(panel);
  });
  it('uses relative dominant change for Shift, quantizes half values, rejects crossing and clamps minimum', () => {
    const box = { x: 0, y: 0, width: 600, height: 400 };
    expect(resizedRect(box, 4, { x: 900, y: 500 }, { proportional: true, snap16: false })).toEqual({ ok: true, value: { x: 0, y: 0, width: 900, height: 600 } });
    expect(quantize16(101)).toBe(96); expect(quantize16(104)).toBe(112);
    expect(resizedRect(box, 4, { x: -1, y: 200 }, { proportional: false, snap16: false }).ok).toBe(false);
    expect(resizedRect(box, 4, { x: 1, y: 2 }, { proportional: false, snap16: false })).toMatchObject({ ok: true, value: { width: 16, height: 16 } });
    expect(resizedRect(box, 4, { x: 17000, y: 200 }, { proportional: false, snap16: false }).ok).toBe(false);
  });
  it('scales a group matrix without changing text font, geometry or child local matrices', () => {
    const { project, group, panel, pageId } = fixture(), text = createLayer('text', pageId); text.parentId = group.id;
    group.children.push(text.id); project.layers[text.id] = text;
    const result = resizeProject(project, group.id, { x: 0, y: 0, width: 1200, height: 800 }); expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.layers[text.id]).toEqual(text); expect(result.value.layers[panel.id]).toEqual(panel);
    expect(result.value.layers[group.id].matrix).not.toEqual(group.matrix);
  });
  it('rotates around a fixed center, preserves QR scale/shear and unwraps through 180 degrees', () => {
    const { project, group } = fixture(), before = decompose(group.matrix), pivot = { x: 300, y: 200 };
    const rotated = rotateAround(project, group.id, pivot, .9), after = decompose(rotated);
    closePoint(apply(group.matrix, pivot), apply(rotated, pivot));
    expect(after.sx).toBeCloseTo(before.sx); expect(after.sy).toBeCloseTo(before.sy); expect(after.k).toBeCloseTo(before.k);
    expect(unwrapStep(179 * Math.PI / 180, -179 * Math.PI / 180)).toBeCloseTo(2 * Math.PI / 180);
    expect(snappedRotation(3 * Math.PI / 180, 10 * Math.PI / 180, false) * 180 / Math.PI).toBeCloseTo(15);
    expect(snappedRotation(0, -2.5 * Math.PI / 180, false)).toBeCloseTo(0);
    expect(snappedRotation(0, 13 * Math.PI / 180, true) * 180 / Math.PI).toBeCloseTo(13);
    const matrix = matrixAtAngle(project, group.id, 360); expect(matrix.ok).toBe(true); if (matrix.ok) expect(decompose(matrix.value).thetaRad).toBeCloseTo(0);
  });
  it('moves a parallelogram corner and adjacent half-deltas while keeping the opposite corner fixed', () => {
    const poly = [{ x: 80, y: 0 }, { x: 600, y: 0 }, { x: 520, y: 400 }, { x: 0, y: 400 }];
    const next = moveVertex(poly, 0, { x: 120, y: 20 }, true);
    expect(isParallelogram(next)).toBe(true); expect(next[2]).toEqual(poly[2]); expect(next[1]).toEqual({ x: 620, y: 10 });
    expect(isParallelogram(moveVertex(poly, 0, { x: 120, y: 20 }, false))).toBe(false);
  });
  it('stops a child panel vertex at its convex parent boundary without flipping', () => {
    const { project, panel, pageId } = fixture(), child = createLayer('panel', pageId); if (child.type !== 'panel') throw Error('panel');
    panel.role = 'split'; panel.children = [child.id]; child.parentId = panel.id;
    child.geometry = [{ x: 20, y: 20 }, { x: 280, y: 20 }, { x: 280, y: 380 }, { x: 20, y: 380 }]; project.layers[child.id] = child;
    const next = constrainPanelGeometry(project, child.id, moveVertex(child.geometry, 0, { x: -400, y: -300 }, false));
    expect(next.every((p) => containsConvex(panel.geometry, p))).toBe(true); expect(validateConvex(next, GEOMETRY_POLICY).ok).toBe(true);
    expect(next[0].x).toBeLessThan(20); expect(next[0].x).toBeGreaterThanOrEqual(-.001);
  });
  it('resizes all split descendants in one space and reflows leaf crop without changing owned matrices', () => {
    const { project, panel, pageId } = fixture(), child = createLayer('panel', pageId), image = createLayer('image', pageId);
    if (child.type !== 'panel' || image.type !== 'image') throw Error('factory');
    panel.role = 'split'; panel.children = [child.id]; child.parentId = panel.id; child.children = [image.id]; child.geometry = [{ x: 10, y: 10 }, { x: 590, y: 10 }, { x: 590, y: 390 }, { x: 10, y: 390 }];
    image.parentId = child.id; image.width = 1000; image.height = 600; image.crop = { focus: { u: .8, v: .2 }, zoom: 2 };
    project.layers[child.id] = child; project.layers[image.id] = image;
    const result = resizeProject(project, panel.id, { x: 0, y: 0, width: 900, height: 800 }); expect(result.ok).toBe(true); if (!result.ok) return;
    const c = result.value.layers[child.id], i = result.value.layers[image.id]; if (c.type !== 'panel' || i.type !== 'image' || !i.crop) throw Error('type');
    expect(c.geometry[0]).toEqual({ x: 15, y: 20 }); expect(c.matrix).toEqual(child.matrix); expect(i.matrix).toEqual(image.matrix);
    const mapping = resolveCrop(c.geometry, { x: i.width, y: i.height }, i.crop);
    expect(mapping.tx).toBeLessThanOrEqual(15); expect(mapping.tx + i.width * mapping.scale).toBeGreaterThanOrEqual(885);
    expect(mapping.ty).toBeLessThanOrEqual(20); expect(mapping.ty + i.height * mapping.scale).toBeGreaterThanOrEqual(780);
  });
});
describe('transform property transactions', () => {
  let project: Project, id: string;
  beforeEach(() => { project = createProject(); const layer = createLayer('panel', project.pageOrder[0]); id = layer.id; project.layers[id] = layer; project.pages[layer.pageId].roots = [id]; replaceDocument(project); sessionStore.setState({ activePageId: layer.pageId, selection: [id], snap16: true }); });
  it('reports applied 16-quantized size, normalizes rotation and restores complete state through undo/redo', () => {
    expect(setDimensions(id, 101).ok).toBe(true); const first = getProject(); expect(first.layers[id]).toMatchObject({ geometry: [{ x: 0, y: 0 }, { x: 96, y: 0 }, { x: 96, y: 400 }, { x: 0, y: 400 }] });
    expect(setDimensions(id, 104).ok).toBe(true); expect(setRotation(id, 360).ok).toBe(true);
    expect(getDocument().history.past).toHaveLength(2); undo(); expect(getProject()).toEqual(first); undo(); expect(getProject()).toEqual(project); redo(); expect(getProject()).toEqual(first);
  });
  it('rejects invalid sizes and locked descendants with no partial transaction', () => {
    expect(setDimensions(id, Number.NaN).ok).toBe(false); expect(setDimensions(id, 16385).ok).toBe(false); expect(getDocument().history.past).toHaveLength(0);
    const locked = structuredClone(project); locked.layers[id].locked = true; replaceDocument(locked);
    expect(setRotation(id, 13).ok).toBe(false); expect(setDimensions(id, 100).ok).toBe(false); expect(getProject()).toEqual(locked);
  });
});
