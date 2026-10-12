import { beforeEach, describe, expect, it } from 'vitest';
import { resolveShortcut, type ShortcutContext } from '../../src/interaction/shortcuts';
import { cancelKeyboardMove, commitKeyboardMove, currentKeyboardMove, moveByKeyboard } from '../../src/interaction/keyboardMove';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import { getDocument, getProject } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';
import { replaceDocument, undo, execute } from '../../src/history/commandBus';
import { apply, multiply, rotationRad, scaling, translation, worldMatrix } from '../../src/geometry/matrix';

const ctx: ShortcutContext = { textEditing: false, inputFocused: false, modalOpen: false, gestureActive: false };
const event = (key: string, patch: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, isComposing: false, keyCode: 0, ...patch });
describe('shortcut routing', () => {
  it('gives IME and modal priority over all application commands', () => {
    expect(resolveShortcut(event('g', { ctrlKey: true, isComposing: true }), ctx)).toBeNull();
    expect(resolveShortcut(event('s', { ctrlKey: true }), { ...ctx, composing: true })).toBeNull();
    expect(resolveShortcut(event('Delete'), { ...ctx, modalOpen: true })).toBeNull();
    expect(resolveShortcut(event('s', { ctrlKey: true, altKey: true }), ctx)).toBeNull();
  });
  it.each(['Backspace', 'Delete', 'ArrowLeft', ' ', 'z', 'c', 'v'])('leaves %s to a native input and permits application save/commit only', (key) => {
    const context = { ...ctx, inputFocused: true, textEditing: true };
    expect(resolveShortcut(event(key, { ctrlKey: key.length === 1 && key !== ' ' }), context)).toBeNull();
    expect(resolveShortcut(event('s', { metaKey: true, shiftKey: true }), context)).toBe('saveAs');
    expect(resolveShortcut(event('Enter', { ctrlKey: true }), context)).toBe('commitText');
  });
  it('recognizes Ctrl/Meta shortcuts and allows cancel, save and history while an ordinary gesture runs', () => {
    expect(resolveShortcut(event('Z', { metaKey: true, shiftKey: true }), ctx)).toBe('redo');
    expect(resolveShortcut(event('g', { ctrlKey: true, shiftKey: true }), ctx)).toBe('ungroup');
    expect(resolveShortcut(event('d', { metaKey: true }), ctx)).toBe('duplicate');
    expect(resolveShortcut(event('ArrowRight'), { ...ctx, gestureActive: true })).toBeNull();
    expect(resolveShortcut(event('Escape'), { ...ctx, gestureActive: true })).toBe('cancel');
    expect(resolveShortcut(event('Escape', { altKey: true }), { ...ctx, gestureActive: true })).toBe('cancel');
    expect(resolveShortcut(event('z', { ctrlKey: true }), { ...ctx, gestureActive: true })).toBe('undo');
    expect(resolveShortcut(event('z', { metaKey: true, shiftKey: true }), { ...ctx, gestureActive: true })).toBe('redo');
    expect(resolveShortcut(event('z', { ctrlKey: true }), { ...ctx, gestureActive: true, inputFocused: true })).toBeNull();
  });
});

describe('keyboard move preview', () => {
  beforeEach(() => { cancelKeyboardMove(); const project = createProject(); replaceDocument(project); sessionStore.setState({ activePageId: project.pageOrder[0], selection: [] }); });
  it('combines held-key deltas into one transaction and transforms page displacement through rotated scaled parents', () => {
    const project = structuredClone(getProject()), pageId = project.pageOrder[0];
    const group = createLayer('group', pageId), panel = createLayer('panel', pageId);
    if (group.type !== 'group') throw new Error('group');
    group.matrix = multiply(translation(100, 100), multiply(rotationRad(.5), scaling(2, .5))); group.children = [panel.id]; panel.parentId = group.id;
    project.layers[group.id] = group; project.layers[panel.id] = panel; project.pages[pageId].roots = [group.id]; replaceDocument(project); sessionStore.setState({ selection: [panel.id] });
    const before = apply(worldMatrix(project, panel.id), { x: 0, y: 0 });
    for (let i = 0; i < 10; i++) expect(moveByKeyboard(1, 0).ok).toBe(true);
    expect(moveByKeyboard(0, 10).ok).toBe(true);
    expect(getDocument().history.past).toHaveLength(0);
    const after = apply(worldMatrix(currentKeyboardMove()!.preview, panel.id), { x: 0, y: 0 });
    expect(after.x - before.x).toBeCloseTo(10); expect(after.y - before.y).toBeCloseTo(10);
    expect(commitKeyboardMove().ok).toBe(true); expect(getDocument().history.past).toHaveLength(1);
    undo(); expect(getProject().layers[panel.id].matrix).toEqual(panel.matrix);
  });
  it('moves selected ancestor only, cancels without history and a competing transaction cancels the preview', () => {
    const project = structuredClone(getProject()), pageId = project.pageOrder[0], group = createLayer('group', pageId), panel = createLayer('panel', pageId);
    if (group.type !== 'group') throw new Error('group');
    group.children = [panel.id]; panel.parentId = group.id; project.layers[group.id] = group; project.layers[panel.id] = panel; project.pages[pageId].roots = [group.id]; replaceDocument(project);
    sessionStore.setState({ selection: [group.id, panel.id] }); moveByKeyboard(10, 0);
    expect(currentKeyboardMove()!.ids).toEqual([group.id]); cancelKeyboardMove(); expect(getDocument().history.past).toHaveLength(0);
    moveByKeyboard(10, 0); execute({ label: '另一个操作', context: { pageId, selection: [] }, mutate(draft) { draft.name = '新名称'; } });
    expect(currentKeyboardMove()).toBeNull(); expect(getProject().layers[group.id].matrix).toEqual(group.matrix);
  });
  it('rejects owned content and locked descendants instead of breaking container control', () => {
    const project = structuredClone(getProject()), pageId = project.pageOrder[0], bubble = createLayer('bubble', pageId), text = createLayer('text', pageId);
    if (bubble.type !== 'bubble') throw new Error('bubble');
    bubble.children = [text.id]; text.parentId = bubble.id; project.layers[bubble.id] = bubble; project.layers[text.id] = text; project.pages[pageId].roots = [bubble.id]; replaceDocument(project);
    sessionStore.setState({ selection: [text.id] }); expect(moveByKeyboard(1, 0)).toMatchObject({ ok: false, problems: [{ code: 'keyboard/owned' }] });
    project.layers[text.id].locked = true; replaceDocument(project); sessionStore.setState({ selection: [bubble.id] });
    expect(moveByKeyboard(1, 0).ok).toBe(false); expect(getDocument().history.past).toHaveLength(0);
  });
});
