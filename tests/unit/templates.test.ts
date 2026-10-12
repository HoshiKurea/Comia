import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import { createObjectDraft, placeObjectDraft } from '../../src/app/actions';
import { redo, replaceDocument, undo } from '../../src/history/commandBus';
import { capturePanelTemplate, deleteUserTemplate } from '../../src/library/templates';
import { getProject } from '../../src/state/documentStore';

let rootId: string;
beforeEach(() => {
  const project = createProject(), pageId = project.pageOrder[0];
  const root = createLayer('panel', pageId), child = createLayer('panel', pageId);
  if (root.type !== 'panel' || child.type !== 'panel') throw new Error('panel factory failed');
  root.role = 'split'; root.children = [child.id]; root.matrix = [1, 0, 0, 1, 100, 200];
  root.geometry = root.geometry.map((point) => ({ x: point.x + 30, y: point.y + 40 }));
  child.parentId = root.id;
  child.geometry = [{ x: 35, y: 55 }, { x: 245, y: 55 }, { x: 245, y: 195 }, { x: 35, y: 195 }];
  project.layers[root.id] = root; project.layers[child.id] = child; project.pages[pageId].roots.push(root.id);
  rootId = root.id;
  expect(replaceDocument(project).ok).toBe(true);
});

describe('user panel templates', () => {
  it('captures a rotated negative-origin split as independent leaves while preserving its displayed rotation', () => {
    const project = createProject(), pageId = project.pageOrder[0];
    const root = createLayer('panel', pageId), child = createLayer('panel', pageId), leaf = createLayer('panel', pageId);
    if (root.type !== 'panel' || child.type !== 'panel' || leaf.type !== 'panel') throw Error('panel factory');
    const rect = (x: number, y: number, width: number, height: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
    root.geometry = rect(-5000, -2000, 600, 400); child.geometry = rect(-4990, -1990, 200, 300); leaf.geometry = rect(-4980, -1980, 100, 100);
    const angle = 37 * Math.PI / 180; root.matrix = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 5100, 2200];
    root.role = child.role = 'split'; root.children = [child.id]; child.parentId = root.id; child.children = [leaf.id]; leaf.parentId = child.id;
    project.layers = { [root.id]: root, [child.id]: child, [leaf.id]: leaf }; project.pages[pageId].roots = [root.id]; expect(replaceDocument(project).ok).toBe(true);
    const captured = capturePanelTemplate(root.id, '负原点嵌套'); expect(captured.ok).toBe(true); if (!captured.ok) throw Error('capture');
    const template = getProject().templates[captured.value];
    if (!('recipe' in template) || template.recipe.kind !== 'scene') throw Error('scene recipe');
    expect(template.recipe.roots).toHaveLength(1); const node = template.recipe.nodes[template.recipe.roots[0]];
    if (node.type !== 'panel') throw Error('panel'); expect(node.geometry).toEqual(leaf.geometry);
    expect(node.matrix.slice(0,4)).toEqual(root.matrix.slice(0,4)); expect(template.recipe.bounds.x).toBeCloseTo(0); expect(template.recipe.bounds.y).toBeCloseTo(0);
    for(const id of [root.id,child.id,leaf.id]) { const actual=getProject().layers[id];if(actual.type!=='panel')throw Error('panel');const original=project.layers[id];if(original.type!=='panel')throw Error('panel');expect({geometry:actual.geometry,matrix:actual.matrix,style:actual.style}).toEqual({geometry:original.geometry,matrix:original.matrix,style:original.style}); }
    expect(undo().ok).toBe(true); expect(getProject()).toEqual(project);
    expect(redo().ok).toBe(true); const draft = createObjectDraft(`template:${captured.value}`, pageId); expect(draft.ok).toBe(true);
    if (!draft.ok) throw Error('instantiate'); expect(draft.value.independentRoots).toBe(true); expect(draft.value.descendants).toHaveLength(1);
    expect(draft.value.layer.matrix).toEqual([1, 0, 0, 1, 0, 0]); expect(draft.value.descendants[0].matrix.slice(0,4)).toEqual(root.matrix.slice(0,4));
    expect(new Set([draft.value.layer.id, ...draft.value.descendants.map((layer) => layer.id)]).size).toBe(2);
  });
  it('normalizes a split tree, gives each placement new IDs, and deletion leaves placed panels', () => {
    const saved = capturePanelTemplate(rootId, '双格');
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const template = getProject().templates[saved.value];
    if (!('recipe' in template) || template.recipe.kind !== 'scene') throw Error('scene recipe');
    expect(template.recipe.roots).toHaveLength(1); const leaf = template.recipe.nodes[template.recipe.roots[0]];
    if (leaf.type !== 'panel') throw Error('panel'); expect(leaf.matrix).toEqual([1,0,0,1,-35,-55]); expect(leaf.geometry[0]).toEqual({x:35,y:55});
    const pageId = getProject().pageOrder[0];
    const first = createObjectDraft(`template:${saved.value}`, pageId);
    const second = createObjectDraft(`template:${saved.value}`, pageId);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(new Set([first.value.layer.id, ...first.value.descendants.map((item) => item.id), second.value.layer.id, ...second.value.descendants.map((item) => item.id)]).size).toBe(4);
    const placed = placeObjectDraft(first.value, pageId, { x: 700, y: 500 });
    expect(placed.ok).toBe(true);
    expect(getProject().layers[placed.ok ? placed.value : '']?.type).toBe('panel');
    expect(deleteUserTemplate(saved.value).ok).toBe(true);
    expect(getProject().templates[saved.value]).toBeUndefined();
    expect(getProject().layers[placed.ok ? placed.value : '']).toBeDefined();
    expect(undo().ok).toBe(true);
    expect(getProject().templates[saved.value]).toBeDefined();
    expect(redo().ok).toBe(true);
    expect(createObjectDraft(`template:${saved.value}`, pageId).ok).toBe(false);
  });
});
