import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import { getDocument } from '../../src/state/documentStore';
import { replaceDocument, undo, redo } from '../../src/history/commandBus';
import { sessionStore } from '../../src/state/sessionStore';
import { beginBubbleTextEdit, cancelTextEdit, commitTextEdit, currentTextEdit, setTextComposing, updateTextInput } from '../../src/text/editController';
import { setTextStyle } from '../../src/text/commands';
let bubbleId: string;
beforeEach(() => {
  const project = createProject(), pageId = project.pageOrder[0], bubble = createLayer('bubble', pageId);
  project.layers[bubble.id] = bubble; project.pages[pageId].roots = [bubble.id]; bubbleId = bubble.id;
  replaceDocument(project); sessionStore.setState({ activePageId: pageId, selection: [bubbleId] });
});
afterEach(() => cancelTextEdit());
describe('restoring a missing bubble text in one edit transaction', () => {
  it('does not modify the document or history while drafting, and Escape restores zero children', () => {
    const before = getDocument(); expect(beginBubbleTextEdit(bubbleId).ok).toBe(true);
    const id = currentTextEdit()!.layerId; updateTextInput('草稿', 2, 2); expect(setTextStyle(id, { font: { size: 40 } }).ok).toBe(true);
    expect(currentTextEdit()!.preview.layers[id]).toMatchObject({ type: 'text', text: { content: '草稿', font: { size: 40 } } });
    expect(getDocument().project).toBe(before.project); expect(getDocument().history).toBe(before.history);
    cancelTextEdit(); expect(getDocument().project.layers[bubbleId]).toMatchObject({ children: [] }); expect(getDocument().project.layers[id]).toBeUndefined();
  });
  it('creates the child with completed content and style once, then undo and redo restore the entire relation', () => {
    beginBubbleTextEdit(bubbleId); const id = currentTextEdit()!.layerId;
    updateTextInput('你好😀', 4, 4); setTextStyle(id, { font: { color: '#FF000080' }, direction: 'vertical' });
    expect(commitTextEdit().ok).toBe(true); expect(getDocument().history.past).toHaveLength(1);
    expect(getDocument().project.layers[id]).toMatchObject({ parentId: bubbleId, text: { content: '你好😀', direction: 'vertical', font: { color: '#FF000080', size: 28 } } });
    undo(); expect(getDocument().project.layers[bubbleId]).toMatchObject({ children: [] }); expect(getDocument().project.layers[id]).toBeUndefined();
    redo(); expect(getDocument().project.layers[bubbleId]).toMatchObject({ children: [id] }); expect(getDocument().project.layers[id]).toMatchObject({ text: { content: '你好😀' } });
    expect(beginBubbleTextEdit(bubbleId).ok).toBe(true); expect(currentTextEdit()!.draft.content).toBe('你好😀');
  });
  it('keeps composition pending and rejects locked bubble edits without creating a child', () => {
    beginBubbleTextEdit(bubbleId); setTextComposing(true); updateTextInput('ni', 2, 2); expect(commitTextEdit().ok).toBe(false);
    expect(getDocument().history.past).toHaveLength(0); cancelTextEdit();
    const project = structuredClone(getDocument().project); project.layers[bubbleId].locked = true; replaceDocument(project);
    expect(beginBubbleTextEdit(bubbleId).ok).toBe(false); expect(currentTextEdit()).toBeNull(); expect(getDocument().history.past).toHaveLength(0);
  });
});
