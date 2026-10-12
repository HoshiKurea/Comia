import { beforeEach, expect, it } from 'vitest';
import { createLayer, createProject } from '../../src/domain/factories';
import { addObject, createObjectDraft, deleteSelected, placeObjectDraft } from '../../src/app/actions';
import { execute, redo, replaceDocument, undo } from '../../src/history/commandBus';
import { getDocument, getProject } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';
import { renameLayer } from '../../src/layers/visibility';
import { copyToClipboard, pasteFromClipboard } from '../../src/layers/clipboard';
import { commitCut } from '../../src/panels/cutPanel';
import { makeGrid } from '../../src/panels/presets';
import { applyIndependentLayout } from '../../src/panels/independentLayout';
import type { PanelLayer } from '../../src/domain/types';

beforeEach(() => { expect(replaceDocument(createProject()).ok).toBe(true); });
const pageId = () => sessionStore.getState().activePageId;
function add() { const r = addObject('rect-panel', pageId(), { x: 0, y: 0 }); if (!r.ok) throw Error(JSON.stringify(r)); return r.value; }
function frames() { return Object.values(getProject().layers).filter((l): l is PanelLayer => l.type === 'panel'); }
it('starts at one despite uncommitted factories and names a batch in actual assigned reading order', () => {
  for (let i = 0; i < 20; i++) expect(createObjectDraft('layout:grid-2x2', pageId()).ok).toBe(true);
  const r = addObject('layout:grid-2x2', pageId(), { x: 0, y: 0 }); expect(r.ok).toBe(true);
  expect(frames().map(p => [p.name, p.editorNumber])).toEqual([['分镜 2', 2], ['分镜 1', 1], ['分镜 4', 4], ['分镜 3', 3]]);
  expect(getDocument().history.past).toHaveLength(1); expect(JSON.stringify(getProject())).not.toContain('defaultNamedPanelIds');
});
it('reuses the deleted tail name, retains middle gaps and restores names on undo/redo and history branches', () => {
  const ids = [add(), add(), add()]; expect(frames().map(p => p.name)).toEqual(['分镜 1','分镜 2','分镜 3']);
  sessionStore.setState({ selection: [ids[2]] }); expect(deleteSelected().ok).toBe(true); const deleted = structuredClone(getProject());
  const c = add(); expect(getProject().layers[c].name).toBe('分镜 3'); const created = structuredClone(getProject());
  expect(undo().ok).toBe(true); expect(getProject()).toEqual(deleted); expect(redo().ok).toBe(true); expect(getProject()).toEqual(created);
  sessionStore.setState({ selection: [ids[1]] }); expect(deleteSelected().ok).toBe(true); { const next = add(); expect(getProject().layers[next].name).toBe('分镜 4'); }
  expect(undo().ok).toBe(true); { const next = add(); expect(getProject().layers[next].name).toBe('分镜 4'); } expect(getDocument().history.future).toHaveLength(0);
});
it('names both independent generator and cut results from the committed numbers, without a parent consuming a name', () => {
  const a = add(), cut = commitCut(a, { axis: 'vertical', ratio: .5, gap: 16 }); expect(cut.ok).toBe(true);
  expect(frames().map(p => p.name)).toEqual(['分镜 2','分镜 1']);
  const tree = makeGrid({ x: 0, y: 0, width: 800, height: 600 }, 2, 4, 16, 16); if (!tree.ok) throw Error('grid'); expect(applyIndependentLayout(pageId(), tree.value).ok).toBe(true);
  expect(frames().map(p => p.name)).toEqual([2,1,6,5,4,3,10,9,8,7].map(i => `分镜 ${i}`));
});
it('preserves explicitly provided, manually renamed and copied names even when they resemble a numbered default', () => {
  const a = add(); expect(renameLayer(a, '分镜 99').ok).toBe(true); expect(copyToClipboard([a]).ok).toBe(true); expect(pasteFromClipboard(pageId()).ok).toBe(true);
  expect(frames().map(p => p.name)).toEqual(['分镜 99','分镜 99']); expect(frames().map(p => p.editorNumber)).toEqual([1,2]);
  const custom = createLayer('panel', pageId(), '分镜 77'); expect(placeObjectDraft({ layer: custom, descendants: [] }, pageId(), { x: 0, y: 0 }).ok).toBe(true);
  expect(getProject().layers[custom.id].name).toBe('分镜 77'); const next = add(); expect(getProject().layers[next].name).toBe('分镜 4'); expect(getProject().layers[a].name).toBe('分镜 99');
});
it('does not let custom numeric names override the current actual next number', () => {
  const a = add(), b = add(); expect(renameLayer(a, '分镜 2').ok).toBe(true); expect(renameLayer(b, '分镜 3').ok).toBe(true);
  sessionStore.setState({ selection: [b] }); expect(deleteSelected().ok).toBe(true); const next = add();
  expect(getProject().layers[a].name).toBe('分镜 2'); expect(getProject().layers[next].name).toBe('分镜 2');
  expect((getProject().layers[next] as PanelLayer).editorNumber).toBe(2);
});
it('rejects default-name intent for an existing panel and rolls back the whole edit', () => {
  const a = add(), before = structuredClone(getProject()), count = getDocument().history.past.length;
  const r = execute({ label: '错误命名目标', defaultNamedPanelIds: [a], context: { pageId: pageId(), selection: [a] }, mutate(d) { (d.layers[a] as PanelLayer).style.borderWidth = 12; } });
  expect(r.ok).toBe(false); expect(getProject()).toEqual(before); expect(getDocument().history.past).toHaveLength(count);
});
it('permits an arbitrary custom numeric name without treating it as a numbering overflow', () => {
  const a = add(); expect(renameLayer(a, `分镜 ${Number.MAX_SAFE_INTEGER}`).ok).toBe(true);
  const before = structuredClone(getProject()), count = getDocument().history.past.length;
  const result = addObject('rect-panel', pageId(), { x: 0, y: 0 }); expect(result.ok).toBe(true); if (!result.ok) return;
  expect(getProject().layers[result.value].name).toBe('分镜 2'); expect(getProject().layers[a]).toEqual(before.layers[a]); expect(getDocument().history.past).toHaveLength(count + 1);
});
