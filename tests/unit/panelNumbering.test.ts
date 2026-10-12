import { beforeEach, expect, it } from 'vitest';
import { createProject, createLayer } from '../../src/domain/factories';
import type { PanelLayer } from '../../src/domain/types';
import { replaceDocument, execute, undo, redo } from '../../src/history/commandBus';
import { getProject, getDocument } from '../../src/state/documentStore';
import { addObject, deleteSelected } from '../../src/app/actions';
import { sessionStore } from '../../src/state/sessionStore';
import { addPage } from '../../src/pages/commands';
import { copyToClipboard, pasteFromClipboard } from '../../src/layers/clipboard';
import { commitCut } from '../../src/panels/cutPanel';
import { validateProject } from '../../src/domain/validate';
import { migrateProject } from '../../src/storage/migrateProject';
import { sortPanelReadingOrder } from '../../src/panels/readingOrder';
import { assignNewPanelNumbers } from '../../src/panels/numbering';

beforeEach(() => { expect(replaceDocument(createProject()).ok).toBe(true); });
const number = (id: string) => (getProject().layers[id] as PanelLayer).editorNumber;
function add(x = 0, y = 0) { const r = addObject('rect-panel', sessionStore.getState().activePageId, { x, y }); if (!r.ok) throw Error(JSON.stringify(r)); return r.value; }
it('keeps creation numbers across movement/deletion, allocates across pages, resets for a new comic', () => {
  const a = add(), b = add(); expect([number(a), number(b)]).toEqual([1, 2]);
  sessionStore.setState({ selection: [b] }); expect(deleteSelected().ok).toBe(true);
  const c = add(80, 30); expect(number(c)).toBe(2);
  expect(execute({ label: '移动', context: { pageId: getProject().pageOrder[0], selection: [a] }, mutate(d) { d.layers[a].matrix = [1, 0, 0, 1, 100, 100]; } }).ok).toBe(true); expect(number(a)).toBe(1);
  expect(addPage(null).ok).toBe(true); expect(number(add())).toBe(3);
  expect(replaceDocument(createProject()).ok).toBe(true); expect(number(add())).toBe(1);
});
it('assigns a split batch in reading order and atomically restores counters with undo/redo', () => {
  const a = add(); const before = structuredClone(getProject());
  const cut = commitCut(a, { axis: 'vertical', ratio: .5, gap: 16 }); expect(cut.ok).toBe(true); if (!cut.ok) return;
  expect(cut.value.map(number)).toEqual([2, 1]); expect(getProject().layers[a]).toBeUndefined();
  const after = structuredClone(getProject()); expect(undo().ok).toBe(true); expect(getProject()).toEqual(before);
  expect(redo().ok).toBe(true); expect(getProject()).toEqual(after);
  expect(undo().ok).toBe(true); expect(number(add())).toBe(2); expect(getDocument().history.future).toHaveLength(0);
});
it('copies a numbered tree with new unique numbers and never allocates numbers for a draft', () => {
  const a = add(); expect(copyToClipboard([a]).ok).toBe(true); expect(pasteFromClipboard(getProject().pageOrder[0]).ok).toBe(true);
  expect(Object.values(getProject().layers).flatMap(l => l.type === 'panel' ? [l.editorNumber] : [])).toEqual([1, 2]);
  const counter = getProject().nextPanelNumber; for (let i = 0; i < 100; i++) createLayer('panel', getProject().pageOrder[0]); expect(getProject().nextPanelNumber).toBe(counter);
});
it('rejects missing/duplicate/overflow numbers, template numbering and rolls failed batches back', () => {
  const a = add(), b = add(), p = structuredClone(getProject()); (p.layers[b] as PanelLayer).editorNumber = number(a); expect(validateProject(p).ok).toBe(false);
  delete (p.layers[b] as PanelLayer).editorNumber; expect(validateProject(p).ok).toBe(false);
  const empty = createProject(); const last = createLayer('panel', empty.pageOrder[0]) as PanelLayer; last.editorNumber = Number.MAX_SAFE_INTEGER - 1; empty.layers[last.id] = last; empty.pages[last.pageId].roots.push(last.id); empty.nextPanelNumber = Number.MAX_SAFE_INTEGER; expect(replaceDocument(empty).ok).toBe(true);
  const before = getProject(); expect(addObject('rect-panel', empty.pageOrder[0], { x: 0, y: 0 }).ok).toBe(false); expect(getProject()).toBe(before); expect(getDocument().history.past).toHaveLength(0);
  const invalid = structuredClone(empty); invalid.schemaVersion = 4; expect(validateProject(invalid).ok).toBe(false);
});
it('migrates old white panels without repainting them, then preserves numbers on the next load', () => {
  const p = createProject({ background: false }); p.schemaVersion = 4; delete p.nextPanelNumber;
  const pageId = p.pageOrder[0], right = createLayer('panel', pageId) as PanelLayer, left = createLayer('panel', pageId) as PanelLayer;
  right.matrix = [1, 0, 0, 1, 700, 5]; left.style.fill = '#FFFFFFFF'; p.layers[right.id] = right; p.layers[left.id] = left; p.pages[pageId].roots = [right.id, left.id];
  const migrated = migrateProject(p); expect(migrated.ok).toBe(true); if (!migrated.ok) return;
  expect((migrated.value.layers[left.id] as PanelLayer).editorNumber).toBe(2); expect((migrated.value.layers[right.id] as PanelLayer).editorNumber).toBe(1);
  expect((migrated.value.layers[left.id] as PanelLayer).style.fill).toBe('#FFFFFFFF'); expect(p.layers[left.id]).not.toHaveProperty('editorNumber'); expect(migrateProject(migrated.value)).toEqual(migrated);
});
it('uses stable fixed rows instead of a nontransitive comparison', () => {
  const result = sortPanelReadingOrder([{ id: 'r', bounds: { x: 100, y: 0, width: 80, height: 100 }, paintIndex: 0 }, { id: 'l', bounds: { x: 0, y: 20, width: 80, height: 100 }, paintIndex: 1 }, { id: 'next', bounds: { x: 0, y: 40, width: 80, height: 100 }, paintIndex: 2 }]);
  expect(result).toEqual({ ok: true, value: ['r', 'l', 'next'] }); expect(sortPanelReadingOrder([{ id: 'bad', bounds: { x: 0, y: 0, width: 0, height: 1 }, paintIndex: 0 }]).ok).toBe(false);
  expect(assignNewPanelNumbers(createProject(), []).ok).toBe(true);
});
