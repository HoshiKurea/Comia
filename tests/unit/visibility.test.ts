import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import type { GroupLayer } from '../../src/domain/types';
import { changeLayer, deleteSelected } from '../../src/app/actions';
import { replaceDocument, undo } from '../../src/history/commandBus';
import { setLocked, setVisible } from '../../src/layers/visibility';
import { getProject } from '../../src/state/documentStore';
import { effectiveLayerFlags } from '../../src/state/effectiveFlags';
import { sessionStore } from '../../src/state/sessionStore';
import { registerGestureCanceller } from '../../src/interaction/activeGesture';

let groupId: string, childId: string;
beforeEach(() => {
  const project = createProject();
  const pageId = project.pageOrder[0];
  const group = createLayer('group', pageId) as GroupLayer;
  const child = createLayer('panel', pageId);
  child.parentId = group.id;
  group.children.push(child.id);
  project.layers[group.id] = group;
  project.layers[child.id] = child;
  project.pages[pageId].roots.push(group.id);
  expect(replaceDocument(project).ok).toBe(true);
  groupId = group.id; childId = child.id;
});

describe('layer visibility and lock permissions', () => {
  it('keeps a child hidden when its parent is hidden then shown', () => {
    expect(setVisible([childId], false).ok).toBe(true);
    expect(setVisible([groupId], false).ok).toBe(true);
    expect(effectiveLayerFlags(getProject(), childId).visible).toBe(false);
    expect(setVisible([groupId], true).ok).toBe(true);
    expect(getProject().layers[childId].visible).toBe(false);
    expect(effectiveLayerFlags(getProject(), childId).visible).toBe(false);
  });

  it('blocks parent mutation and deletion while a descendant is locked, then undo unlocks', () => {
    expect(setLocked([childId], true).ok).toBe(true);
    expect(changeLayer(groupId, '移动组', (layer) => { layer.matrix = [1, 0, 0, 1, 99, 0]; }).ok).toBe(false);
    sessionStore.setState({ selection: [groupId] });
    expect(deleteSelected().ok).toBe(false);
    expect(getProject().layers[groupId].matrix[4]).toBe(0);
    expect(undo().ok).toBe(true);
    expect(getProject().layers[childId].locked).toBe(false);
    expect(changeLayer(groupId, '移动组', (layer) => { layer.matrix = [1, 0, 0, 1, 99, 0]; }).ok).toBe(true);
  });

  it('cancels a pointer preview before applying a visibility transaction', () => {
    let cancelled = 0;
    const release = registerGestureCanceller(() => { cancelled++; });
    try {
      expect(setVisible([groupId], false).ok).toBe(true);
      expect(cancelled).toBe(1);
      expect(getProject().layers[groupId].visible).toBe(false);
    } finally { release(); }
  });
});
