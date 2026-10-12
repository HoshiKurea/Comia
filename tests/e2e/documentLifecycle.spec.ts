import { menuCommand, setMenuTheme, waitForProjectIO } from './menuHelpers';
import { chromium, expect, test, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AssetMeta, ImageLayer, Project } from '../../src/domain/types';

async function state(page: Page) {
  return page.evaluate(async () => {
    const source = (path: string) => performance.getEntriesByType('resource').find((entry) => entry.name.includes(`/src/${path}`))?.name ?? `/src/${path}`;
    const { getDocument } = await import(source('state/documentStore.ts')), { sessionStore } = await import(source('state/sessionStore.ts'));
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return { ...getDocument(), session: sessionStore.getState(), pixels: document.querySelector<HTMLCanvasElement>('.konvajs-content canvas')!.toDataURL() };
  });
}
async function save(page: Page): Promise<Buffer> {
  const pending = page.waitForEvent('download'); await (await menuCommand(page, '保存')).click();
  const bytes = await readFile((await (await pending).path())!);
  // A native download event can precede the command's finally/render in WebKit.
  // A following hidden-input upload must wait for the actual file action to finish.
  await waitForProjectIO(page); return bytes;
}
async function smallPaper(page: Page) {
  await expect.poll(() => page.evaluate(async () => {
    const { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { getProject } = await import('/src/' + 'state/documentStore.ts');
    return Boolean(getProject().pages[sessionStore.getState().activePageId]);
  })).toBe(true);
  await page.evaluate(async () => {
    const { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { resizePage } = await import('/src/' + 'pages/commands.ts');
    const result = resizePage(sessionStore.getState().activePageId, { preset: 'custom', widthPx: 800, heightPx: 600, dpi: 72, orientation: 'portrait' });
    if (!result.ok) throw Error(JSON.stringify(result.problems));
  });
  await (await menuCommand(page, '适应页面')).click();
}
async function illustratedPanel(page: Page) {
  await page.locator('.library-item').filter({ hasText: '梯形分镜' }).click();
  const rect = (await page.locator('.canvas-viewport').boundingBox())!;
  await page.evaluate(async ({ x, y }) => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48;
    const context = canvas.getContext('2d')!; context.fillStyle = '#ff0000'; context.fillRect(0, 0, 32, 48); context.fillStyle = '#0000ff'; context.fillRect(32, 0, 32, 24);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
    const transfer = new DataTransfer(); transfer.items.add(new File([blob], '源图片.png', { type: 'image/png' }));
    document.querySelector('.canvas-viewport')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: transfer }));
    canvas.width = canvas.height = 0;
  }, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  await expect.poll(async () => Object.values((await state(page)).project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter((layer: any) => layer.type === 'image').length).toBe(1);
}

