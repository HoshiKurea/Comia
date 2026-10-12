import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import { replaceDocument, undo, redo } from '../../src/history/commandBus';
import { getDocument } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';
import { beginSfxTextEdit, cancelTextEdit, commitTextEdit, currentTextEdit, setTextComposing, updateTextInput, updateTextStyleDraft } from '../../src/text/editController';
let id: string;
beforeEach(() => {
  const project = createProject(), pageId = project.pageOrder[0], layer = createLayer('decoration', pageId);
  if (layer.type !== 'decoration') throw Error('decoration');
  layer.spec = { kind: 'sfx', width: 400, height: 240, content: '砰！', fontFamily: 'sans-serif', fontSize: 96, color: '#000000FF', outline: '#FFFFFFFF', outlineWidth: 3 };
  project.layers[layer.id] = layer; project.pages[pageId].roots = [layer.id]; id = layer.id; replaceDocument(project); sessionStore.setState({ activePageId: pageId });
});
afterEach(() => cancelTextEdit());
describe('sound effect adapter shares the text edit lifecycle', () => {
  it('previews content and style on the original decoration without writing history, then cancels completely', () => {
    const before = getDocument(); expect(beginSfxTextEdit(id).ok).toBe(true); updateTextInput('轰😀', 3, 3);
    expect(updateTextStyleDraft({ font: { family: 'serif', size: 48, color: '#FF000080' } }).ok).toBe(true);
    expect(currentTextEdit()!.preview.layers[id]).toMatchObject({ type: 'decoration', spec: { content: '轰😀', fontFamily: 'serif', fontSize: 48, color: '#FF000080', outlineWidth: 3 } });
    expect(getDocument().project).toBe(before.project); expect(getDocument().history).toBe(before.history); cancelTextEdit(); expect(getDocument().project).toBe(before.project);
  });
  it('waits for compositionend and commits multiple inputs once into spec.content, with undo and redo', () => {
    beginSfxTextEdit(id); setTextComposing(true); updateTextInput('hong', 4, 4); expect(commitTextEdit().ok).toBe(false); expect(getDocument().history.past).toHaveLength(0);
    setTextComposing(false); updateTextInput('轰', 1, 1); updateTextInput('轰！', 2, 2); expect(commitTextEdit().ok).toBe(true);
    expect(getDocument().history.past).toHaveLength(1); expect(getDocument().project.layers[id]).toMatchObject({ spec: { content: '轰！' } });
    expect(getDocument().project.layers[id]).not.toHaveProperty('text'); undo(); expect(getDocument().project.layers[id]).toMatchObject({ spec: { content: '砰！' } }); redo(); expect(getDocument().project.layers[id]).toMatchObject({ spec: { content: '轰！' } });
  });
  it('bounds Unicode content and rejects unsupported SFX style without changing the draft', () => {
    beginSfxTextEdit(id); const before = currentTextEdit()!.draft;
    expect(updateTextStyleDraft({ direction: 'vertical' }).ok).toBe(false); expect(currentTextEdit()!.draft).toBe(before);
    expect(Array.from(updateTextInput('😀'.repeat(10001), 20002, 20002))).toHaveLength(10000); expect(commitTextEdit().ok).toBe(true);
  });
});
