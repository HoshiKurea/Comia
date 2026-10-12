import { describe, expect, it } from 'vitest';
import { createLayer, createPage } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import { validateProject } from '../../src/domain/validate';

describe('every tree reference is counted before DFS early return', () => {
  it('rejects duplicate roots with a concrete layer path', () => {
    const project = createProject(), page = project.pages[project.pageOrder[0]], layer = createLayer('text', page.id);
    project.layers[layer.id] = layer; page.roots = [layer.id, layer.id];
    const result = validateProject(project);
    expect(result).toMatchObject({ ok: false, problems: expect.arrayContaining([expect.objectContaining({ code: 'tree/duplicate-parent', path: `layers.${layer.id}` })]) });
  });
  it('rejects duplicate children within one group', () => {
    const project = createProject(), page = project.pages[project.pageOrder[0]], group = createLayer('group', page.id), text = createLayer('text', page.id);
    if (group.type !== 'group') throw Error('Group factory mismatch');
    group.children = [text.id, text.id]; text.parentId = group.id; project.layers[group.id] = group; project.layers[text.id] = text; page.roots = [group.id];
    expect(validateProject(project)).toMatchObject({ ok: false, problems: expect.arrayContaining([expect.objectContaining({ code: 'tree/duplicate-parent', path: `layers.${text.id}` })]) });
  });
  it('rejects a completed child later referenced by another parent without revisiting its subtree', () => {
    const project = createProject(), page = project.pages[project.pageOrder[0]], a = createLayer('group', page.id), b = createLayer('group', page.id), child = createLayer('group', page.id), text = createLayer('text', page.id);
    if (a.type !== 'group' || b.type !== 'group' || child.type !== 'group') throw Error('Group factory mismatch');
    a.children = b.children = [child.id]; child.parentId = a.id; child.children = [text.id]; text.parentId = child.id;
    for (const layer of [a, b, child, text]) project.layers[layer.id] = layer; page.roots = [a.id, b.id];
    const result = validateProject(project); expect(result.ok).toBe(false);
    if (result.ok) throw Error('Must reject');
    expect(result.problems).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'tree/duplicate-parent', path: `layers.${child.id}` }), expect.objectContaining({ code: 'tree/parent-mismatch', path: `pages.${page.id}.roots.children` })]));
    expect(result.problems.some((problem) => problem.code === 'tree/duplicate-parent' && problem.path === `layers.${text.id}`)).toBe(false);
  });
  it('rejects a completed root referenced again in another page and reports both duplicate and cross-page errors', () => {
    const project = createProject(), a = project.pages[project.pageOrder[0]], b = createPage(), text = createLayer('text', a.id);
    project.pages[b.id] = b; project.pageOrder.push(b.id); project.layers[text.id] = text; a.roots = b.roots = [text.id];
    expect(validateProject(project)).toMatchObject({ ok: false, problems: expect.arrayContaining([expect.objectContaining({ code: 'tree/duplicate-parent', path: `layers.${text.id}` }), expect.objectContaining({ code: 'tree/cross-page', path: `pages.${b.id}.roots` })]) });
  });
  it('accepts distinct siblings and preserves factory empty round trips', () => {
    const project = createProject(), page = project.pages[project.pageOrder[0]], a = createLayer('text', page.id), b = createLayer('text', page.id);
    project.layers[a.id] = a; project.layers[b.id] = b; page.roots = [a.id,b.id];
    expect(validateProject(project)).toEqual({ok:true,value:project}); const empty = createProject(); expect(validateProject(JSON.parse(JSON.stringify(empty)))).toEqual({ok:true,value:empty});
  });
});