test('rename retains unrelated model, thumbnail DOM and Konva node identities through commit, undo and redo', async ({ page }) => {
  await page.goto('/');
  for (let index = 0; index < 3; index++) await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  const initial = await state(page), ids = initial.project.pages[initial.project.pageOrder[0]].roots.filter((id: string) => initial.project.layers[id].type !== 'pageBackground');
  await page.evaluate(async () => {
    const { getProject } = await import('/src/' + 'state/documentStore.ts'), Konva = (window as any).Konva;
    const nodes = Konva.stages.flatMap((stage: any) => [stage, ...stage.find('Layer'), ...stage.find('Shape')]);
    (window as any).__identity = { layers: getProject().layers, pages: getProject().pages, nodes, thumbnails: [...document.querySelectorAll('.layer-thumbnail')], paints: [...document.querySelectorAll<HTMLElement>('.layer-thumbnail')].map((item) => item.dataset.paintCount) };
    const observer = new MutationObserver((records) => {
      if (records.some((record) => [...record.addedNodes, ...record.removedNodes].some((node) => node instanceof Element && (node.matches('.layer-thumbnail,.konvajs-content') || node.querySelector('.layer-thumbnail,.konvajs-content'))))) (window as any).__identity.remounts++;
    });
    (window as any).__identity.remounts = 0; observer.observe(document.querySelector('.editor') ?? document.body, { childList: true, subtree: true });
    (window as any).__identity.observer = observer;
  });
  await page.locator(`[data-layer-id="${ids[0]}"] .layer-name`).dblclick();
  const input = page.getByLabel('图层名称', { exact: true }); await input.fill('重命名😀'); await input.press('Enter');
  for (const action of ['commit', 'undo', 'redo']) {
    if (action !== 'commit') await (await menuCommand(page, action === 'undo' ? '撤销' : '重做')).click();
    const stable = await page.evaluate(async (id) => {
      const { getProject } = await import('/src/' + 'state/documentStore.ts'), Konva = (window as any).Konva;
      const saved = (window as any).__identity, project = getProject(), nodes = Konva.stages.flatMap((stage: any) => [stage, ...stage.find('Layer'), ...stage.find('Shape')]);
      return { unrelated: Object.entries(saved.layers).filter(([, layer]) => (layer as { type: string }).type !== 'pageBackground').map(([id]) => id).filter((key) => key !== id).every((key) => project.layers[key] === saved.layers[key]), pages: project.pages === saved.pages,
        nodes: nodes.length === saved.nodes.length && nodes.every((node: any, index: number) => node === saved.nodes[index]),
        thumbnails: [...document.querySelectorAll('.layer-thumbnail')].every((node, index) => node === saved.thumbnails[index]), paints: [...document.querySelectorAll<HTMLElement>('.layer-thumbnail')].map((item) => item.dataset.paintCount), remounts: saved.remounts };
    }, ids[0]);
    expect(stable).toMatchObject({ unrelated: true, pages: true, nodes: true, thumbnails: true, remounts: 0 });
    expect(stable.paints).toEqual(await page.evaluate(() => (window as any).__identity.paints));
  }
  await page.evaluate(() => (window as any).__identity.observer.disconnect());
});

test('session changes do not enter history and real runtime objects and preview data never enter the saved file', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  const before = await state(page);
  await setMenuTheme(page, 'dark');
  await page.evaluate(async () => {
    const { sessionStore, setViewport } = await import('/src/' + 'state/sessionStore.ts'), { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts');
    setViewport(sessionStore.getState().activePageId, { zoom: .5, pan: { x: 87, y: -34 } }); sessionStore.setState({ selection: [] });
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
    runtimeStore.setState({ abortControllers: new Map([['RUNTIME_SENTINEL', new AbortController()]]),
      pendingImages: new Map([['PREVIEW_SENTINEL', Promise.resolve(await createImageBitmap(canvas))]]), previewProject: structuredClone((await import('/src/' + 'state/documentStore.ts')).getProject()) });
    // Native DOM/preview data and a test handle are held only by this runtime store; no disk access is claimed.
    (runtimeStore as any).setState({ domNode: canvas, fileHandle: { kind: 'file', name: 'C:\\private\\HANDLE_SENTINEL' }, previewBase64: canvas.toDataURL() });
  });
  expect((await state(page)).history).toEqual(before.history);
  const payload = (await save(page)).toString(), envelope = JSON.parse(payload);
  expect(Object.keys(envelope).sort()).toEqual(['blobs', 'format', 'project', 'version']); expect(envelope.project).toEqual(before.project); expect(envelope.blobs).toEqual([]);
  expect(payload).not.toMatch(/RUNTIME_SENTINEL|PREVIEW_SENTINEL|HANDLE_SENTINEL|data:image|viewportByPage|previewProject|abortControllers|fileHandle|selection/);
  await (await menuCommand(page, '撤销')).click();
  const undone = await state(page); expect(Object.entries(undone.project.layers).filter(([, layer]) => (layer as { type: string }).type !== 'pageBackground').map(([id]) => id)).toHaveLength(0); expect(undone.session.theme).toBe('dark');
  expect(undone.session.viewportByPage[before.project.pageOrder[0]]).toEqual({ zoom: .5, pan: { x: 87, y: -34 } });
  await (await menuCommand(page, '重做')).click(); expect((await state(page)).project).toEqual(before.project);
});

