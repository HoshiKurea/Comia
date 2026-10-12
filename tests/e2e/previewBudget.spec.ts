import { menuCommand } from './menuHelpers';
import { test, expect, type Page } from '@playwright/test';
import type { Project, Result, ImageLayer, AssetMeta } from '../../src/domain/types';
import type { DocumentStoreState } from '../../src/state/documentStore';
import type { RuntimeStoreState } from '../../src/state/runtimeStore';
import type { GestureRuns } from '../../src/render/gestureRuns';

test('64MiB run budget accounts for temporary viewport plus retained surfaces and replays uncached runs with exact pixels', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts');
    const { beginGestureRuns, drawGestureRuns, disposeGestureRuns } = await import('/src/' + 'render/gestureRuns.ts');
    const { drawPage } = await import('/src/' + 'render/drawScene.ts');
    if (window.devicePixelRatio !== 1) throw Error('Budget fixture requires DPR1');
    const project = createProject({ background: false }) as Project, pageId = project.pageOrder[0];
    Object.assign(project.pages[pageId], { width: 4096, height: 3072 });
    const ids: string[] = [];
    for (const [index, size] of [1900, 120, 1900].entries()) {
      const layer = createLayer('panel', pageId);
      if (layer.type !== 'panel') throw Error('Expected panel');
      layer.geometry = [{ x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size }];
      layer.matrix = [1, 0, 0, 1, index === 1 ? 300 : index * 15, index === 1 ? 200 : index * 15];
      // Opaque runs exercise actual cache allocation. Translucent images and
      // nested clips are exercised unchanged in the native UI test below.
      layer.style.borderWidth = 0; layer.style.fill = ['#FF0000FF', '#00FF00FF', '#0000FFFF'][index];
      project.layers[layer.id] = layer; ids.push(layer.id);
    }
    project.pages[pageId].roots = [...project.pages[pageId].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...(ids)];
    const draft = structuredClone(project), matrix = draft.layers[ids[1]].matrix;
    draft.layers[ids[1]].matrix = [matrix[0], matrix[1], matrix[2], matrix[3], matrix[4] + 35, matrix[5]];
    const allocated: HTMLCanvasElement[] = [];
    const create = document.createElement.bind(document), prototype = HTMLCanvasElement.prototype;
    const width = Object.getOwnPropertyDescriptor(prototype, 'width')!, height = Object.getOwnPropertyDescriptor(prototype, 'height')!;
    let peak = 0;
    const measure = () => { peak = Math.max(peak, allocated.reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0)); };
    document.createElement = ((tag: string, options?: ElementCreationOptions) => {
      const element = create(tag, options); if (element instanceof HTMLCanvasElement) { allocated.push(element); measure(); } return element;
    }) as typeof document.createElement;
    for (const [name, descriptor] of [['width', width], ['height', height]] as const) Object.defineProperty(prototype, name, { ...descriptor, set(value: number) { descriptor.set!.call(this, value); measure(); } });
    let cached!: GestureRuns, fallback!: GestureRuns, firstCount = 0;
    try {
      cached = beginGestureRuns(project, pageId, [ids[1]], { zoom: 1, pan: { x: 0, y: 0 } }, { width: 4096, height: 3072 }, new Map()) as GestureRuns;
      firstCount = allocated.length;
      fallback = beginGestureRuns(project, pageId, [ids[1]], { zoom: 1, pan: { x: 0, y: 0 } }, { width: 4096, height: 4096 }, new Map()) as GestureRuns;
    } finally { document.createElement = create; Object.defineProperty(prototype, 'width', width); Object.defineProperty(prototype, 'height', height); }
    const cacheKinds = cached.runs.map((run) => ({ kind: run.kind, cached: run.kind === 'static' && run.canvas !== null, bounds: run.kind === 'static' ? run.bounds : null }));
    const fallbackCaches = fallback.runs.filter((run) => run.kind === 'static' && run.canvas).length;
    const surface = () => { const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600; return canvas; };
    const normal = surface(), replay = surface(), uncached = surface();
    drawPage(normal.getContext('2d')!, draft, pageId, new Map());
    drawGestureRuns(replay.getContext('2d')!, cached, draft, new Map());
    drawGestureRuns(uncached.getContext('2d')!, fallback, draft, new Map());
    const rgba = (canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(0, 0, 800, 600).data;
    const reference = rgba(normal), compare = (canvas: HTMLCanvasElement) => { let different = 0; const data = rgba(canvas); for (let i = 0; i < data.length; i++) if (reference[i] !== data[i]) different++; return different; };
    const differences = [compare(replay), compare(uncached)];
    disposeGestureRuns(cached); disposeGestureRuns(fallback);
    const released = allocated.every((canvas) => canvas.width === 0 && canvas.height === 0);
    for (const canvas of [normal, replay, uncached]) canvas.width = canvas.height = 0;
    return { peak, firstCount, allocationCount: allocated.length, cacheKinds, fallbackCaches, differences, released };
  });
  expect(result.peak).toBeLessThanOrEqual(64 * 1024 * 1024);
  expect(result.peak).toBeGreaterThan(60 * 1024 * 1024);
  expect(result.cacheKinds.map((run) => [run.kind, run.cached])).toEqual([['static', true], ['dynamic', false], ['static', false]]);
  expect(result.cacheKinds[2].bounds).not.toBeNull();
  expect(result.fallbackCaches).toBe(0); expect(result.firstCount).toBe(2); expect(result.allocationCount).toBe(result.firstCount);
  expect(result.differences).toEqual([0, 0]); expect(result.released).toBe(true);
});

