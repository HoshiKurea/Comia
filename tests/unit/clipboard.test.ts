import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import { copyLayers, copyToClipboard, pasteFromClipboard } from '../../src/layers/clipboard';
import { replaceDocument, undo } from '../../src/history/commandBus';
import { getProject } from '../../src/state/documentStore';

let pageId: string, id: string;
beforeEach(() => {
  const project = createProject(); pageId = project.pageOrder[0];
  const panel = createLayer('panel', pageId);
  panel.matrix = [1, 0, 0, 1, -30, 44];
  project.layers[panel.id] = panel;
  project.pages[pageId].roots.push(panel.id);
  expect(replaceDocument(project).ok).toBe(true);
  id = panel.id;
});

describe('application clipboard', () => {
  it('pastes independently editable IDs at increasing offsets and undoes one paste', () => {
    expect(copyToClipboard([id]).ok).toBe(true);
    const first = pasteFromClipboard(pageId);
    const second = pasteFromClipboard(pageId);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value[0]).not.toBe(id);
    expect(second.value[0]).not.toBe(first.value[0]);
    expect(getProject().layers[first.value[0]].matrix[4]).toBe(-14);
    expect(getProject().layers[second.value[0]].matrix[4]).toBe(2);
    expect(getProject().pages[pageId].roots).toHaveLength(3);
    expect(undo().ok).toBe(true);
    expect(getProject().pages[pageId].roots).toHaveLength(2);
  });

  it('does not mutate the original tree when copying', () => {
    const before = structuredClone(getProject());
    const copied = copyLayers([id]);
    expect(copied.ok).toBe(true);
    expect(getProject()).toEqual(before);
  });
});
