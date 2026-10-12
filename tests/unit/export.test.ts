import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { createLayer } from '../../src/domain/factories';
import { createPageBackground } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import { downloadPng, exportPdf, exportPng, rasterSize } from '../../src/export/exportFiles';
import { drawPage } from '../../src/render/drawScene';
import { triggerDownload } from '../../src/storage/fileSave';
vi.mock('../../src/render/drawScene', () => ({ drawPage: vi.fn() }));
vi.mock('../../src/storage/fileSave', () => ({ triggerDownload: vi.fn() }));
vi.mock('../../src/text/fonts', () => ({ actualFont: (family: string) => family, awaitFonts: vi.fn(async () => ({ ok: true, value: ['serif', 'Noto Sans CJK SC'].map((family) => ({ requested: family, actual: family, fallback: false })) })) }));
const pdfCalls = vi.hoisted(() => ({ sizes: [] as number[][] }));
vi.mock('jspdf', () => ({ jsPDF: class {
  internal = { collections: { addImage_images: {} } };
  __private__ = { setPdfVersion: vi.fn() };
  constructor(options: { format: number[] }) { pdfCalls.sizes.push(options.format); }
  addPage(size: number[]) { pdfCalls.sizes.push(size); }
  addImage() {}
  output() { return new Blob(['pdf']); }
} }));
let canvases: HTMLCanvasElement[];
beforeEach(() => {
  vi.clearAllMocks(); pdfCalls.sizes.length = 0; canvases = [];
  vi.stubGlobal('Blob', NodeBlob);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') throw new Error('unexpected element');
    const canvas = { width: 0, height: 0, getContext: () => ({ fillRect: vi.fn(), scale: vi.fn(), drawImage: vi.fn() }), toBlob: (callback: BlobCallback) => callback(new Blob(['png'])) } as unknown as HTMLCanvasElement;
    canvases.push(canvas); return canvas;
  }) as typeof document.createElement);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { queueMicrotask(() => callback(0)); return 1; });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('isolated export jobs', () => {
  it('reports explicit vertical glyph substitution while preserving the frozen requested family', async () => {
    const project = createProject(), id = project.pageOrder[0], layer = createLayer('text', id);
    if (layer.type !== 'text') throw new Error('text');
    layer.text.content = '（（A）'; layer.text.direction = 'vertical'; layer.text.font.family = 'serif';
    project.layers[layer.id] = layer; project.pages[id].roots = [layer.id];
    const warning = vi.fn();
    expect((await exportPng(project, id, new Map(), undefined, { onWarning: warning })).ok).toBe(true);
    expect(warning).toHaveBeenCalledOnce(); expect(warning.mock.calls[0][0]).toContain('竖排标点“（）”使用本地Noto Sans CJK SC');
    expect(layer.text.font.family).toBe('serif');
  });
  it('rejects extreme size or invalid scale before creating any canvas', async () => {
    expect(rasterSize(16384, 16384, 4).ok).toBe(false);
    for (const scale of [0, NaN, 4.01]) expect(rasterSize(100, 100, scale).ok).toBe(false);
    expect(rasterSize(101, 100, 0.5)).toMatchObject({ ok: true, value: { width: 51, height: 50 } });
    const project = createProject(); project.pages[project.pageOrder[0]].width = 16384;
    expect((await exportPng(project, project.pageOrder[0], new Map())).ok).toBe(false); expect(canvases).toHaveLength(0);
  });

  it.each(['null', 'throw'] as const)('reports %s PNG encoding failure and releases its canvas', async (kind) => {
    const project = createProject(), id = project.pageOrder[0];
    vi.spyOn(document, 'createElement').mockImplementation((() => {
      const canvas = { width: 0, height: 0, getContext: () => ({ scale: vi.fn() }), toBlob: (callback: BlobCallback) => { if (kind === 'throw') throw new DOMException('blocked', 'SecurityError'); callback(null); } } as unknown as HTMLCanvasElement;
      canvases.push(canvas); return canvas;
    }) as typeof document.createElement);
    expect((await exportPng(project, id, new Map())).ok).toBe(false);
    expect(canvases[0].width).toBe(0); expect(canvases[0].height).toBe(0);
  });

  it('cancels in the encoding progress callback without triggering a download', async () => {
    const project = createProject(), controller = new AbortController();
    const result = await downloadPng(project, project.pageOrder[0], new Map(), controller.signal, { onProgress: (progress) => { if (progress.phase === 'encode') controller.abort(); } });
    expect(result).toMatchObject({ ok: false, problems: [{ code: 'export/cancelled' }] });
    expect(triggerDownload).not.toHaveBeenCalled(); expect(canvases[0].width).toBe(0);
  });

  it('does not read newer page dimensions or backgrounds from the project during multi-page export', async () => {
    const project = createProject(), first = project.pageOrder[0], second = crypto.randomUUID();
    project.pages[first].width = 100; project.pages[first].height = 120;
    project.pages[second] = { ...project.pages[first], id: second, width: 200, height: 240 }; project.pageOrder.push(second); const background = createPageBackground(second); project.layers[background.id] = background; project.pages[second].roots = [background.id];
    const result = await exportPdf(project, new Map(), undefined, { onProgress: (progress) => { if (progress.phase === 'encode' && progress.completed === 1) { project.pages[second].width = 800; background.fill = '#FF0000FF'; } } });
    expect(result.ok).toBe(true); expect(pdfCalls.sizes[1]).toEqual([48, 57.6]);
    expect((vi.mocked(drawPage).mock.calls[1][1].layers[background.id] as typeof background).fill).toBe('#FFFFFFFF');
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
  });

  it('uses PDF UserUnit for a maximum-sized low-DPI paper instead of silently clamping its MediaBox', async () => {
    const project = createProject(), id = project.pageOrder[0];
    Object.assign(project.pages[id], { width: 16384, height: 16, dpi: 72 });
    expect((await exportPdf(project, new Map(), undefined, { scale: 0.25 })).ok).toBe(true);
    expect(pdfCalls.sizes[0]).toEqual([8192, 8]);
  });

  it('copies a visible image once and closes the owned bitmap without closing the editor bitmap', async () => {
    const project = createProject(), id = project.pageOrder[0], image = createLayer('image', id);
    if (image.type !== 'image') throw new Error('image');
    const hash = '0'.repeat(64), source = { close: vi.fn() }, copy = { close: vi.fn() };
    image.assetId = crypto.randomUUID(); project.layers[image.id] = image; project.pages[id].roots = [image.id];
    project.assets[image.assetId] = { id: image.assetId, name: 'test', width: 16, height: 16, renderHash: hash } as any;
    const clone = vi.fn(async () => copy); vi.stubGlobal('createImageBitmap', clone);
    expect((await exportPng(project, id, new Map([[hash, source as unknown as ImageBitmap]]))).ok).toBe(true);
    expect(clone).toHaveBeenCalledTimes(1); expect(copy.close).toHaveBeenCalledOnce(); expect(source.close).not.toHaveBeenCalled();
  });

  it('rejects missing visible image resources rather than exporting a blank area', async () => {
    const project = createProject(), id = project.pageOrder[0], image = createLayer('image', id);
    if (image.type !== 'image') throw new Error('image');
    image.assetId = crypto.randomUUID(); project.layers[image.id] = image; project.pages[id].roots = [image.id];
    project.assets[image.assetId] = { id: image.assetId, width: 16, height: 16, renderHash: '0'.repeat(64) } as any;
    expect((await exportPng(project, id, new Map())).ok).toBe(false); expect(canvases).toHaveLength(0);
  });
});
