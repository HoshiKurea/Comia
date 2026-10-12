import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import { getDocument, getProject } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';
import { replaceDocument, undo, redo, execute } from '../../src/history/commandBus';
import { componentCenter, placeComponentAtPageCenter, resolveComponentPlacement } from '../../src/library/placement';
import { createObjectDraft, placeObjectDraft } from '../../src/app/actions';
import { apply, multiply, rotationRad, scaling, translation, worldMatrix } from '../../src/geometry/matrix';
import { beginCreation, cancelCreation, currentCreation } from '../../src/library/creationController';

beforeEach(() => {
  cancelCreation();
  const project = createProject();
  expect(replaceDocument(project).ok).toBe(true);
  sessionStore.setState({ activePageId: project.pageOrder[0], scopeId: null });
});

describe('click component placement', () => {
  it('cancels a transient component before a document transaction and reuses its uncommitted name', () => {
    const pageId = getProject().pageOrder[0];
    expect(beginCreation('rect-panel', pageId, 1, { x: 50, y: 50 }).ok).toBe(true);
    const draftId = currentCreation()!.draft.layer.id;
    expect(execute({ label: '重命名项目', context: { pageId, selection: [] }, mutate(project) { project.name = '新名称'; } }).ok).toBe(true);
    expect(currentCreation()).toBeNull(); expect(getProject().layers[draftId]).toBeUndefined();
    const added = placeComponentAtPageCenter('rect-panel', pageId); if (!added.ok) throw new Error('creation');
    expect(getProject().layers[added.value].name).toBe('分镜 1');
    expect(getDocument().history.past).toHaveLength(2);
  });
  it.each(['rect-panel', 'bubble-circle', 'text', 'speed'] as const)('centers %s and selects it in one undoable transaction', (kind) => {
    const project = getProject(), pageId = project.pageOrder[0], page = project.pages[pageId];
    const before = getDocument().history.past.length;
    const placed = placeComponentAtPageCenter(kind, pageId);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const layer = getProject().layers[placed.value];
    const draft = createObjectDraft(kind, pageId, true);
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const center = componentCenter(draft.value);
    expect(layer.matrix[4] + center.x).toBeCloseTo(page.width / 2);
    expect(layer.matrix[5] + center.y).toBeCloseTo(page.height / 2);
    expect(sessionStore.getState().selection).toEqual([placed.value]);
    expect(getDocument().history.past.length).toBe(before + 1);
    expect(undo().ok).toBe(true);
    expect(getProject().layers[placed.value]).toBeUndefined();
  });

  it('rejects a missing page without changing document or history', () => {
    const before = getDocument().history.stateId;
    expect(placeComponentAtPageCenter('rect-panel', crypto.randomUUID()).ok).toBe(false);
    expect(getDocument().history.stateId).toBe(before);
  });

  it('creates a whole bubble subtree inside a rotated, scaled nested group at the page-space point and undoes/redoes together', () => {
    const project = structuredClone(getProject()), pageId = project.pageOrder[0];
    const outer = createLayer('group', pageId), inner = createLayer('group', pageId);
    if (outer.type !== 'group' || inner.type !== 'group') throw new Error('group factory');
    outer.matrix = multiply(translation(500, 400), rotationRad(0.4));
    inner.parentId = outer.id; inner.matrix = multiply(translation(70, 90), scaling(1.3, 0.8));
    outer.children = [inner.id]; project.layers[outer.id] = outer; project.layers[inner.id] = inner; project.pages[pageId].roots = [outer.id];
    expect(replaceDocument(project).ok).toBe(true);
    sessionStore.setState({ scopeId: inner.id });
    const draft = createObjectDraft('bubble', pageId); if (!draft.ok) throw new Error('draft');
    const point = { x: 900, y: 800 }, center = componentCenter(draft.value);
    const target = resolveComponentPlacement(getProject(), draft.value, pageId, point, inner.id); if (!target.ok) throw new Error('placement');
    const placed = placeObjectDraft(draft.value, pageId, target.value.origin, target.value.parentId); expect(placed.ok).toBe(true); if (!placed.ok) return;
    expect(apply(worldMatrix(getProject(), placed.value), center)).toEqual({ x: expect.closeTo(900, 8), y: expect.closeTo(800, 8) });
    expect(getProject().layers[placed.value].parentId).toBe(inner.id);
    const childId = draft.value.descendants[0].id;
    expect(getProject().layers[childId].parentId).toBe(placed.value);
    expect(undo().ok).toBe(true); expect(getProject().layers[placed.value]).toBeUndefined(); expect(getProject().layers[childId]).toBeUndefined();
    expect(redo().ok).toBe(true); expect(getProject().layers[childId].parentId).toBe(placed.value);
    sessionStore.setState({ scopeId: inner.id });
    const click = placeComponentAtPageCenter('text', pageId); expect(click.ok).toBe(true);
  });

  it('uses the closest group when scope is a panel and rejects hidden, locked or deleted scopes without writing history', () => {
    const project = structuredClone(getProject()), pageId = project.pageOrder[0];
    const group = createLayer('group', pageId), panel = createLayer('panel', pageId);
    if (group.type !== 'group') throw new Error('group');
    group.children = [panel.id]; panel.parentId = group.id; project.layers[group.id] = group; project.layers[panel.id] = panel; project.pages[pageId].roots = [group.id];
    expect(replaceDocument(project).ok).toBe(true);
    const draft = createObjectDraft('text', pageId); if (!draft.ok) throw new Error('draft');
    expect(resolveComponentPlacement(project, draft.value, pageId, { x: 600, y: 500 }, panel.id)).toMatchObject({ ok: true, value: { parentId: group.id } });
    const state = getDocument().history.stateId;
    for (const scope of [crypto.randomUUID(), group.id]) {
      if (scope === group.id) { project.layers[group.id].locked = true; expect(replaceDocument(project).ok).toBe(true); }
      sessionStore.setState({ scopeId: scope });
      expect(placeComponentAtPageCenter('text', pageId).ok).toBe(false);
    }
    expect(getDocument().history.past).toHaveLength(0);
    expect(state).toBeTruthy();
    group.locked = false; group.visible = false;
    expect(resolveComponentPlacement(project, draft.value, pageId, { x: 600, y: 500 }, panel.id).ok).toBe(false);
  });
});
