import { beforeEach, expect, it } from 'vitest';
import type { PanelLayer } from '../../src/domain/types';
import { createLayer, createProject } from '../../src/domain/factories';
import { addObject, deleteSelected } from '../../src/app/actions';
import { getDocument, getProject } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';
import { execute, redo, replaceDocument, undo } from '../../src/history/commandBus';
import { renameLayer } from '../../src/layers/visibility';
import { applyIndependentLayout } from '../../src/panels/independentLayout';
import { makeGrid } from '../../src/panels/presets';
import { planPanelReplacementNumbers } from '../../src/panels/numbering';
import { migrateProject } from '../../src/storage/migrateProject';
import { validateProject } from '../../src/domain/validate';
import { addPage } from '../../src/pages/commands';

beforeEach(() => { expect(replaceDocument(createProject()).ok).toBe(true); });
const panel = (id: string) => getProject().layers[id] as PanelLayer;
function add() { const p = getProject(), r = addObject('rect-panel', p.pageOrder[0], { x: 0, y: 0 }); if (!r.ok) throw Error(JSON.stringify(r)); return r.value; }
function cut(id: string, count = 3) {
  const tree = makeGrid({ x: 0, y: 0, width: 600, height: 400 }, 1, count, 8, 8); if (!tree.ok) throw Error('grid');
  const r = applyIndependentLayout(panel(id).pageId, tree.value, id); if (!r.ok) throw Error(JSON.stringify(r)); return r.value;
}
it('inserts 1,2,3 and shifts the old 2,3 to 4,5 atomically in RTL order', () => {
  const a = add(), b = add(), c = add(), before = structuredClone(getProject()), past = getDocument().history.past.length;
  const ids = cut(a); expect(ids.map(id => panel(id).editorNumber)).toEqual([3, 2, 1]);
  expect(ids.map(id => panel(id).name)).toEqual(['分镜 3', '分镜 2', '分镜 1']);
  expect([panel(b).editorNumber, panel(c).editorNumber]).toEqual([4, 5]); expect([panel(b).name, panel(c).name]).toEqual(['分镜 4', '分镜 5']);
  expect(ids.every(id => panel(id).parentId === null && panel(id).role === 'leaf')).toBe(true);
  expect(getProject().nextPanelNumber).toBe(6); expect(getDocument().history.past.length).toBe(past + 1);
  const after = structuredClone(getProject()); expect(undo().ok).toBe(true); expect(getProject()).toEqual(before);
  expect(redo().ok).toBe(true); expect(getProject()).toEqual(after);
});
it('keeps custom names, including an explicitly typed default name', () => {
  const a = add(), b = add(), c = add(); expect(renameLayer(b, '分镜 2').ok).toBe(true); expect(renameLayer(c, '特写').ok).toBe(true);
  cut(a); expect([panel(b).editorNumber, panel(c).editorNumber]).toEqual([4, 5]); expect([panel(b).name, panel(c).name]).toEqual(['分镜 2', '特写']);
  expect(panel(b).nameMode).toBe('custom');
});
it('cuts a middle panel, then ordinary creation follows the current maximum', () => {
  const a = add(), b = add(), c = add(); const ids = cut(b, 2);
  expect([panel(a).editorNumber, ...ids.map(id => panel(id).editorNumber), panel(c).editorNumber]).toEqual([1, 3, 2, 4]);
  const d = add(); expect(panel(d).editorNumber).toBe(5); sessionStore.setState({ selection: [d] }); expect(deleteSelected().ok).toBe(true); expect(panel(add()).name).toBe('分镜 5');
});
it('renumbers hidden locked later panels on another page without changing content', () => {
  const a = add(); expect(addPage(null).ok).toBe(true); const b = add(); const before = getProject();
  expect(execute({ label: '锁定隐藏', context: { pageId: panel(b).pageId, selection: [b] }, mutate(p) { p.layers[b].visible = false; p.layers[b].locked = true; } }).ok).toBe(true);
  const old = structuredClone(panel(b)); sessionStore.setState({activePageId: panel(a).pageId}); cut(a); const next = panel(b);
  expect(next.editorNumber).toBe(4); expect({ ...next, name: old.name, editorNumber: old.editorNumber }).toEqual(old); expect(before.layers[a]).toBeDefined();
});
it('rejects invalid replacement intents and integer overflow without partial mutation', () => {
  const a = add(), b = add(), before = structuredClone(getProject()), draft = structuredClone(before), n = createLayer('panel', panel(a).pageId) as PanelLayer;
  delete draft.layers[a]; draft.layers[n.id] = n; draft.pages[n.pageId].roots = [b, n.id];
  expect(planPanelReplacementNumbers(before, draft, { sourceId: a, newIds: [] }).ok).toBe(false);
  expect(planPanelReplacementNumbers(before, draft, { sourceId: a, newIds: [n.id, n.id] }).ok).toBe(false);
  const snapshot = structuredClone(draft); (before.layers[b] as PanelLayer).editorNumber = Number.MAX_SAFE_INTEGER - 1;
  const n2 = createLayer('panel', n.pageId) as PanelLayer; draft.layers[n2.id] = n2; draft.pages[n.pageId].roots.push(n2.id);
  const stable = structuredClone(draft); expect(planPanelReplacementNumbers(before, draft, { sourceId: a, newIds: [n.id, n2.id] }).ok).toBe(false); expect(draft).toEqual(stable); expect(snapshot.layers[n.id]).toEqual(n);
});
it('migrates format8 without renumbering and round trips format9 metadata', () => {
  const a = add(), b = add(), old = structuredClone(getProject()); old.schemaVersion = 8;
  delete (old.layers[a] as PanelLayer).nameMode; delete (old.layers[b] as PanelLayer).nameMode; old.layers[b].name = '特写';
  const original = structuredClone(old), migrated = migrateProject(old); expect(migrated.ok).toBe(true); if (!migrated.ok) return;
  expect(old).toEqual(original); expect(migrated.value.schemaVersion).toBe(9); expect((migrated.value.layers[a] as PanelLayer).nameMode).toBe('automatic'); expect((migrated.value.layers[b] as PanelLayer).nameMode).toBe('custom');
  expect(migrateProject(migrated.value)).toEqual(migrated); expect(validateProject(migrated.value).ok).toBe(true);
  expect(validateProject({ ...migrated.value, schemaVersion: 10 }).ok).toBe(false);
});
it.each([0, 20000])('keeps legacy owned text with width %s instead of rejecting an older valid file', width => {
  const p = createProject(); p.schemaVersion = 8; const pid = p.pageOrder[0], bubble = createLayer('bubble',pid), text = createLayer('text',pid);
  if(bubble.type!=='bubble'||text.type!=='text')throw Error('factory'); bubble.width=bubble.height=16; text.parentId=bubble.id;text.box={x:8,y:8,width,height:width};text.text.content='保留';text.text.align='center';bubble.children=[text.id];p.layers[bubble.id]=bubble;p.layers[text.id]=text;p.pages[pid].roots.push(bubble.id);
  const result=migrateProject(p);expect(result.ok).toBe(true);if(!result.ok)return;expect(result.value.layers[text.id]).toMatchObject({box:text.box,text:text.text,bubbleFrame:{mode:'manual',placement:'legacy',manualSize:{width,height:width}}});expect(validateProject(result.value).ok).toBe(true);
});