async function editorState(page: Page, compare = false) {
  return page.evaluate(async (compare) => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const { documentStore } = await import('/src/' + 'state/documentStore.ts'), { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts');
    const { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { drawPage } = await import('/src/' + 'render/drawScene.ts');
    const doc = documentStore.getState() as DocumentStoreState, runtime = runtimeStore.getState() as RuntimeStoreState;
    const session = sessionStore.getState(), viewport = session.viewportByPage[session.activePageId];
    const root = document.querySelector('.canvas-viewport')!, canvases = root.querySelectorAll('canvas');
    const actual = canvases[runtime.previewProject ? 1 : 0];
    let different: number | null = null;
    const diagnostic: { x: number; y: number; channel: number; actual: number; reference: number }[] = [];
    if (compare) {
      const reference = document.createElement('canvas'); reference.width = actual.width; reference.height = actual.height;
      const ctx = reference.getContext('2d')!; ctx.translate(viewport.pan.x, viewport.pan.y); ctx.scale(viewport.zoom, viewport.zoom);
      drawPage(ctx, runtime.previewProject ?? doc.project, session.activePageId, runtime.images);
      const rgba = async (canvas: HTMLCanvasElement) => {
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => { if (!value) throw Error('PNG failed'); resolve(value); }));
        const decoded = await createImageBitmap(blob), decodedCanvas = document.createElement('canvas'); decodedCanvas.width = canvas.width; decodedCanvas.height = canvas.height;
        decodedCanvas.getContext('2d')!.drawImage(decoded, 0, 0); decoded.close();
        const bytes = decodedCanvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data; decodedCanvas.width = decodedCanvas.height = 0; return bytes;
      };
      const a = await rgba(actual), b = await rgba(reference); different = 0;
      for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) { different++; if (diagnostic.length < 20) diagnostic.push({ x: Math.floor(index / 4) % actual.width, y: Math.floor(index / (actual.width * 4)), channel: index % 4, actual: a[index], reference: b[index] }); }
      reference.width = reference.height = 0;
    }
    return { project: doc.project, history: doc.history, preview: runtime.previewProject, stats: runtime.renderStats, different, diagnostic,
      x: (document.querySelector('[aria-label="对象X"]') as HTMLInputElement)?.value,
      y: (document.querySelector('[aria-label="对象Y"]') as HTMLInputElement)?.value,
      pixels: canvases[0].toDataURL('image/png') };
  }, compare);
}

