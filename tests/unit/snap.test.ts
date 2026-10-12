import { describe, expect, it } from 'vitest';
import { collectMoveSnap, snapMove, type SnapCandidate } from '../../src/interaction/snap';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import { rotationRad, translation } from '../../src/geometry/matrix';
const box = { x: 100, y: 100, width: 80, height: 40 };
const candidate = (value: number, sourceId: string | null = 'z', kind: 'edge' | 'center' = 'edge'): SnapCandidate => ({ axis: 'x', value, sourceId, kind, bounds: { x: value, y: 10, width: 20, height: 80 } });
describe('move snap', () => {
  it.each([.25, 1, 4])('acquires at 6 screen px and holds up to 9 screen px at zoom %s', (zoom) => {
    const c = candidate(300), delta = { x: 200 - 5.9 / zoom, y: 50 };
    const wide = { ...box, width: 800 };
    const first = snapMove(wide, delta, [c], zoom); expect(first.delta.x).toBeCloseTo(200, 8); expect(first.delta.y).toBe(50); expect(first.guides).toEqual([c]);
    const held = snapMove(wide, { x: 200 - 8 / zoom, y: 50 }, [c], zoom, first.locks); expect(held.delta.x).toBeCloseTo(200, 8);
    // Empty candidates ensure no other moving feature can reacquire after leaving the held target.
    const released = snapMove(wide, { x: 200 - 9.1 / zoom, y: 50 }, [], zoom, held.locks); expect(released.guides).toHaveLength(0);
    expect(snapMove(wide, { x: 200 - 6.1 / zoom, y: 50 }, [c], zoom).guides).toHaveLength(0);
  });
  it('breaks ties by page edge, center and stable id irrespective of insertion order', () => {
    const delta = { x: 196, y: 0 }, a = candidate(300, 'a'), z = candidate(300, 'z'), center = candidate(300, 'x', 'center'), page = candidate(300, null);
    expect(snapMove(box, delta, [z, a], 1).guides).toEqual([a]); expect(snapMove(box, delta, [a, z], 1).guides).toEqual([a]);
    expect(snapMove(box, delta, [a, center], 1).guides).toEqual([center]); expect(snapMove(box, delta, [center, page], 1).guides).toEqual([page]);
  });
  it('excludes hidden ancestors and selection subtree but retains locked targets and rotated geometry bounds', () => {
    const project = createProject(), pageId = project.pageOrder[0], selected = createLayer('panel', pageId), group = createLayer('group', pageId), hidden = createLayer('panel', pageId), locked = createLayer('panel', pageId);
    if (group.type !== 'group') throw Error('group'); group.children = [hidden.id]; group.visible = false; hidden.parentId = group.id; locked.locked = true; locked.matrix = rotationRad(Math.PI / 4); selected.matrix = translation(40, 20);
    for (const layer of [selected, group, hidden, locked]) project.layers[layer.id] = layer; project.pages[pageId].roots = [selected.id, group.id, locked.id];
    const snap = collectMoveSnap(project, pageId, [selected.id])!;
    expect(snap.candidates.filter((c) => c.sourceId === hidden.id || c.sourceId === group.id || c.sourceId === selected.id)).toHaveLength(0);
    expect(snap.candidates.filter((c) => c.sourceId === locked.id)).toHaveLength(6);
    expect(snap.candidates.find((c) => c.sourceId === locked.id && c.axis === 'x')!.value).toBeCloseTo(-400 / Math.sqrt(2));
    const all = collectMoveSnap(project, pageId, [group.id]); expect(all).toBeNull();
  });
  it('uses multi-selection union and a single page delta, independent of size quantization', () => {
    const project = createProject(), pageId = project.pageOrder[0], a = createLayer('panel', pageId), b = createLayer('panel', pageId);
    b.matrix = translation(700, 500); project.layers[a.id] = a; project.layers[b.id] = b; project.pages[pageId].roots = [a.id, b.id];
    const snap = collectMoveSnap(project, pageId, [a.id, b.id])!; expect(snap.bounds).toEqual({ x: 0, y: 0, width: 1300, height: 900 });
    const result = snapMove(snap.bounds, { x: 3.5, y: 30 }, snap.candidates, 1); expect(result.delta.x).toBe(0); expect(result.delta.y).toBe(30);
    expect(result.locks.x?.candidate.sourceId).toBeNull();
  });
});
