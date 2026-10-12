import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer, createPage } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import { getDocument, getProject, documentStore } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';
import { execute, redo, replaceDocument, undo } from '../../src/history/commandBus';
import { activatePage } from '../../src/pages/commands';
import { beginTextEdit, cancelTextEdit, commitTextEdit, currentTextEdit, normalizeTextInput, setTextComposing, updateTextInput, updateTextSelection } from '../../src/text/editController';
import { setTextStyle } from '../../src/text/commands';
import { caretAt, hitCaret, selectionRects } from '../../src/text/selection';
import { graphemes, layoutHorizontal, layoutVertical } from '../../src/text/layout';
import type { TextLayer } from '../../src/domain/types';

let id: string;
const text = () => getProject().layers[id] as TextLayer;
beforeEach(() => {
  cancelTextEdit();
  const project = createProject(), first = project.pageOrder[0], second = createPage();
  project.pages[second.id] = second; project.pageOrder.push(second.id);
  const layer = createLayer('text', first); id = layer.id;
  if (layer.type !== 'text') throw new Error('text factory');
  layer.text.content = '原文👩‍🚀'; project.layers[id] = layer; project.pages[first].roots.push(id);
  expect(replaceDocument(project).ok).toBe(true);
  sessionStore.setState({ activePageId: first });
});

describe('text edit transactions', () => {
  it('keeps ten updates and styles outside the document then commits one complete undo/redo entry', () => {
    expect(beginTextEdit(id).ok).toBe(true);
    for (let i = 1; i <= 10; i++) updateTextInput('对白\n'.repeat(i), i * 3, i * 3);
    expect(setTextStyle(id, { font: { color: '#FF0000FF', bold: true }, direction: 'vertical' }).ok).toBe(true);
    expect(text().text.content).toBe('原文👩‍🚀'); expect(getDocument().history.past).toHaveLength(0);
    expect(currentTextEdit()!.preview.layers[id]).toMatchObject({ text: { content: '对白\n'.repeat(10), direction: 'vertical' } });
    expect(commitTextEdit().ok).toBe(true); expect(currentTextEdit()).toBeNull(); expect(getDocument().history.past).toHaveLength(1);
    expect(text().text.font.color).toBe('#FF0000FF'); expect(text().text.font.family).toBe('Noto Sans CJK SC');
    expect(undo().ok).toBe(true); expect(text().text.content).toBe('原文👩‍🚀'); expect(text().text.font.bold).toBe(false);
    expect(redo().ok).toBe(true); expect(text().text.content).toBe('对白\n'.repeat(10)); expect(text().text.direction).toBe('vertical');
  });
  it('cancels content and styles together with no history or document change, including a no-op commit', () => {
    beginTextEdit(id); updateTextInput('修改', 2, 2); setTextStyle(id, { font: { size: 50 } });
    expect(cancelTextEdit().ok).toBe(true); expect(text().text.font.size).toBe(32); expect(text().text.content).toBe('原文👩‍🚀');
    beginTextEdit(id); expect(commitTextEdit().ok).toBe(true); expect(getDocument().history.past).toHaveLength(0);
  });
  it('blocks page/transaction/commit during IME composition and preserves the candidate draft', () => {
    beginTextEdit(id); setTextComposing(true); updateTextInput('ni', 2, 2);
    expect(commitTextEdit()).toMatchObject({ ok: false, problems: [{ code: 'text/composing' }] });
    const second = getProject().pageOrder[1]; activatePage(second);
    expect(sessionStore.getState().activePageId).toBe(getProject().pageOrder[0]);
    expect(execute({ label: '其他操作', context: { pageId: second, selection: [] }, mutate(project) { project.name = '不应执行'; } }).ok).toBe(false);
    expect(getProject().name).toBe('未命名项目'); expect(currentTextEdit()!.draft.content).toBe('ni');
    setTextComposing(false); updateTextInput('你好', 2, 2); activatePage(second);
    expect(text().text.content).toBe('你好'); expect(sessionStore.getState().activePageId).toBe(second); expect(getDocument().history.past).toHaveLength(1);
  });
  it('normalizes CRLF, limits by codepoints without half-surrogates, preserves native selection positions', () => {
    const value = '😀'.repeat(10001);
    expect(normalizeTextInput(value)).toEqual({ value: '😀'.repeat(10000), truncated: true });
    beginTextEdit(id); expect(updateTextInput('A\r\nB\rC', 4, 4)).toBe('A\nB\nC');
    expect(currentTextEdit()!.selectionStart).toBe(3);
    updateTextInput(value, value.length, value.length); expect(currentTextEdit()!.draft.content.length).toBe(20000);
    expect(commitTextEdit().ok).toBe(true); expect(Array.from(text().text.content)).toHaveLength(10000);
  });
  it('rejects inherited locks and cancels stale/deleted targets instead of resurrecting a layer', () => {
    const project = structuredClone(getProject()), group = createLayer('group', text().pageId);
    if (group.type !== 'group') throw new Error('group factory');
    group.locked = true; group.children = [id]; project.layers[group.id] = group; project.layers[id].parentId = group.id; project.pages[text().pageId].roots = [group.id];
    replaceDocument(project); expect(beginTextEdit(id).ok).toBe(false);
    group.locked = false; replaceDocument(project); expect(beginTextEdit(id).ok).toBe(true); updateTextInput('不应復活', 4, 4);
    const replaced = structuredClone(getProject()); delete replaced.layers[id]; (replaced.layers[group.id] as typeof group).children = [];
    documentStore.setState({ project: replaced, epoch: getDocument().epoch + 1 });
    expect(commitTextEdit()).toMatchObject({ ok: false, problems: [{ code: 'text/stale' }] });
    expect(getProject().layers[id]).toBeUndefined(); expect(currentTextEdit()).toBeNull(); expect(getDocument().history.past).toHaveLength(0);
  });
  it('validates draft styles, preserves font siblings and uses separate history outside editing', () => {
    beginTextEdit(id); expect(setTextStyle(id, { font: { size: 0 } }).ok).toBe(false);
    expect(currentTextEdit()!.draft.font.size).toBe(32); expect(setTextStyle(id, { font: { size: 6, italic: true } }).ok).toBe(true);
    updateTextSelection(0, 5, 'backward'); expect(currentTextEdit()!.selectionDirection).toBe('backward'); cancelTextEdit();
    expect(setTextStyle(id, { font: { bold: true } }).ok).toBe(true); expect(text().text.font.size).toBe(32); expect(getDocument().history.past).toHaveLength(1);
  });
});