test('60 native moves preserve semi-transparent image order and nested rounded clips while inspector values follow the rendered draft', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  const setup = await page.evaluate(async () => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts');
    const { decodeImage } = await import('/src/' + 'assets/importImage.ts');
    const { replaceDocument } = await import('/src/' + 'history/commandBus.ts'); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const { replaceRuntimeResources } = await import('/src/' + 'storage/blobRepository.ts');
    const { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const project = createProject({ background: false }) as Project, pageId = project.pageOrder[0]; Object.assign(project.pages[pageId], { width: 800, height: 600 });
    const blobs = new Map<string, Blob>(), images = new Map<string, ImageBitmap>();
    const image = async (name: string, color: string) => {
      const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 220;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 300, 220); ctx.clearRect(125, 65, 50, 50);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => { if (!value) throw Error('PNG failed'); resolve(value); })); canvas.width = canvas.height = 0;
      const decoded = await decodeImage(new File([blob], name, { type: 'image/png' }), new AbortController().signal) as Result<{ meta: AssetMeta; original: Blob; render: Blob; bitmap: ImageBitmap }>;
      if (!decoded.ok) throw Error(JSON.stringify(decoded.problems));
      const asset = decoded.value; project.assets[asset.meta.id] = asset.meta; blobs.set(asset.meta.originalHash, asset.original); blobs.set(asset.meta.renderHash, asset.render); images.set(asset.meta.renderHash, asset.bitmap);
      const layer = createLayer('image', pageId); if (layer.type !== 'image') throw Error('Expected image');
      layer.assetId = asset.meta.id; layer.width = 300; layer.height = 220; project.layers[layer.id] = layer; return layer as ImageLayer;
    };
    const moving = await image('moving-alpha.png', '#FF000080'); moving.matrix = [1, 0, 0, 1, 70, 100];
    const top = await image('upper-alpha.png', '#0000FF80'); top.crop = { zoom: 1, focus: { u: .5, v: .5 } };
    const outer = createLayer('panel', pageId), inner = createLayer('panel', pageId);
    if (outer.type !== 'panel' || inner.type !== 'panel') throw Error('Expected panels');
    outer.matrix = [1, 0, 0, 1, 210, 140]; outer.geometry = [{ x: 0, y: 0 }, { x: 280, y: 0 }, { x: 280, y: 200 }, { x: 0, y: 200 }];
    outer.role = 'split'; outer.style.borderRadius = 45; outer.style.borderWidth = 0; outer.style.fill = '#FFFFFF00';
    inner.geometry = [{ x: 10, y: 10 }, { x: 270, y: 10 }, { x: 270, y: 190 }, { x: 10, y: 190 }];
    inner.style.borderRadius = 35; inner.style.borderWidth = 0; inner.style.fill = '#FFFFFF00'; inner.parentId = outer.id; top.parentId = inner.id;
    outer.children = [inner.id]; inner.children = [top.id]; project.layers[outer.id] = outer; project.layers[inner.id] = inner;
    const fillers: string[] = [];
    for (let index = 0; index < 46; index++) {
      const panel = createLayer('panel', pageId); if (panel.type !== 'panel') throw Error('Expected panel');
      panel.geometry = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 12 }, { x: 0, y: 12 }];
      panel.matrix = [1, 0, 0, 1, 550 + index % 10 * 15, 100 + Math.floor(index / 10) * 15]; panel.style.fill = '#00AA0080'; panel.style.borderWidth = 0;
      project.layers[panel.id] = panel; fillers.push(panel.id);
    }
    project.pages[pageId].roots = [...project.pages[pageId].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...([moving.id, outer.id, ...fillers])];
    const replaced = replaceDocument(numberFixture(project)); if (!replaced.ok) throw Error(JSON.stringify(replaced.problems)); replaceRuntimeResources(blobs, images);
    sessionStore.setState({ activePageId: pageId, selection: [moving.id], scopeId: null, snap16: false, toolMode: 'select', viewportByPage: { [pageId]: { zoom: 1, pan: { x: 20, y: 20 } } } });
    return { id: moving.id, layerCount: Object.entries(project.layers).filter(([, layer]) => (layer as { type: string }).type !== 'pageBackground').map(([id]) => id).length };
  });
  expect(setup.layerCount).toBe(50);
  const rect = (await page.locator('.canvas-viewport').boundingBox())!;
  const before = await editorState(page, true); expect(before.different).toBe(0);
  const start = { x: rect.x + 130, y: rect.y + 170 };
  await page.keyboard.down('Alt'); await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + 4, start.y + 4);
  const started = await editorState(page); expect(started.stats.mainDraws - before.stats.mainDraws).toBeLessThanOrEqual(1);
  await page.evaluate(async () => (await import('/src/' + 'state/runtimeStore.ts')).resetRenderStats());
  for (let step = 1; step <= 60; step++) {
    await page.mouse.move(start.x + 4 + step, start.y + 4 + step / 2);
    const frame = await editorState(page, step === 1 || step === 30 || step === 60);
    expect(frame.project).toEqual(before.project); expect(frame.history).toEqual(before.history); expect(frame.stats.mainDraws).toBe(0);
    expect(frame.preview).not.toBeNull();
    const layer = frame.preview!.layers[setup.id];
    expect(Number(frame.x)).toBe(Math.round(layer.matrix[4] * 100) / 100); expect(Number(frame.y)).toBe(Math.round(layer.matrix[5] * 100) / 100);
    if (frame.different !== null) expect(frame.different, JSON.stringify(frame.diagnostic)).toBe(0);
  }
  const preview = await editorState(page, true); expect(preview.different).toBe(0); expect(preview.stats.mainDraws).toBe(0);
  expect(preview.stats.gestureDraws).toBe(60); // One draft calculation per native frame.
  await page.mouse.up(); await page.keyboard.up('Alt');
  const committed = await editorState(page, true);
  expect(committed.history.past.length).toBe(before.history.past.length + 1); expect(committed.project).toEqual(preview.preview); expect(committed.different).toBe(0);
  expect(committed.stats.mainDraws).toBeLessThanOrEqual(1);
  await (await menuCommand(page, '撤销')).click();
  const undone = await editorState(page); expect(undone.project).toEqual(before.project); expect(undone.pixels).toBe(before.pixels);
  const cancelBefore = await editorState(page);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 40, start.y + 20); await editorState(page);
  await page.keyboard.press('Escape'); await page.mouse.up();
  const cancelled = await editorState(page); expect(cancelled.project).toEqual(cancelBefore.project); expect(cancelled.history).toEqual(cancelBefore.history); expect(cancelled.pixels).toBe(cancelBefore.pixels); expect(cancelled.preview).toBeNull();
});