test('each page restores its own zoom, pan and pixels and switching clears selection without adding history', async ({ page }) => {
  await page.goto('/'); await smallPaper(page); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  const first = await state(page), firstId = first.session.activePageId;
  await page.getByRole('tab', { name: '页面', exact: true }).click(); await page.getByRole('button', { name: '+ 新建漫画页', exact: true }).click();
  const newPage = await state(page), secondId = newPage.session.activePageId;
  expect(secondId).not.toBe(firstId); expect(newPage.project.pages[secondId]).toMatchObject({ width: 800, height: 600, dpi: 72, roots: [newPage.project.pages[secondId].roots[0]] });
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(0); await (await menuCommand(page, '撤销')).click();
  const undone = await state(page); expect(undone.project).toEqual(first.project); expect(undone.session.activePageId).toBe(firstId);
  await (await menuCommand(page, '重做')).click(); expect((await state(page)).session.activePageId).toBe(secondId);
  await page.getByRole('tab', { name: '组件库', exact: true }).click(); await page.locator('.library-item').filter({ hasText: '对白气泡' }).click();
  const viewports = [{ zoom: .5, pan: { x: 51, y: 63 } }, { zoom: 1.25, pan: { x: -97, y: 18 } }];
  await page.getByRole('tab', { name: '页面', exact: true }).click();
  const pageButton = (id: string) => page.locator(`[data-page-id="${id}"]`).locator('button').first();
  const expectedPixels: string[] = [];
  for (const [index, id] of [firstId, secondId].entries()) {
    await pageButton(id).click();
    await page.evaluate(async ({ id, viewport }) => { const { setViewport } = await import('/src/' + 'state/sessionStore.ts'); setViewport(id, viewport); }, { id, viewport: viewports[index] });
    await expect(page.locator('.zoom-readout')).toHaveText(`${viewports[index].zoom * 100}%`);
    await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').first().click(); expectedPixels.push((await state(page)).pixels);
  }
  const history = (await state(page)).history;
  for (const [index, id] of [firstId, secondId, firstId, secondId].entries()) {
    await pageButton(id).click(); const result = await state(page), n = index % 2;
    expect(result.session.activePageId).toBe(id); expect(result.session.viewportByPage[id]).toEqual(viewports[n]); expect(result.session.selection).toEqual([]);
    expect(result.history).toEqual(history); expect(result.pixels).toBe(expectedPixels[n]);
  }
});