describe('UTF16 caret and selection geometry', () => {
  const measure = { measureText(value: string) { return { width: graphemes(value).reduce((n, part) => n + (part.glyph === 'i' ? 4 : 10), 0), actualBoundingBoxAscent: 8 } as TextMetrics; } };
  it('uses measured cell widths, emoji boundaries and next-run affinity at soft wrap', () => {
    const content = { ...text().text, content: 'i👩‍🚀好', font: { ...text().text.font, size: 10 }, lineHeight: 1 };
    const layout = layoutHorizontal(content, { x: 0, y: 0, width: 14, height: 40 }, measure);
    expect(hitCaret(layout, { x: 3, y: 5 }, false)).toBe(1);
    expect(hitCaret(layout, { x: 13, y: 5 }, false)).toBe(6);
    expect(caretAt(layout, 6)).toMatchObject({ x: 0, y: 10, indexUTF16: 6 });
    expect(selectionRects(layout, 1, 6)).toEqual([{ x: 4, y: 0, width: 10, height: 10 }]);
  });
  it('preserves LF empty lines, empty text caret and right-to-left vertical column indices', () => {
    const content = { ...text().text, content: '好\n\n👩‍🚀', font: { ...text().text.font, size: 10 }, lineHeight: 1 };
    const layout = layoutHorizontal(content, { x: 0, y: 0, width: 40, height: 60 }, measure);
    expect(caretAt(layout, 2)).toMatchObject({ x: 0, y: 10, indexUTF16: 2 });
    const vertical = layoutVertical({ ...content, direction: 'vertical' }, { x: 0, y: 0, width: 40, height: 20 });
    expect(hitCaret(vertical, { x: 25, y: 0 }, true)).toBe(2);
    expect(caretAt(vertical, 3)).toMatchObject({ x: 15, y: 0 });
    const empty = layoutHorizontal({ ...content, content: '', align: 'center' }, { x: 10, y: 20, width: 40, height: 60 }, measure);
    expect(caretAt(empty, 0)).toMatchObject({ x: 30, y: 20 });
  });
});
