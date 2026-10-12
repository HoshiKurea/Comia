import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import { replaceDocument, undo } from '../../src/history/commandBus';
import { moveLayer, moveLayers, reorderSiblings } from '../../src/layers/reorder';
import { getProject } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';

let ids: string[], pageId: string;
beforeEach(() => {
  const project = createProject();
  pageId = project.pageOrder[0]; ids = [];
  for (let i = 0; i < 4; i++) {
    const layer = createLayer('panel', pageId);
    project.layers[layer.id] = layer;
    project.pages[pageId].roots.push(layer.id);
    ids.push(layer.id);
  }
  expect(replaceDocument(project).ok).toBe(true);
  sessionStore.setState({ filter: { name: '', color: null } });
});

describe('sibling stacking order', () => {
  it('moves one item up, to top and restores order on undo', () => {
    expect(moveLayer(ids[0], 'up').ok).toBe(true);
    expect(getProject().pages[pageId].roots).toEqual([ids[1], ids[0], ids[2], ids[3]]);
    expect(moveLayer(ids[0], 'top').ok).toBe(true);
    expect(getProject().pages[pageId].roots).toEqual([ids[1], ids[2], ids[3], ids[0]]);
    expect(undo().ok).toBe(true);
    expect(getProject().pages[pageId].roots).toEqual([ids[1], ids[0], ids[2], ids[3]]);
  });

  it('retains relative order for selected siblings', () => {
    expect(reorderSiblings({ draggedIds: [ids[2], ids[0]], parentId: null, beforeId: ids[3] }).ok).toBe(true);
    expect(getProject().pages[pageId].roots).toEqual([ids[1], ids[0], ids[2], ids[3]]);
  });

  it('rejects sorting with a filter without changing draw order', () => {
    sessionStore.setState({ filter: { name: '分镜', color: null } });
    expect(moveLayer(ids[0], 'top').ok).toBe(false);
    expect(getProject().pages[pageId].roots).toEqual(ids);
  });
  it('moves noncontiguous selections as one block in original relative order and undoes atomically', () => {
    const original = getProject(); expect(moveLayers([ids[2], ids[0]], 'top').ok).toBe(true); expect(getProject().pages[pageId].roots).toEqual([ids[1], ids[3], ids[0], ids[2]]); undo(); expect(getProject()).toEqual(original);
    expect(moveLayers([ids[2], ids[1]], 'bottom').ok).toBe(true); expect(getProject().pages[pageId].roots).toEqual([ids[1], ids[2], ids[0], ids[3]]);
  });
  it('up/down crosses one neighbor without reversing the block and boundary no-ops keep gaps unchanged', () => {
    expect(moveLayers([ids[1], ids[2]], 'up').ok).toBe(true); expect(getProject().pages[pageId].roots).toEqual([ids[0], ids[3], ids[1], ids[2]]); undo();
    expect(moveLayers([ids[1], ids[2]], 'down').ok).toBe(true); expect(getProject().pages[pageId].roots).toEqual([ids[1], ids[2], ids[0], ids[3]]); undo();
    expect(moveLayers([ids[0], ids[2]], 'down').ok).toBe(true); expect(getProject().pages[pageId].roots).toEqual(ids);
  });
  it('rejects one locked sibling and a selection across parents without partial reordering', () => {
    const project = structuredClone(getProject()); project.layers[ids[1]].locked = true; replaceDocument(project); expect(moveLayers([ids[0], ids[1]], 'top').ok).toBe(false); expect(getProject()).toEqual(project);
    const group = createLayer('group', pageId); if (group.type !== 'group') throw Error('factory'); group.children = [ids[0]]; project.layers[group.id] = group; project.layers[ids[0]].parentId = group.id; project.pages[pageId].roots = [group.id, ...ids.slice(1)]; replaceDocument(project);
    expect(moveLayers([ids[0], ids[2]], 'top').ok).toBe(false); expect(getProject()).toEqual(project);
    group.locked = true; replaceDocument(project); expect(reorderSiblings({ draggedIds: [ids[0]], parentId: group.id, beforeId: null }).ok).toBe(false);
  });
});
