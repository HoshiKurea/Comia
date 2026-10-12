import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import { redo, replaceDocument, undo } from '../../src/history/commandBus';
import { addPage, deletePage, reorderPages, resizePage, resolvePageSize, setReadingDirection } from '../../src/pages/commands';
import { getProject } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';

beforeEach(() => { expect(replaceDocument(createProject()).ok).toBe(true); });

describe('page operations', () => {
  it('uses physical paper dimensions without 16px snapping and rejects invalid extremes', () => {
    expect(resolvePageSize({ preset: 'A4', orientation: 'portrait', dpi: 300, snap16: true })).toEqual({ ok: true, value: { width: 2480, height: 3508, dpi: 300 } });
    expect(resolvePageSize({ preset: 'B4-ISO', orientation: 'landscape', dpi: 300 })).toEqual({ ok: true, value: { width: 4169, height: 2953, dpi: 300 } });
    expect(resolvePageSize({ preset: 'custom', orientation: 'portrait', widthPx: 113, heightPx: 161, dpi: 300, snap16: true })).toEqual({ ok: true, value: { width: 112, height: 160, dpi: 300 } });
    expect(resolvePageSize({ preset: 'custom', orientation: 'portrait', widthPx: 15, heightPx: 200, dpi: 300 }).ok).toBe(false);
    expect(resolvePageSize({ preset: 'A4', orientation: 'portrait', dpi: 601 }).ok).toBe(false);
  });

  it('adds an empty page, activates it, and restores the previous/created page on undo/redo', () => {
    const first = getProject().pageOrder[0];
    const panel = createLayer('panel', first);
    const project = structuredClone(getProject());
    project.layers[panel.id] = panel;
    project.pages[first].roots.push(panel.id);
    expect(replaceDocument(project).ok).toBe(true);
    const result = addPage(first);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const second = result.value;
    expect(sessionStore.getState().activePageId).toBe(second);
    expect(getProject().pages[second].roots.map(id => getProject().layers[id])).toMatchObject([{ type: 'pageBackground', fill: '#FFFFFFFF' }]);
    expect(getProject().pages[second].width).toBe(getProject().pages[first].width);
    expect(undo().ok).toBe(true);
    expect(getProject().pages[second]).toBeUndefined();
    expect(sessionStore.getState().activePageId).toBe(first);
    expect(getProject().pages[first].roots).toEqual([panel.id]);
    expect(redo().ok).toBe(true);
    expect(sessionStore.getState().activePageId).toBe(second);
  });

  it('reorders pages without altering layers and undo restores narrative order', () => {
    const first = getProject().pageOrder[0];
    const second = addPage(first);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const third = addPage(second.value);
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(reorderPages(third.value, first).ok).toBe(true);
    expect(getProject().pageOrder).toEqual([third.value, first, second.value]);
    expect(undo().ok).toBe(true);
    expect(getProject().pageOrder).toEqual([first, second.value, third.value]);
  });

  it('deletes the active middle page and all descendants in one undoable transaction', () => {
    const first = getProject().pageOrder[0];
    const middle = addPage(first);
    expect(middle.ok).toBe(true);
    if (!middle.ok) return;
    const last = addPage(middle.value);
    expect(last.ok).toBe(true);
    if (!last.ok) return;
    const project = structuredClone(getProject());
    const panel = createLayer('panel', middle.value);
    project.pages[middle.value].roots.push(panel.id);
    project.layers[panel.id] = panel;
    expect(replaceDocument(project).ok).toBe(true);
    sessionStore.setState({ activePageId: middle.value });
    expect(deletePage(middle.value, false).ok).toBe(true);
    expect(getProject().pages[middle.value]).toBeDefined();
    expect(deletePage(middle.value, true).ok).toBe(true);
    expect(getProject().layers[panel.id]).toBeUndefined();
    expect(sessionStore.getState().activePageId).toBe(last.value);
    expect(undo().ok).toBe(true);
    expect(getProject().pages[middle.value].roots).toEqual(project.pages[middle.value].roots);
    expect(sessionStore.getState().activePageId).toBe(middle.value);
    expect(redo().ok).toBe(true);
    expect(sessionStore.getState().activePageId).toBe(last.value);
  });

  it('resizes only the page boundary, retains off-page content, and keeps reading order independent', () => {
    const first = getProject().pageOrder[0];
    const panel = createLayer('panel', first);
    panel.matrix = [1, 0, 0, 1, 1000, 1000];
    const project = structuredClone(getProject());
    project.pages[first].roots.push(panel.id);
    project.layers[panel.id] = panel;
    expect(replaceDocument(project).ok).toBe(true);
    expect(resizePage(first, { preset: 'custom', orientation: 'portrait', widthPx: 500, heightPx: 500, dpi: 300 }).ok).toBe(true);
    expect(getProject().layers[panel.id].matrix).toEqual(panel.matrix);
    expect(setReadingDirection('ltr').ok).toBe(true);
    expect(getProject().pageOrder).toEqual([first]);
    expect(undo().ok).toBe(true);
    expect(getProject().settings.readingDirection).toBe('rtl');
    expect(undo().ok).toBe(true);
    expect(getProject().pages[first].width).toBe(2480);
  });
});