test('valid-image base64 tampering, duplicate hashes and unsupported versions reject atomically and expose actionable errors', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/'); await smallPaper(page); await illustratedPanel(page);
  const original = JSON.parse((await save(page)).toString());
  const corrupt = structuredClone(original);
  // Replace the picture with a different, actually decodable PNG. Keep the old SHA;
  // adjust byte declarations so the rejection must be the hash, not syntax/length/decoder failure.
  corrupt.blobs[0].base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48;
    const context = canvas.getContext('2d')!; context.fillStyle = '#00ff00'; context.fillRect(0, 0, 64, 48);
    const base64 = canvas.toDataURL('image/png').split(',')[1]; canvas.width = canvas.height = 0; return base64;
  });
  corrupt.blobs[0].bytes = Buffer.from(corrupt.blobs[0].base64, 'base64').length;
  for (const asset of Object.values(corrupt.project.assets) as any[]) {
    if (asset.originalHash === corrupt.blobs[0].hash) asset.originalBytes = corrupt.blobs[0].bytes;
    if (asset.renderHash === corrupt.blobs[0].hash) asset.renderBytes = corrupt.blobs[0].bytes;
  }
  expect(await page.evaluate(async (base64) => {
    const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const image = await createImageBitmap(new Blob([data], { type: 'image/png' })); const size = { width: image.width, height: image.height }; image.close(); return size;
  }, corrupt.blobs[0].base64)).toEqual({ width: 64, height: 48 });
  const duplicate = structuredClone(original); duplicate.blobs.push(structuredClone(duplicate.blobs[0]));
  const version = structuredClone(original); version.version = 2;
  const missing = structuredClone(original); delete missing.version;
  const before = await state(page);
  for (const [envelope, error] of [[corrupt, '校验失败'], [duplicate, '素材哈希重复'], [version, '支持版本1'], [missing, '支持版本1']] as const) {
    await page.locator('input[type=file][accept*=json]').setInputFiles({ name: 'modified.Comia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(envelope)) });
     await waitForProjectIO(page);
    await expect(page.locator('.notice-stack')).toContainText(error);
    const after = await state(page); expect(after.project).toEqual(before.project); expect(after.history).toEqual(before.history); expect(after.epoch).toBe(before.epoch); expect(after.pixels).toBe(before.pixels);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  const privateMetadata = structuredClone(original); privateMetadata.project.machinePath = 'C:\\Users\\private\\PRIVATE_PATH_SENTINEL';
  for (const asset of Object.values(privateMetadata.project.assets) as any[]) { asset.sourcePath = 'E:\\private\\PRIVATE_PATH_SENTINEL'; asset.url = 'https://private.invalid/PRIVATE_PATH_SENTINEL'; }
  for (const layer of Object.values(privateMetadata.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground') as any[]) layer.previewBase64 = 'data:image/png;base64,PREVIEW_PATH_SENTINEL';
  await page.locator('input[type=file][accept*=json]').setInputFiles({ name: 'private-metadata.Comia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(privateMetadata)) });
  await waitForProjectIO(page);
  await expect.poll(async () => (await state(page)).epoch).toBe(before.epoch + 1); expect((await state(page)).project).toEqual(original.project);
  const cleaned = (await save(page)).toString(); expect(cleaned).not.toMatch(/PRIVATE_PATH_SENTINEL|PREVIEW_PATH_SENTINEL|machinePath|sourcePath|previewBase64/);
});

test('a Chromium-saved file moved to another directory opens in the current browser with identical assets, Unicode text, templates and hierarchy', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const producer = await chromium.launch({ channel: 'chromium' }), context = await producer.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const source = await context.newPage(); await source.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
    await source.goto(test.info().project.use.baseURL ?? 'http://127.0.0.1:5173'); await smallPaper(source); await illustratedPanel(source);
    await source.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').filter({ hasText: '分镜' }).click();
    await source.getByRole('button', { name: '存为组件', exact: true }).click();
    const presetDialog = source.getByRole('dialog', { name: '保存组件预设', exact: true });
    await presetDialog.getByLabel('预设名称', { exact: true }).fill('用户梯形组件😀');
    await expect(presetDialog).toContainText('本预设不包含 1 张图片');
    await presetDialog.getByRole('button', { name: '保存预设', exact: true }).click();
    await source.locator('.library-item').filter({ hasText: '文字' }).click();
    await source.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').filter({ hasText: '文字' }).dblclick(); await source.getByLabel('图层名称', { exact: true }).fill('跨浏览器对白😀'); await source.getByLabel('图层名称', { exact: true }).press('Enter');
    await source.evaluate(async () => {
      const { getProject } = await import('/src/' + 'state/documentStore.ts'), { execute } = await import('/src/' + 'history/commandBus.ts');
      const project = getProject(), text: any = Object.values(project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((layer: any) => layer.type === 'text')!;
      const result = execute({ label: '对白内容', context: { pageId: project.pageOrder[0], selection: [text.id] }, mutate(draft: any) { draft.layers[text.id].text.content = '你好，浏览器！\n第二行😀'; } });
      if (!result.ok) throw Error(JSON.stringify(result.problems));
    });
    await source.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').filter({ hasText: '分镜' }).click({ modifiers: ['Control'] }); await (await menuCommand(source, '编组')).click();
    const saved = source.waitForEvent('download'); await (await menuCommand(source, '保存')).click();
    const file = await saved, moved = testInfo.outputPath('其他目录', '跨浏览器作品.COMIA.JSON'); await mkdir(dirname(moved), { recursive: true }); await file.saveAs(moved);
    const bytes = await readFile(moved), envelope = JSON.parse(bytes.toString());
    expect(envelope.blobs).toHaveLength(1); expect(Object.values(envelope.project.templates)).toHaveLength(1);
    expect(bytes.toString()).not.toMatch(/C:\\\\|E:\\\\|blob:|https?:\/\/|data:image|\/Users\//);
    await page.goto('/'); await page.locator('input[type=file][accept*=json]').setInputFiles(moved);
    await expect.poll(async () => (await state(page)).project.id).toBe(envelope.project.id);
    const target = await state(page); expect(target.project).toEqual(envelope.project); expect(target.history.past).toHaveLength(0); expect(target.history.future).toHaveLength(0);
    expect(target.session.activePageId).toBe(envelope.project.pageOrder[0]); expect(target.session.selection).toEqual([]);
    await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1); await expect(page.locator('.library-item').filter({ hasText: '用户梯形组件😀' })).toBeVisible();
    const assetPixels = async (current: Page) => current.evaluate(async () => {
      const { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts'); const values: Record<string, number[]> = {};
      for (const [hash, image] of runtimeStore.getState().images) {
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
        values[hash] = [...ctx.getImageData(0, 0, canvas.width, canvas.height).data]; canvas.width = canvas.height = 0;
      }
      return values;
    });
    expect(await assetPixels(page)).toEqual(await assetPixels(source));
    await expect.poll(() => page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.konvajs-content canvas')!; return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 !== 3 && value > 0 && value < 250);
    })).toBe(true);
  } finally { await context.close(); await producer.close(); }
});

test('opening shared display hashes decodes once, retains parked bitmaps and releases them when their tab closes', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/'); await smallPaper(page); await illustratedPanel(page);
  const before = await state(page);
  const envelope: { project: Project; blobs: unknown[] } = JSON.parse((await save(page)).toString());
  const original = Object.values(envelope.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((layer): layer is ImageLayer => layer.type === 'image')!;
  const asset = envelope.project.assets[original.assetId];
  const shared: AssetMeta = { ...structuredClone(asset), id: crypto.randomUUID(), name: '独立原图，显示像素相同' };
  const duplicate: ImageLayer = { ...structuredClone(original), id: crypto.randomUUID(), assetId: shared.id };
  // Keep the duplicate independently editable but initially hidden. Drawing
  // both over the same antialiased edge changes coverage by design.
  duplicate.visible = false;
  envelope.project.assets[shared.id] = shared; envelope.project.layers[duplicate.id] = duplicate;
  const parent = envelope.project.layers[original.parentId!];
  if (!('children' in parent)) throw Error('expected illustrated panel');
  parent.children.push(duplicate.id);
  await page.evaluate(() => {
    const decode = globalThis.createImageBitmap.bind(globalThis);
    const observed: ImageBitmap[] = [];
    (window as unknown as { sharedDecodeObservations: ImageBitmap[] }).sharedDecodeObservations = observed;
    globalThis.createImageBitmap = async (source: ImageBitmapSource) => {
      const bitmap = await decode(source); observed.push(bitmap); return bitmap;
    };
  });
  await page.locator('input[type=file][accept*=json]').setInputFiles({ name: 'shared-display.Comia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(envelope)) });
  await waitForProjectIO(page);
  await expect.poll(async () => Object.keys((await state(page)).project.assets).length).toBe(2);
  await (await menuCommand(page, '适应页面')).click();
  const opened = await state(page); expect(opened.project).toEqual(envelope.project); expect(opened.pixels).toBe(before.pixels);
  expect(await page.evaluate(async () => {
    const { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts');
    const bitmaps = (window as unknown as { sharedDecodeObservations: ImageBitmap[] }).sharedDecodeObservations;
    return { count: bitmaps.length, images: runtimeStore.getState().images.size, widths: bitmaps.map((value) => value.width) };
  })).toEqual({ count: 1, images: 1, widths: [64] });
  const empty = structuredClone(envelope); empty.project.layers = {}; empty.project.assets = {}; empty.project.libraryAssetIds = [];
  if(empty.project.assetLibrary)empty.project.assetLibrary.assetFolder={};
  empty.project.pages[empty.project.pageOrder[0]].roots = []; empty.blobs = [];
  await page.locator('input[type=file][accept*=json]').setInputFiles({ name: 'empty.Comia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(empty)) });
  await expect.poll(async () => Object.entries((await state(page)).project.layers).filter(([, layer]) => (layer as { type: string }).type !== 'pageBackground').map(([id]) => id).length).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { sharedDecodeObservations: ImageBitmap[] }).sharedDecodeObservations.map((value) => value.width))).toEqual([64]);
  await page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab').nth(1).click(); await waitForProjectIO(page); await (await menuCommand(page, '关闭当前项目')).click(); await waitForProjectIO(page);
  expect(await page.evaluate(() => (window as unknown as { sharedDecodeObservations: ImageBitmap[] }).sharedDecodeObservations.map((value) => value.width))).toEqual([0]);
});
