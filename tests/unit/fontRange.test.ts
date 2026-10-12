import { describe, expect, it } from 'vitest';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import { validateProject } from '../../src/domain/validate';
import { replaceDocument, undo } from '../../src/history/commandBus';
import { setTextStyle } from '../../src/text/commands';
import { getProject } from '../../src/state/documentStore';
describe('documented 1..512 font-size range', () => {
  it.each([1, 5, 512])('accepts size %s and allows undo without changing content', (size) => {
    const project = createProject(), layer = createLayer('text', project.pageOrder[0]); if (layer.type !== 'text') throw Error('factory');
    project.layers[layer.id] = layer; project.pages[layer.pageId].roots = [layer.id]; expect(replaceDocument(project).ok).toBe(true);
    expect(setTextStyle(layer.id, { font: { size } }).ok).toBe(true); expect(validateProject(getProject()).ok).toBe(true);
    expect((getProject().layers[layer.id] as typeof layer).text.font.size).toBe(size); expect(undo().ok).toBe(true); expect(getProject()).toEqual(project);
  });
  it.each([0, -1, 513, NaN, Infinity])('rejects %s atomically', (size) => {
    const project = createProject(), layer = createLayer('text', project.pageOrder[0]); project.layers[layer.id] = layer; project.pages[layer.pageId].roots = [layer.id]; replaceDocument(project);
    expect(setTextStyle(layer.id, { font: { size } }).ok).toBe(false); expect(getProject()).toEqual(project);
  });
});
