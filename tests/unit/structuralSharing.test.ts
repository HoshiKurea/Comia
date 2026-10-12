import { beforeEach, expect, it } from 'vitest';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import { execute, redo, replaceDocument, undo } from '../../src/history/commandBus';
import { getProject } from '../../src/state/documentStore';
import { renameLayer } from '../../src/layers/visibility';
import { shareUnchanged } from '../../src/history/structuralSharing';

beforeEach(() => {
  const project = createProject(), pageId = project.pageOrder[0];
  for (let i = 0; i < 3; i++) {
    const layer = createLayer('panel', pageId); project.layers[layer.id] = layer; project.pages[pageId].roots.push(layer.id);
  }
  expect(replaceDocument(project).ok).toBe(true);
});

it('rename, undo and redo retain every unrelated layer and page while isolating changed metadata', () => {
  const initial = getProject(), pageId = initial.pageOrder[0], [id, other] = initial.pages[pageId].roots;
  expect(renameLayer(id, '新名称').ok).toBe(true);
  const renamed = getProject();
  expect(renamed.layers[id]).not.toBe(initial.layers[id]);
  expect(renamed.layers[other]).toBe(initial.layers[other]);
  expect(renamed.layers[id].matrix).toBe(initial.layers[id].matrix);
  expect(renamed.pages).toBe(initial.pages); expect(renamed.assets).toBe(initial.assets);
  expect(initial.layers[id].name).not.toBe('新名称');
  expect(undo().ok).toBe(true); expect(getProject()).toEqual(initial);
  expect(getProject().layers[other]).toBe(initial.layers[other]);
  expect(redo().ok).toBe(true); expect(getProject()).toEqual(renamed);
  expect(getProject().layers[other]).toBe(initial.layers[other]);
});

it('sharing preserves deletions, additions, reordering and an unchanged nested child without mutating the old tree', () => {
  const old = { items: [{ id: 1, values: [2, 3] }, { id: 2, values: [4] }], removed: { v: 5 } };
  const next = { items: [{ id: 1, values: [2, 3] }, { id: 3, values: [6] }], added: { v: 7 } };
  const before = structuredClone(old), result = shareUnchanged<unknown>(old, next) as typeof next;
  expect(result.items[0]).toBe(old.items[0]); expect(result).toEqual(next); expect(old).toEqual(before);
  expect('removed' in result).toBe(false); expect(result.added.v).toBe(7);
  const reordered = shareUnchanged(old.items, [structuredClone(old.items[1]), structuredClone(old.items[0])]);
  expect(reordered.map((item) => item.id)).toEqual([2, 1]); expect(old).toEqual(before);
});

it('a rejected mutation cannot change published references or history and the next transaction remains usable', () => {
  const initial = getProject(), pageId = initial.pageOrder[0], id = initial.pages[pageId].roots[0];
  expect(execute({ label: '无效', context: { pageId, selection: [] }, mutate(draft) { draft.layers[id].matrix = [0, 0, 0, 1, 0, 0]; } }).ok).toBe(false);
  expect(getProject()).toBe(initial); expect(getProject().layers[id]).toBe(initial.layers[id]);
  expect(renameLayer(id, '有效').ok).toBe(true); expect(initial.layers[id].name).not.toBe('有效');
});
