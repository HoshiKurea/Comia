import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import { apply, multiply, worldMatrix } from '../../src/geometry/matrix';
import { execute, replaceDocument, undo } from '../../src/history/commandBus';
import { groupLayers, ungroup } from '../../src/layers/group';
import { getProject } from '../../src/state/documentStore';
import { setLocked } from '../../src/layers/visibility';

let ids: string[];
beforeEach(() => {
  const project = createProject();
  const pageId = project.pageOrder[0];
  ids = [];
  for (let i = 0; i < 3; i++) {
    const layer = createLayer('panel', pageId);
    layer.matrix = [1.2, 0.1, -0.2, 0.8, 100 + 500 * i, 120 + i * 70];
    project.layers[layer.id] = layer;
    project.pages[pageId].roots.push(layer.id);
    ids.push(layer.id);
  }
  expect(replaceDocument(project).ok).toBe(true);
});

describe('grouping', () => {
  it('preserves child world matrices and sibling order through group, ungroup and undo', () => {
    const before = ids.map((id) => worldMatrix(getProject(), id));
    const grouped = groupLayers([ids[1], ids[0]]);
    expect(grouped.ok).toBe(true);
    if (!grouped.ok) return;
    const project = getProject();
    expect(project.pages[project.pageOrder[0]].roots).toEqual([grouped.value, ids[2]]);
    for (let i = 0; i < 3; i++) expect(worldMatrix(project, ids[i])).toEqual(before[i]);
    const group = project.layers[grouped.value];
    expect(group.type).toBe('group');
    if (group.type !== 'group') return;
    const childBefore = apply(worldMatrix(project, ids[0]), { x: 200, y: 100 });
    const expected = apply(multiply([1, 0, 0, 1, 27, -13], worldMatrix(project, ids[0])), { x: 200, y: 100 });
    expect(execute({ label: '移动编组', context: { pageId: project.pageOrder[0], selection: [grouped.value] }, mutate(draft) {
      draft.layers[grouped.value].matrix = multiply([1, 0, 0, 1, 27, -13], group.matrix);
    } }).ok).toBe(true);
    expect(apply(worldMatrix(getProject(), ids[0]), { x: 200, y: 100 })).toEqual(expected);
    expect(childBefore).not.toEqual(expected);
    const split = ungroup(grouped.value);
    expect(split.ok).toBe(true);
    expect(getProject().pages[project.pageOrder[0]].roots).toEqual(ids);
    expect(apply(worldMatrix(getProject(), ids[0]), { x: 200, y: 100 })).toEqual(expected);
    expect(undo().ok).toBe(true);
    expect(getProject().layers[grouped.value]?.type).toBe('group');
  });

  it('rejects noncontiguous selections without changing the document', () => {
    const before = structuredClone(getProject());
    const result = groupLayers([ids[0], ids[2]]);
    expect(result.ok).toBe(false);
    expect(getProject()).toEqual(before);
  });

  it('refuses a locked descendant', () => {
    const project = getProject();
    expect(setLocked([ids[0]], true).ok).toBe(true);
    const result = groupLayers([ids[0], ids[1]]);
    expect(result.ok).toBe(false);
    expect(project.pages[project.pageOrder[0]].roots).toEqual(ids);
  });
});