test('each numeric and alpha slider previews 60 native moves below its upper sibling, updates displayed values and cancels without history', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  for (let index = 0; index < 2; index++) await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  await page.getByLabel('填充色RGBA').fill('#0000FFFF'); await page.getByLabel('填充色RGBA').press('Enter');
  await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').last().click();
  const selected = await page.evaluate(async () => (await import('/src/' + 'state/sessionStore.ts')).sessionStore.getState().selection[0] as string);
  await page.evaluate(async () => {
    const journal: unknown[] = []; (window as unknown as { __sliderJournal: unknown[] }).__sliderJournal = journal;
    for (const name of ['pointerdown', 'pointerup', 'lostpointercapture', 'blur', 'focusin', 'input', 'change']) document.addEventListener(name, (event) => {
      const node = event.target as HTMLInputElement, pointer = event as PointerEvent; journal.push({ event: name, label: node.getAttribute('aria-label'), value: node.value, trusted: event.isTrusted, buttons: pointer.buttons, x: pointer.clientX, y: pointer.clientY });
    }, true);
    const { documentStore } = await import('/src/' + 'state/documentStore.ts');
    documentStore.subscribe((next: DocumentStoreState, previous: DocumentStoreState) => { if (next.project !== previous.project) journal.push({ event: 'document-change', stack: new Error().stack }); });
  });
  for (const entry of [
    { label: '圆角滑块', field: 'borderRadius', input: '对象圆角', alpha: false },
    { label: '边框滑块', field: 'borderWidth', input: '对象边框', alpha: false },
    { label: '填充色透明度', field: 'fill', input: '填充色RGBA', alpha: true },
    { label: '边框色透明度', field: 'borderColor', input: '边框色RGBA', alpha: true },
  ]) {
    const slider = page.getByLabel(entry.label, { exact: true }); await slider.scrollIntoViewIfNeeded();
    const before = await editorState(page), rect = (await slider.boundingBox())!;
    const y = rect.y + rect.height / 2;
    // WebKit track clicks step once; they do not begin a native thumb drag.
    // Start at the current thumb using its actual input value and track inset.
    const value = Number(await slider.inputValue()), min = Number(await slider.getAttribute('min')), max = Number(await slider.getAttribute('max'));
    const fraction = (value - min) / (max - min), direction = fraction > .5 ? -1 : 1;
    const x = (fraction: number) => rect.x + 8 + (rect.width - 16) * fraction;
    await page.mouse.move(x(fraction), y); await page.mouse.down();
    const warm = fraction + direction * .05;
    await page.mouse.move(x(warm), y); const warmed = await editorState(page);
    const warmJournal = await page.evaluate(() => ({ journal: (window as unknown as { __sliderJournal: unknown[] }).__sliderJournal.slice(-14), focus: document.activeElement?.getAttribute('aria-label') }));
    expect(warmed.preview !== null, JSON.stringify({ label: entry.label, fraction, rect, warmed: { history: warmed.history.past.length, render: warmed.stats }, warmJournal })).toBe(true);
    await page.evaluate(async () => (await import('/src/' + 'state/runtimeStore.ts')).resetRenderStats());
    for (let step = 1; step <= 60; step++) {
      await page.mouse.move(x(warm + direction * .65 * step / 60), y);
      const frame = await editorState(page);
      const journal = await page.evaluate(() => (window as unknown as { __sliderJournal: unknown[] }).__sliderJournal.slice(-14));
      expect(frame.project, JSON.stringify({ label: entry.label, step, journal })).toEqual(before.project); expect(frame.history).toEqual(before.history); expect(frame.stats.mainDraws).toBe(0);
      const panel = frame.preview!.layers[selected]; if (panel.type !== 'panel') throw Error('Expected panel draft');
      const value = panel.style[entry.field as keyof typeof panel.style];
      const actual = await page.getByLabel(entry.input, { exact: true }).inputValue();
      expect(entry.alpha ? actual : Number(actual)).toBe(value);
    }
    const draft = await editorState(page);
    const diagnostic = await page.evaluate(() => ({ journal: (window as unknown as { __sliderJournal: unknown[] }).__sliderJournal.slice(-14), focus: document.activeElement?.getAttribute('aria-label') }));
    expect(draft.stats.gestureDraws, JSON.stringify({ label: entry.label, rect, currentRect: await slider.boundingBox(), diagnostic })).toBeGreaterThan(0); expect(draft.stats.mainDraws).toBe(0);
    const upperPixel = await page.locator('.konvajs-content canvas').nth(1).evaluate((canvas) => {
      const element = canvas as HTMLCanvasElement, root = document.querySelector('.canvas-viewport')!;
      return [...element.getContext('2d')!.getImageData(Math.floor(root.clientWidth / 2), Math.floor(root.clientHeight / 2 + 12), 1, 1).data];
    });
    expect(upperPixel).toEqual([0, 0, 255, 255]);
    await page.keyboard.press('Escape'); await page.mouse.up();
    const cancelled = await editorState(page);
    const afterCancel = await page.evaluate(() => ({ journal: (window as unknown as { __sliderJournal: unknown[] }).__sliderJournal.slice(-14), focus: document.activeElement?.getAttribute('aria-label') }));
    expect(cancelled.project).toEqual(before.project); expect(cancelled.history).toEqual(before.history); expect(cancelled.preview, JSON.stringify({ label: entry.label, afterCancel })).toBeNull(); expect(cancelled.pixels).toBe(before.pixels);
  }
});

