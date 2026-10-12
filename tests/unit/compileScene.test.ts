import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayer, DEFAULT_FONT_FAMILY } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import { compileScene } from '../../src/render/compileScene';
import { drawPlan } from '../../src/render/drawPlan';
import { registerLocalFontFamilies } from '../../src/text/fonts';
import { invalidateDocumentCaches } from '../../src/state/runtimeStore';
import type { FontResolution } from '../../src/text/types';

afterEach(() => vi.restoreAllMocks());
function fixture(direction: 'horizontal' | 'vertical') {
  const project = createProject(), pageId = project.pageOrder[0], text = createLayer('text', pageId);
  if (text.type !== 'text') throw Error('text');
  text.text.direction = direction; text.text.content = '（AB）中文'; text.text.font.family = 'Unknown scene face';
  text.box = { x: 0, y: 0, width: 100, height: 120 };
  project.layers[text.id] = text; project.pages[pageId].roots = [text.id];
  const fonts: FontResolution[] = [{ requested: text.text.font.family, actual: DEFAULT_FONT_FAMILY, fallback: true }, { requested: DEFAULT_FONT_FAMILY, actual: DEFAULT_FONT_FAMILY, fallback: false }];
  return { project, pageId, text, fonts };
}
function paintContext() {
  return { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), fillRect: vi.fn(), transform: vi.fn(), fillText: vi.fn(), translate: vi.fn(), rotate: vi.fn(), globalAlpha: 1, font: '', measureText: vi.fn(() => { throw Error('paint must not measure'); }) } as unknown as CanvasRenderingContext2D;
}
describe('prepared scene font and layout isolation', () => {
  it('reuses interactive layout without measuring again, but invalidates it for changed content and font generation', () => {
    invalidateDocumentCaches();
    const { project, pageId, text, fonts } = fixture('horizontal');
    const measure = { font: '', measureText: vi.fn((value: string) => ({ width: value.length * 20, actualBoundingBoxAscent: 24 })) };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(measure as unknown as CanvasRenderingContext2D);
    const first = compileScene(project, pageId, fonts, { snapshot: false, fontGeneration: 1 });
    expect(first.project).toBe(project); const calls = measure.measureText.mock.calls.length;
    const second = compileScene(project, pageId, fonts, { snapshot: false, fontGeneration: 1 });
    expect(second.text.text.get(text.id)!.layout).toBe(first.text.text.get(text.id)!.layout); expect(measure.measureText).toHaveBeenCalledTimes(calls);
    compileScene(project, pageId, fonts, { snapshot: false, fontGeneration: 2 }); expect(measure.measureText.mock.calls.length).toBeGreaterThan(calls);
    const afterGeneration = measure.measureText.mock.calls.length;
    project.layers[text.id] = { ...text, text: { ...text.text, content: 'different content' } };
    compileScene(project, pageId, fonts, { snapshot: false, fontGeneration: 2 }); expect(measure.measureText.mock.calls.length).toBeGreaterThan(afterGeneration);
  });
  it('copies panel and decoration geometry for asynchronous plans while interactive plans reuse immutable paths', () => {
    const project = createProject(), pageId = project.pageOrder[0], panel = createLayer('panel', pageId), decoration = createLayer('decoration', pageId);
    if (panel.type !== 'panel') throw Error('panel');
    project.layers[panel.id] = panel; project.layers[decoration.id] = decoration; project.pages[pageId].roots = [panel.id, decoration.id];
    const first = compileScene(project, pageId, [], { snapshot: false }), second = compileScene(project, pageId, [], { snapshot: false });
    expect(second.text.panels.get(panel.id)).toBe(first.text.panels.get(panel.id)); expect(second.text.decorations.get(decoration.id)).toBe(first.text.decorations.get(decoration.id));
    const frozen = compileScene(project, pageId, []), before = structuredClone(frozen.text.panels.get(panel.id));
    panel.geometry[1].x = 999; expect(frozen.text.panels.get(panel.id)).toEqual(before); expect(frozen.project.layers[panel.id]).not.toBe(panel);
  });
  it.each(['horizontal', 'vertical'] as const)('paints frozen %s text after document and font resolution mutations without measuring during paint', (direction) => {
    const { project, pageId, text, fonts } = fixture(direction);
    const measure = { font: '', measureText: vi.fn((value: string) => ({ width: value.length * 20, actualBoundingBoxAscent: 24 })) };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(measure as unknown as CanvasRenderingContext2D);
    const plan = compileScene(project, pageId, fonts), before = structuredClone(plan.text.text.get(text.id)!.layout);
    text.text.content = 'changed'; text.box.width = 1; fonts[0].actual = 'serif'; registerLocalFontFamilies(['Unknown scene face']);
    const ctx = paintContext(); drawPlan(ctx, plan, new Map());
    expect(plan.text.text.get(text.id)!.font).toContain(DEFAULT_FONT_FAMILY);
    expect(plan.text.text.get(text.id)!.layout).toEqual(before); expect(ctx.measureText).not.toHaveBeenCalled();
    expect(vi.mocked(ctx.fillText).mock.calls.map((args) => args[0]).join('')).not.toContain('changed');
    expect(vi.mocked(ctx.fillText).mock.calls.length).toBeGreaterThan(0);
    if (direction === 'vertical') expect(plan.text.text.get(text.id)!.glyphFonts.get(DEFAULT_FONT_FAMILY)).toContain(DEFAULT_FONT_FAMILY);
    else expect(measure.measureText).toHaveBeenCalled();
  });
  it('rejects an unprepared visible font but does not require fonts for hidden descendants', () => {
    const { project, pageId, text } = fixture('horizontal');
    expect(() => compileScene(project, pageId, [])).toThrow('未包含');
    const group = createLayer('group', pageId); if (group.type !== 'group') throw Error('group');
    group.visible = false; group.children = [text.id]; text.parentId = group.id; project.layers[group.id] = group; project.pages[pageId].roots = [group.id];
    const plan = compileScene(project, pageId, []); expect(plan.text.text.size).toBe(0);
    const ctx = paintContext(); drawPlan(ctx, plan, new Map()); expect(ctx.fillText).not.toHaveBeenCalled();
  });
  it('rejects missing SFX resolution and paints the prepared SFX font after registry changes', () => {
    const project = createProject(), pageId = project.pageOrder[0], layer = createLayer('decoration', pageId);
    if (layer.type !== 'decoration') throw Error('decoration');
    layer.spec = { kind: 'sfx', width: 100, height: 60, content: 'BANG', fontFamily: 'Unknown SFX face', fontSize: 32, color: '#000000FF', outline: '#FFFFFFFF', outlineWidth: 0 };
    project.layers[layer.id] = layer; project.pages[pageId].roots = [layer.id];
    expect(() => compileScene(project, pageId, [])).toThrow('未包含');
    const plan = compileScene(project, pageId, [{ requested: layer.spec.fontFamily, actual: DEFAULT_FONT_FAMILY, fallback: true }]);
    registerLocalFontFamilies(['Unknown SFX face']); const ctx = paintContext(); drawPlan(ctx, plan, new Map());
    expect(ctx.font).toBe(`700 32px "${DEFAULT_FONT_FAMILY}", sans-serif`); expect(ctx.fillText).toHaveBeenCalledWith('BANG', 0, 32);
  });
});
