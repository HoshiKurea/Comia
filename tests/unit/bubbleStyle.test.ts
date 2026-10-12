import { beforeEach, describe, expect, it } from 'vitest';
import { createContentProject as createProject } from '../helpers/contentProject';
import { addObject } from '../../src/app/actions';
import { replaceDocument, undo } from '../../src/history/commandBus';
import { getDocument } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';
import { setBubbleStyle } from '../../src/bubbles/commands';
import { validateProject } from '../../src/domain/validate';
import { setDimensions } from '../../src/interaction/transformCommands';
import { defaultTail } from '../../src/bubbles/tail';
let id: string;
beforeEach(() => { const project = createProject(); replaceDocument(project); sessionStore.setState({ activePageId: project.pageOrder[0] }); const result = addObject('bubble', project.pageOrder[0], { x: 50, y: 50 }); if (!result.ok) throw Error('bubble'); id = result.value; });
describe('bubble style boundaries and text relation', () => {
  it('clamps a proportionally reduced triangular base to 4px while retaining a valid scaled tip and undoing the whole resize', () => {
    const project = structuredClone(getDocument().project), bubble = project.layers[id]; if (bubble.type !== 'bubble') throw Error('bubble');
    const tail = defaultTail(bubble, 'triangle'); if (!tail.ok) throw Error('tail'); bubble.tail = tail.value; replaceDocument(project); sessionStore.setState({ snap16: false }); const before = getDocument();
    expect(setDimensions(id, 32, 19.2).ok).toBe(true); const after = getDocument(), next = after.project.layers[id]; if (next.type !== 'bubble') throw Error('bubble');
    expect(next.tail!.baseWidth).toBe(4); expect(next.tail!.tip.x).toBeCloseTo(tail.value.tip.x * 32 / 300, 8); expect(next.tail!.tip.y).toBeCloseTo(tail.value.tip.y * 19.2 / 180, 8);
    expect(validateProject(after.project).ok).toBe(true); expect(after.history.past.length).toBe(before.history.past.length + 1); undo(); expect(getDocument().project).toEqual(before.project);
  });
  it('shrinks a bubble to 16px with a zero safe box, preserves Unicode text through validation and undoes without deleting the child', () => {
    const project = structuredClone(getDocument().project), bubble = project.layers[id]; if (bubble.type !== 'bubble') throw Error('bubble');
    const child = project.layers[bubble.children[0]]; if (child.type !== 'text') throw Error('text'); child.text.content = '对白😀\n保留';
    replaceDocument(project); sessionStore.setState({ snap16: false }); const before = getDocument();
    expect(setDimensions(id, 16).ok).toBe(true); expect(setDimensions(id, undefined, 16).ok).toBe(true);
    const after = getDocument(), text = after.project.layers[child.id]; if (text.type !== 'text') throw Error('text');
    expect(text.box).toEqual({ x: 8, y: 8, width: 0, height: 0 }); expect(text.text).toEqual(child.text);
    expect(validateProject(JSON.stringify(after.project))).toEqual({ ok: true, value: after.project });
    expect(after.history.past.length).toBe(before.history.past.length + 2); undo(); undo(); expect(getDocument().project).toEqual(before.project);
  });
  it('still rejects negative owned safe boxes and zero standalone text boxes with the concrete text path', () => {
    for (const standalone of [false, true]) {
      const project = structuredClone(getDocument().project), bubble = project.layers[id]; if (bubble.type !== 'bubble') throw Error('bubble');
      const child = project.layers[bubble.children[0]]; if (child.type !== 'text') throw Error('text');
      child.box.width = standalone ? 0 : -1;
      if (standalone) { bubble.children = []; child.parentId = null; project.pages[child.pageId].roots.push(child.id); }
      expect(validateProject(project)).toMatchObject({ ok: false, problems: expect.arrayContaining([expect.objectContaining({ code: 'text/box', path: `layers.${child.id}` })]) });
    }
  });
  it('retains requested radius but computes the text safe area from the effective rounded path, and undoes both', () => {
    const before = getDocument(), bubble = before.project.layers[id]; if (bubble.type !== 'bubble') throw Error('bubble'); const childId = bubble.children[0];
    expect(setBubbleStyle(id, { radius: 4096, fill: '#ff000080', borderColor: '#00ff0040', borderWidth: 256 }).ok).toBe(true);
    expect(getDocument().project.layers[id]).toMatchObject({ style: { radius: 4096, fill: '#FF000080', borderColor: '#00FF0040', borderWidth: 256 } });
    const text = getDocument().project.layers[childId]; if (text.type !== 'text') throw Error('text');
    expect(text.box.width).toBeGreaterThan(0); expect(text.text).toEqual((before.project.layers[childId] as typeof text).text);
    expect(getDocument().history.past.length).toBe(before.history.past.length + 1); undo(); expect(getDocument().project).toEqual(before.project);
  });
  it.each([{ radius: -1 }, { radius: 4097 }, { borderWidth: -1 }, { borderWidth: 257 }, { radius: NaN }, { fill: '#FFFFFF' }, { borderColor: '#GGFFFFFF' }])('rejects invalid patch %j without history or tree changes', (patch) => {
    const before = getDocument(); expect(setBubbleStyle(id, patch).ok).toBe(false); expect(getDocument().project).toBe(before.project); expect(getDocument().history).toBe(before.history);
  });
  it('rejects radius reflow of locked main text but permits fill changes that do not alter its box', () => {
    const project = structuredClone(getDocument().project), bubble = project.layers[id]; if (bubble.type !== 'bubble') throw Error('bubble'); project.layers[bubble.children[0]].locked = true; replaceDocument(project);
    expect(setBubbleStyle(id, { radius: 80 }).ok).toBe(false); expect(setBubbleStyle(id, { fill: '#00000080' }).ok).toBe(true);
  });
  it('rejects imported style extremes, elliptical circles and self-intersecting tails at model validation', () => {
    for (const mutate of [(bubble: any) => { bubble.style.radius = -1; }, (bubble: any) => { bubble.style.borderWidth = 257; }, (bubble: any) => { bubble.shape = 'circle'; }, (bubble: any) => { bubble.tail = { kind: 'triangle', attachU: .65, baseWidth: 24, tip: { x: 100, y: 50 } }; }]) {
      const project = structuredClone(getDocument().project); mutate(project.layers[id]); expect(validateProject(project).ok).toBe(false);
    }
  });
});