test('range keyboard extremes, native outside release and actual capture loss keep one transaction or cancel the owned draft', async ({ page }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  const slider = page.getByLabel('边框滑块', { exact: true }); await slider.scrollIntoViewIfNeeded();
  const before = await editorState(page);
  await slider.focus(); await page.keyboard.press('End');
  await expect(page.getByLabel('对象边框', { exact: true })).toHaveValue('256');
  expect((await editorState(page)).history.past.length).toBe(before.history.past.length + 1);
  await page.keyboard.press('Home'); await expect(page.getByLabel('对象边框', { exact: true })).toHaveValue('0');
  const minimum = await editorState(page); expect(minimum.history.past.length).toBe(before.history.past.length + 2);
  await page.keyboard.press('ArrowLeft'); expect((await editorState(page)).history).toEqual(minimum.history);
  await page.keyboard.press('ArrowRight'); await expect(page.getByLabel('对象边框', { exact: true })).toHaveValue('1');
  expect((await editorState(page)).history.past.length).toBe(before.history.past.length + 3);
  for (let step = 0; step < 3; step++) await (await menuCommand(page, '撤销')).click();
  expect((await editorState(page)).project).toEqual(before.project); expect((await editorState(page)).pixels).toBe(before.pixels);
  const start = async () => {
    await slider.scrollIntoViewIfNeeded(); const rect = (await slider.boundingBox())!;
    const value = Number(await slider.inputValue()), fraction = value / 256;
    await slider.evaluate((node) => node.addEventListener('pointerdown', (event) => { (window as unknown as { __rangePointer: number }).__rangePointer = (event as PointerEvent).pointerId; }, { once: true }));
    await page.mouse.move(rect.x + 8 + (rect.width - 16) * fraction, rect.y + rect.height / 2); await page.mouse.down();
    return rect;
  };
  const startState = await editorState(page), rect = await start();
  await page.mouse.move(rect.x + rect.width + 30, rect.y + rect.height / 2);
  const outside = await editorState(page);
  expect(outside.project).toEqual(startState.project); expect(outside.history).toEqual(startState.history);
  const active = await slider.evaluate((node) => node.hasPointerCapture((window as unknown as { __rangePointer: number }).__rangePointer));
  expect(active).toBe(true); await expect(page.getByLabel('对象边框', { exact: true })).toHaveValue('256');
  await page.mouse.up(); const committed = await editorState(page);
  expect(committed.history.past.length).toBe(startState.history.past.length + 1); expect(committed.project).toEqual(outside.preview); expect(committed.preview).toBeNull();
  await (await menuCommand(page, '撤销')).click();
  const cancelBefore = await editorState(page), cancelRect = await start();
  await page.mouse.move(cancelRect.x + cancelRect.width / 2, cancelRect.y + cancelRect.height / 2); await editorState(page);
  await slider.evaluate((node) => node.releasePointerCapture((window as unknown as { __rangePointer: number }).__rangePointer));
  await page.mouse.move(cancelRect.x + cancelRect.width * .8, cancelRect.y + cancelRect.height / 2); await page.mouse.up();
  const cancelled = await editorState(page);
  expect(cancelled.project).toEqual(cancelBefore.project); expect(cancelled.history).toEqual(cancelBefore.history); expect(cancelled.preview).toBeNull(); expect(cancelled.pixels).toBe(cancelBefore.pixels);
  await slider.focus(); await page.keyboard.press('ArrowRight'); await expect(page.getByLabel('对象边框', { exact: true })).toHaveValue('5');
  expect((await editorState(page)).history.past.length).toBe(cancelBefore.history.past.length + 1);
  await (await menuCommand(page, '撤销')).click(); expect((await editorState(page)).project).toEqual(cancelBefore.project);
  const replaceRect = await start();
  const next = await page.evaluate(async () => {
    const { documentStore } = await import('/src/' + 'state/documentStore.ts'), { replaceDocument } = await import('/src/' + 'history/commandBus.ts'); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const doc = documentStore.getState() as DocumentStoreState, project = structuredClone(doc.project); project.id = crypto.randomUUID(); project.name = '滑块排队期间更换的作品';
    document.addEventListener('pointermove', (event) => {
      if (!event.isTrusted) throw Error('Native input required'); const result = replaceDocument(numberFixture(project)); if (!result.ok) throw Error(JSON.stringify(result.problems));
    }, { once: true });
    return project;
  });
  await page.mouse.move(replaceRect.x + replaceRect.width / 2, replaceRect.y + replaceRect.height / 2);
  const replaced = await editorState(page); expect(replaced.project).toEqual(next); expect(replaced.preview).toBeNull();
  await page.mouse.move(replaceRect.x + replaceRect.width * .9, replaceRect.y + replaceRect.height / 2); await page.mouse.up();
  const late = await editorState(page); expect(late.project).toEqual(next); expect(late.history).toEqual(replaced.history); expect(late.preview).toBeNull();
});
