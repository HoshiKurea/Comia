import { beforeEach, expect, it } from 'vitest';
import { createLayer, createProject } from '../../src/domain/factories';
import { addObject, changeLayer, deleteSelected } from '../../src/app/actions';
import { execute, redo, replaceDocument, undo } from '../../src/history/commandBus';
import { getDocument, getProject } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';
import type { PanelLayer } from '../../src/domain/types';
import { addPage } from '../../src/pages/commands';
import { makeGrid } from '../../src/panels/presets';
import { applyIndependentLayout } from '../../src/panels/independentLayout';
import { placeComponentAtPageCenter } from '../../src/library/placement';
import { apply, worldMatrix } from '../../src/geometry/matrix';
import { polyBounds } from '../../src/geometry/polygon';

beforeEach(() => { expect(replaceDocument(createProject()).ok).toBe(true); });
const numberOfNew = () => { const id = add(); return (getProject().layers[id] as PanelLayer).editorNumber; };
const panels = () => Object.values(getProject().layers).filter((l): l is PanelLayer => l.type === 'panel');
function add() { const result = addObject('rect-panel', sessionStore.getState().activePageId, { x: 0, y: 0 }); if (!result.ok) throw Error(JSON.stringify(result)); return result.value; }
function remove(ids: string[]) { sessionStore.setState({ selection: ids }); expect(deleteSelected().ok).toBe(true); }
it('creates exactly eight independently editable root panels, restores the entire batch and reuses no parent', () => {
  const pageId = sessionStore.getState().activePageId, before = structuredClone(getProject()), grid = makeGrid({ x: 50, y: 50, width: 800, height: 600 }, 2, 4, 16, 16);
  if (!grid.ok) throw Error('grid'); const made = applyIndependentLayout(pageId, grid.value); expect(made.ok).toBe(true); if (!made.ok) return;
  const after = structuredClone(getProject()); expect(panels()).toHaveLength(8); expect(panels().every(p => p.parentId === null && p.role === 'leaf')).toBe(true);
  expect(panels().map(p => p.editorNumber)).toEqual([4, 3, 2, 1, 8, 7, 6, 5]); expect(getDocument().history.past).toHaveLength(1);
  expect(undo().ok).toBe(true); expect(getProject()).toEqual(before); expect(redo().ok).toBe(true); expect(getProject()).toEqual(after);
  expect(changeLayer(made.value[3], '编辑独立框', l => { if (l.type === 'panel') { l.style.borderWidth = 12; l.matrix = [l.matrix[0], l.matrix[1], l.matrix[2], l.matrix[3], l.matrix[4] + 20, l.matrix[5]]; } }).ok).toBe(true);
  for (const id of made.value.filter(id => id !== made.value[3])) expect(getProject().layers[id]).toEqual(after.layers[id]);
});
it('centers the entire component layout in a transformed ordinary group and persists only siblings', () => {
  const pageId = sessionStore.getState().activePageId, group = createLayer('group', pageId); if (group.type !== 'group') throw Error('group'); group.matrix = [1.2, .2, -.1, .9, 40, 80];
  expect(execute({ label: '编组', context: { pageId, selection: [] }, mutate(d) { d.layers[group.id] = group; d.pages[pageId].roots.push(group.id); } }).ok).toBe(true);
  sessionStore.setState({ scopeId: group.id }); const before = structuredClone(getProject()); expect(placeComponentAtPageCenter('layout:grid-2x3', pageId).ok).toBe(true);
  const children = panels(); expect(children).toHaveLength(6); expect(children.every(p => p.parentId === group.id && p.role === 'leaf')).toBe(true);
  const actual = polyBounds(children.flatMap(p => p.geometry.map(v => apply(worldMatrix(getProject(), p.id), v))));
  // Placement aligns the layout's local center through inverse(Wgroup), without dropping ancestor scale/rotation.
  const center = apply(worldMatrix(getProject(), children[0].id), { x: 300, y: 400 });
  expect(center.x).toBeCloseTo(getProject().pages[pageId].width / 2); expect(center.y).toBeCloseTo(getProject().pages[pageId].height / 2); expect(actual.width).toBeGreaterThan(0);
  expect(undo().ok).toBe(true); expect(getProject()).toEqual(before);
});
it('uses the actual maximum, retains middle gaps and falls back to one when every panel is deleted', () => {
  const ids = [add(), add(), add(), add()]; remove([ids[1]]); expect(numberOfNew()).toBe(5);
  expect(undo().ok).toBe(true); remove([ids[2], ids[3]]); expect(numberOfNew()).toBe(2);
  remove(panels().map(p => p.id)); expect(getProject().nextPanelNumber).toBe(1); expect(numberOfNew()).toBe(1);
});
it('counts hidden panels on other pages, ignores an obsolete high-water cache and restores numbering on history branches', () => {
  const a = add(), b = add(); expect(changeLayer(b, '隐藏', l => { l.visible = false; }).ok).toBe(true); expect(addPage(null).ok).toBe(true);
  const old = structuredClone(getProject()); old.nextPanelNumber = 999; expect(replaceDocument(old).ok).toBe(true);
  const c = add(); expect((getProject().layers[c] as PanelLayer).editorNumber).toBe(3); expect(undo().ok).toBe(true); expect(getProject().nextPanelNumber).toBe(999);
  const next = add(); expect((getProject().layers[next] as PanelLayer).editorNumber).toBe(3); expect(getDocument().history.future).toHaveLength(0);
  expect((getProject().layers[a] as PanelLayer).editorNumber).toBe(1);
});
