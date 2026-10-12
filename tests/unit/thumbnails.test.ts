import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPage, createPageBackground } from '../../src/domain/factories';
import { validateProject } from '../../src/domain/validate';
import { createContentProject as createProject } from '../helpers/contentProject';
import { invalidatePage, scheduleThumbnail, subscribeThumbnailState, type ThumbnailState } from '../../src/pages/thumbnails';
import { replaceDocument } from '../../src/history/commandBus';
import { deletePage } from '../../src/pages/commands';
import { sessionStore } from '../../src/state/sessionStore';
const mocks = vi.hoisted(() => ({ fonts: vi.fn(), draw: vi.fn() }));
vi.mock('../../src/text/fonts', () => ({ awaitFonts: mocks.fonts }));
vi.mock('../../src/render/drawScene', () => ({ drawPage: mocks.draw }));
let pages: string[] = [], canvases: HTMLCanvasElement[] = [], urls = 0;
beforeEach(() => {
  vi.useFakeTimers(); pages = []; canvases = []; urls = 0; mocks.fonts.mockReset().mockResolvedValue({ ok: true, value: [] }); mocks.draw.mockReset();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function(this: HTMLCanvasElement) { canvases.push(this); return { setTransform: vi.fn() } as unknown as CanvasRenderingContext2D; });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['png'], { type: 'image/png' })));
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => `blob:test-${++urls}`) }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});
afterEach(async () => { for (const page of pages) invalidatePage(page); await vi.advanceTimersByTimeAsync(0); vi.useRealTimers(); });
function fixture() { const project = createProject(), pageId = project.pageOrder[0], states: ThumbnailState[] = []; pages.push(pageId); const off = subscribeThumbnailState(pageId, (state) => states.push(state)); return { project, pageId, states, off }; }
describe('serial cancelable page thumbnails', () => {
  it('debounces rapid edits to the newest state and frees its backing canvas after rendering', async () => {
    const { project, pageId, states, off } = fixture(); scheduleThumbnail(pageId, 'old', project, new Map()); const latest = structuredClone(project), background = createPageBackground(pageId, '#FF0000FF'); latest.layers[background.id] = background; latest.pages[pageId].roots.unshift(background.id); expect(validateProject(latest).ok).toBe(true); scheduleThumbnail(pageId, 'new', latest, new Map());
    await vi.advanceTimersByTimeAsync(299); expect(mocks.draw).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1);
    expect(mocks.draw).toHaveBeenCalledOnce(); expect(mocks.draw.mock.calls[0][1].layers[background.id].fill).toBe('#FF0000FF'); expect(mocks.draw.mock.calls[0][1].pages[pageId]).not.toHaveProperty('background'); expect(states.at(-1)!.status).toBe('ready'); expect(canvases[0].width).toBe(0); expect(canvases[0].height).toBe(0); off();
  });
  it('reports draw/encode failure, resets canvas and permits an explicit successful retry', async () => {
    const { project, pageId, states, off } = fixture(); mocks.draw.mockImplementationOnce(() => { throw Error('draw failed'); }); scheduleThumbnail(pageId, 'bad', project, new Map()); await vi.advanceTimersByTimeAsync(300);
    expect(states.at(-1)).toEqual({ status: 'error', url: null, message: 'draw failed' }); expect(canvases[0].width).toBe(0);
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce((callback) => callback(null)); scheduleThumbnail(pageId, 'bad-encode', project, new Map()); await vi.advanceTimersByTimeAsync(300); expect(states.at(-1)!.message).toContain('编码失败');
    scheduleThumbnail(pageId, 'retry', project, new Map()); await vi.advanceTimersByTimeAsync(300); expect(states.at(-1)!.status).toBe('ready'); expect(URL.createObjectURL).toHaveBeenCalledOnce(); off();
  });
  it('deleting a page during font loading aborts it and allows the next page to render', async () => {
    const { project, pageId, states, off } = fixture(); mocks.fonts.mockImplementationOnce((_project, signal: AbortSignal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve({ ok: false, problems: [{ message: 'cancelled' }] }), { once: true })));
    scheduleThumbnail(pageId, 'wait', project, new Map()); await vi.advanceTimersByTimeAsync(300); const next = createPage(); project.pages[next.id] = next; project.pageOrder.push(next.id); pages.push(next.id); const nextStates: ThumbnailState[] = []; const offNext = subscribeThumbnailState(next.id, (state) => nextStates.push(state));
    scheduleThumbnail(next.id, 'next', project, new Map()); await vi.advanceTimersByTimeAsync(300); expect(mocks.draw).not.toHaveBeenCalled(); invalidatePage(pageId); await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)!.status).toBe('idle'); expect(nextStates.at(-1)!.status).toBe('ready'); expect(mocks.draw).toHaveBeenCalledOnce(); expect(mocks.draw.mock.calls[0][2]).toBe(next.id); off(); offNext();
  });
  it('superseding an in-flight encoder cancels it immediately; its late callback cannot overwrite the new URL', async () => {
    const { project, pageId, states, off } = fixture(); let oldCallback!: BlobCallback;
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce((callback) => { oldCallback = callback; }); scheduleThumbnail(pageId, 'old', project, new Map()); await vi.advanceTimersByTimeAsync(300);
    scheduleThumbnail(pageId, 'new', project, new Map()); await vi.advanceTimersByTimeAsync(300); const newest = states.at(-1)!; expect(newest.status).toBe('ready'); expect(canvases[0].width).toBe(0);
    oldCallback(new Blob(['old'])); await vi.advanceTimersByTimeAsync(0); expect(states.at(-1)).toEqual(newest); expect(URL.createObjectURL).toHaveBeenCalledOnce(); off();
  });
  it('revokes replaced/deleted URLs and converts a never-returning encoder to a retryable error', async () => {
    const { project, pageId, states, off } = fixture(); scheduleThumbnail(pageId, 'first', project, new Map()); await vi.advanceTimersByTimeAsync(300); scheduleThumbnail(pageId, 'second', project, new Map()); await vi.advanceTimersByTimeAsync(300); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-1');
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce(() => undefined); scheduleThumbnail(pageId, 'timeout', project, new Map()); await vi.advanceTimersByTimeAsync(10_300); expect(states.at(-1)!.message).toContain('编码超时'); expect(canvases.at(-1)!.width).toBe(0);
    invalidatePage(pageId); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-2'); off();
  });
  it('the real delete-page transaction cancels an unmounted page task and cannot publish its late encoder result', async () => {
    const { project, pageId, states, off } = fixture(); const next = createPage(); project.pages[next.id] = next; project.pageOrder.push(next.id); pages.push(next.id); replaceDocument(project); sessionStore.setState({ activePageId: next.id });
    let callback!: BlobCallback; vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce((value) => { callback = value; }); scheduleThumbnail(pageId, 'old', project, new Map()); await vi.advanceTimersByTimeAsync(300);
    expect(deletePage(pageId, true).ok).toBe(true); await vi.advanceTimersByTimeAsync(0); callback(new Blob(['stale'])); await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)!.status).toBe('idle'); expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(canvases.at(-1)!.width).toBe(0); off();
  });
});
