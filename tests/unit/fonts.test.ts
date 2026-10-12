import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, DEFAULT_FONT_FAMILY } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('FontFace', class {
    constructor(public family: string, public source: string, public descriptors: { weight: string }) {}
    async load() { return this; }
  });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add: vi.fn(), load: vi.fn(async () => []), ready: Promise.resolve() } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => {
    const ctx = { font: '', measureText: () => ({ width: ctx.font.includes('monospace') ? 100 : 80 }) }; return ctx;
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('local font resolution', () => {
  it('loads Regular/Bold once and gives a missing requested font a declared fallback', async () => {
    const { resolveFont, actualFont } = await import('../../src/text/fonts');
    const results = await Promise.all([resolveFont(DEFAULT_FONT_FAMILY), resolveFont(DEFAULT_FONT_FAMILY), resolveFont('MissingFamily')]);
    expect(document.fonts.add).toHaveBeenCalledTimes(2);
    expect(results[2]).toEqual({ requested: 'MissingFamily', actual: DEFAULT_FONT_FAMILY, fallback: true });
    expect(actualFont('MissingFamily')).toBe(DEFAULT_FONT_FAMILY);
  });
  it('waits for the actual text and requested style without overwriting persisted requested family', async () => {
    const { awaitFonts } = await import('../../src/text/fonts');
    const project = createProject(), id = project.pageOrder[0], text = createLayer('text', id);
    if (text.type !== 'text') throw new Error('text'); text.text.font.family = 'MissingFamily'; text.text.content = '中文'; text.text.font.bold = true;
    project.layers[text.id] = text; project.pages[id].roots = [text.id];
    expect(await awaitFonts(project)).toMatchObject({ ok: true, value: [{ requested: 'MissingFamily', fallback: true }] });
    expect(document.fonts.load).toHaveBeenCalledWith(expect.stringContaining('700'), '中文'); expect(text.text.font.family).toBe('MissingFamily');
  });
  it('cancels a font wait immediately and does not need the shared loader to finish', async () => {
    const { fontDeadline } = await import('../../src/text/fonts');
    const controller = new AbortController(), task = fontDeadline(new Promise(() => {}), controller.signal);
    controller.abort(); await expect(task).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('waits for mapped vertical glyphs in the bundled styled face even when the requested body font is generic', async () => {
    const { awaitFonts } = await import('../../src/text/fonts');
    const project = createProject(), id = project.pageOrder[0], layer = createLayer('text', id);
    if (layer.type !== 'text') throw new Error('text');
    layer.text.content = '（A。）'; layer.text.direction = 'vertical'; layer.text.font.family = 'serif'; layer.text.font.bold = layer.text.font.italic = true;
    project.layers[layer.id] = layer; project.pages[id].roots = [layer.id];
    expect((await awaitFonts(project)).ok).toBe(true);
    expect(document.fonts.load).toHaveBeenCalledWith(expect.stringContaining(`italic 700 ${layer.text.font.size}px "${DEFAULT_FONT_FAMILY}"`), '︵︒︶');
    expect(document.fonts.load).toHaveBeenCalledWith(expect.stringContaining('serif'), '（A。）');
    expect(layer.text.font.family).toBe('serif');
  });
  it('reports a stalled font wait after ten seconds', async () => {
    const { fontDeadline } = await import('../../src/text/fonts'); vi.useFakeTimers();
    const result = expect(fontDeadline(new Promise(() => {}))).rejects.toThrow('字体加载超过10秒');
    await vi.advanceTimersByTimeAsync(10_000); await result;
  });
});
