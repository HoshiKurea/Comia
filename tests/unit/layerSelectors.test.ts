import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import { buildRows, rangeSelection } from '../../src/layers/selectors';
import { renameLayer, setLabel } from '../../src/layers/visibility';
import { replaceDocument, undo } from '../../src/history/commandBus';
import { getDocument, getProject } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';
import type { Project } from '../../src/domain/types';
let project: Project, ids: string[];
beforeEach(() => {
  project = createProject(); const pageId = project.pageOrder[0], group = createLayer('group', pageId), a = createLayer('panel', pageId), b = createLayer('text', pageId), root = createLayer('panel', pageId);
  if (group.type !== 'group') throw Error('factory'); group.children = [a.id, b.id]; a.parentId = b.parentId = group.id; a.name = '第一格'; b.name = '你好😀对白'; b.colorLabel = 'blue'; a.colorLabel = 'red'; root.name = '封面'; group.visible = false; group.locked = true;
  for (const layer of [group, a, b, root]) project.layers[layer.id] = layer; project.pages[pageId].roots = [group.id, root.id]; ids = [group.id, a.id, b.id, root.id]; expect(replaceDocument(project).ok).toBe(true); sessionStore.setState({ activePageId: pageId, selection: [], expanded: [] });
});
describe('layer rows and metadata', () => {
  it('renders reverse siblings, inherited flags and explicit expanded rows', () => {
    const pageId = project.pageOrder[0]; expect(buildRows(project, pageId, [], { name: '', color: null }).map((row) => row.id)).toEqual([ids[3], ids[0]]);
    const rows = buildRows(project, pageId, [ids[0]], { name: '', color: null }); expect(rows.map((row) => row.id)).toEqual([ids[3], ids[0], ids[2], ids[1]]);
    expect(rows[2]).toMatchObject({ effectiveVisible: false, effectiveLocked: true, ancestorIds: [ids[0]], depth: 1 });
  });
  it('ANDs trimmed name and color, keeps ancestors as context and leaves expansion/project untouched', () => {
    const rows = buildRows(project, project.pageOrder[0], [], { name: '  你好😀  ', color: 'blue' }); expect(rows.map((row) => row.id)).toEqual([ids[0], ids[2]]); expect(rows[0].contextOnly).toBe(true); expect(rows[1].contextOnly).toBe(false);
    expect(buildRows(project, project.pageOrder[0], [], { name: '你好', color: 'red' })).toEqual([]); expect(sessionStore.getState().expanded).toEqual([]); expect(getProject()).toEqual(project);
  });
  it('ranges only across the complete current list, including offscreen virtual rows, and recovers a missing anchor', () => {
    const rows = buildRows(project, project.pageOrder[0], [ids[0]], { name: '', color: null }); expect(rangeSelection(rows, ids[3], ids[1])).toEqual([ids[3], ids[0], ids[2], ids[1]]); expect(rangeSelection(rows, 'deleted', ids[2])).toEqual([ids[2]]);
    const filtered = buildRows(project, project.pageOrder[0], [], { name: '', color: 'blue' }); expect(rangeSelection(filtered, ids[0], ids[2])).toEqual([ids[0], ids[2]]);
  });
  it('changes locked layer labels in one transaction and undoes without changing visibility', () => {
    expect(setLabel([ids[0], ids[2], ids[2]], 'purple').ok).toBe(true); expect(getDocument().history.past).toHaveLength(1); expect(getProject().layers[ids[2]].colorLabel).toBe('purple'); expect(getProject().layers[ids[0]].visible).toBe(false);
    undo(); expect(getProject()).toEqual(project); expect(setLabel([ids[0], 'missing'], 'red').ok).toBe(false); expect(getProject()).toEqual(project);
    expect(setLabel([ids[0]], 'black' as any).ok).toBe(false);
  });
  it('trims names and counts Unicode codepoints rather than UTF16 units, rejecting empty and excessive names', () => {
    expect(renameLayer(ids[2], '  😀对白  ').ok).toBe(true); expect(getProject().layers[ids[2]].name).toBe('😀对白');
    expect(renameLayer(ids[2], '😀'.repeat(80)).ok).toBe(true); const before = getProject(); expect(renameLayer(ids[2], '😀'.repeat(81)).ok).toBe(false); expect(renameLayer(ids[2], '  ').ok).toBe(false); expect(getProject()).toEqual(before);
  });
});
