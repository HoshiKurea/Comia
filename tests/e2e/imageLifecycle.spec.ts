import { menuCommand, waitForProjectIO } from './menuHelpers';
import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
}
async function state(page: Page) {
  await ready(page);
  return page.evaluate(async () => {
    const { getDocument } = await import('/src/' + 'state/documentStore.ts'), { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts');
    const runtime = runtimeStore.getState();
    return { ...getDocument(), pixels: document.querySelector<HTMLCanvasElement>('.konvajs-content canvas')!.toDataURL(),
      blobs: [...runtime.blobs.keys()], images: [...runtime.images.keys()], pending: runtime.pendingImages.size, preview: runtime.previewProject, gesture: runtime.gestureActive };
  });
}
async function setup(page: Page) {
  await page.goto('/');
  await expect.poll(() => page.evaluate(async () => {
    const { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { getProject } = await import('/src/' + 'state/documentStore.ts');
    return Boolean(getProject().pages[sessionStore.getState().activePageId]);
  })).toBe(true);
  await page.evaluate(async () => {
    const { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { resizePage } = await import('/src/' + 'pages/commands.ts');
    const result = resizePage(sessionStore.getState().activePageId, { preset: 'custom', widthPx: 800, heightPx: 600, dpi: 72, orientation: 'portrait' });
    if (!result.ok) throw Error(JSON.stringify(result.problems));
  });
  await (await menuCommand(page, '适应页面')).click(); await ready(page);
}
async function drop(page: Page, color: string, point?: { x: number; y: number }) {
  const rect = (await page.locator('.canvas-viewport').boundingBox())!;
  await page.evaluate(async ({ color, point }) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16; const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 16, 16);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
    const transfer = new DataTransfer(); transfer.items.add(new File([blob], '图片.png', { type: 'image/png' }));
    document.querySelector('.canvas-viewport')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: point.x, clientY: point.y })); canvas.width = canvas.height = 0;
  }, { color, point: point ?? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } });
}
async function gateNextDecode(page: Page) {
  await page.evaluate(() => {
    const native = window.createImageBitmap.bind(window);
    const gate: any = { entered: false, bitmap: null, resume: null, native };
    const held = new Promise<void>((resolve) => { gate.resume = resolve; }); let armed = true;
    window.createImageBitmap = (async (...args: any[]) => {
      if (!armed) return (native as any)(...args); armed = false; gate.entered = true; await held;
      const bitmap = await (native as any)(...args); gate.bitmap = bitmap; return bitmap;
    }) as typeof createImageBitmap;
    (window as any).__decodeGate = gate;
  });
}
async function resumeDecode(page: Page) {
  await page.evaluate(() => { const gate = (window as any).__decodeGate; window.createImageBitmap = gate.native; gate.resume(); });
  await expect(page.locator('.notice-stack')).toContainText('页面或目标已变化，导入取消');
  await expect.poll(() => page.evaluate(() => (window as any).__decodeGate.bitmap?.width)).toBe(0);
}

test('a real delayed image decode is discarded after its target panel is deleted and closes the decoded bitmap', async ({ page }) => {
  await setup(page); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  await gateNextDecode(page); await drop(page, '#ff0000'); await expect.poll(() => page.evaluate(() => (window as any).__decodeGate.entered)).toBe(true);
  await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').click(); await page.keyboard.press('Delete'); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(0);
  const before = await state(page); await resumeDecode(page); const after = await state(page);
  expect(after.project).toEqual(before.project); expect(after.history).toEqual(before.history); expect(after.pixels).toBe(before.pixels);
  expect(after.blobs).toEqual([]); expect(after.images).toEqual([]); expect(after.pending).toBe(0);
});

test('a real delayed image from project A cannot install into newly opened project B or alter its pixels and history', async ({ page }) => {
  await setup(page); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  await gateNextDecode(page); await drop(page, '#ff0000'); await expect.poll(() => page.evaluate(() => (window as any).__decodeGate.entered)).toBe(true);
  const projectB = await page.evaluate(async () => { const { createProject, createPageBackground } = await import('/src/' + 'domain/factories.ts'); const project = createProject({ background: false }); project.name = '新项目B'; const background = createPageBackground(project.pageOrder[0], '#00FF00FF'); project.layers[background.id] = background; project.pages[project.pageOrder[0]].roots = [background.id]; return project; });
  await page.locator('input[type=file][accept*=json]').setInputFiles({ name: 'B.Comia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'Comia', version: 1, project: projectB, blobs: [] })) });
  await waitForProjectIO(page);
  await expect(page.locator('.project-name')).toHaveText('新项目B'); const before = await state(page);
  await resumeDecode(page); const after = await state(page); expect(after.project).toEqual(projectB); expect(after.history).toEqual(before.history); expect(after.epoch).toBe(before.epoch); expect(after.pixels).toBe(before.pixels);
  expect(after.blobs).toEqual([]); expect(after.images).toEqual([]); expect(after.pending).toBe(0);
});

test('undo during an ordinary pointer drag cancels the preview, leaves no residual pixels and ignores the later pointer release', async ({ page }) => {
  await setup(page); const blank = await state(page); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  const rect = (await page.locator('.canvas-viewport').boundingBox())!, point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 65, point.y + 44, { steps: 12 });
  await expect.poll(async () => (await state(page)).gesture).toBe(true);
  await page.keyboard.press('Control+z'); await page.mouse.up(); const after = await state(page);
  expect(after.project).toEqual(blank.project); expect(after.history.past).toHaveLength(blank.history.past.length); expect(after.gesture).toBe(false); expect(after.preview).toBeNull(); expect(after.pixels).toBe(blank.pixels);
  await (await menuCommand(page, '重做')).click(); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
});

test('a second image overlays the first without deleting it, hide reveals the original pixels, and undo restores the first image', async ({ page }) => {
  await setup(page); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  await drop(page, '#ff0000'); await expect.poll(async () => Object.values((await state(page)).project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter((layer: any) => layer.type === 'image').length).toBe(1);
  const first = await state(page); await drop(page, '#0000ff');
  await expect.poll(async () => Object.values((await state(page)).project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter((layer: any) => layer.type === 'image').length).toBe(2);
  const second = await state(page), panel: any = Object.values(second.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((layer: any) => layer.type === 'panel');
  expect(panel.children).toHaveLength(2); expect(second.project.layers[panel.children[0]]).toEqual(first.project.layers[panel.children[0]]);
  const centerPixel = () => page.evaluate(() => { const canvas = document.querySelector<HTMLCanvasElement>('.konvajs-content canvas')!; return [...canvas.getContext('2d')!.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data]; });
  expect(await centerPixel()).toEqual([0, 0, 255, 255]);
  await page.getByRole('button', { name: '展开图层', exact: true }).click();
  await page.locator(`[data-layer-id="${panel.children[1]}"]`).getByRole('button', { name: '隐藏', exact: true }).click(); await ready(page);
  expect(await centerPixel()).toEqual([255, 0, 0, 255]); expect((await state(page)).pixels).toBe(first.pixels);
  await (await menuCommand(page, '撤销')).click(); await (await menuCommand(page, '撤销')).click();
  const restored = await state(page); expect(restored.project).toEqual(first.project); expect(restored.pixels).toBe(first.pixels);
});

test('a drop inside a trapezoid bounding box but outside its contour creates an independent root image', async ({ page }) => {
  await setup(page); await page.locator('.library-item').filter({ hasText: '梯形分镜' }).click();
  const point = await page.evaluate(async () => {
    const { getProject } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { apply, worldMatrix } = await import('/src/' + 'geometry/matrix.ts');
    const project = getProject(), id = sessionStore.getState().selection[0], p = apply(worldMatrix(project, id), { x: 10, y: 10 });
    const vp = sessionStore.getState().viewportByPage[sessionStore.getState().activePageId], rect = document.querySelector('.canvas-viewport')!.getBoundingClientRect();
    return { x: rect.left + vp.pan.x + vp.zoom * p.x, y: rect.top + vp.pan.y + vp.zoom * p.y };
  });
  await drop(page, '#00ff00', point); await expect.poll(async () => Object.values((await state(page)).project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter((layer: any) => layer.type === 'image').length).toBe(1);
  const after = await state(page), image: any = Object.values(after.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((layer: any) => layer.type === 'image'), panel: any = Object.values(after.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((layer: any) => layer.type === 'panel');
  expect(image.parentId).toBeNull(); expect(image.crop).toBeNull(); expect(panel.children).toEqual([]); expect(after.project.pages[image.pageId].roots.filter((id: string) => after.project.layers[id].type !== 'pageBackground')).toEqual([panel.id, image.id]);
  await (await menuCommand(page, '撤销')).click(); expect(Object.values((await state(page)).project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter((layer: any) => layer.type === 'image')).toHaveLength(0);
});

test('damaged, actual over-50MiB and over-40MP declared files reject a real mixed batch without layers, history or retained decoded resources', async ({ page }) => {
  await setup(page); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); const before = await state(page);
  const rect = (await page.locator('.canvas-viewport').boundingBox())!;
  for (const [kind, message] of [['damaged', '图片解码失败'], ['bytes', '单张图片超过50MiB'], ['pixels', '超过40MP，未开始解码']] as const) {
    await page.evaluate(async ({ kind, point }) => {
      const native = window.createImageBitmap.bind(window), bitmaps: ImageBitmap[] = [];
      (window as any).__batchBitmaps = bitmaps; (window as any).__batchNative = native;
      window.createImageBitmap = (async (...args: any[]) => { const bitmap = await (native as any)(...args); bitmaps.push(bitmap); return bitmap; }) as typeof createImageBitmap;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16; canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
      const good = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png')); canvas.width = canvas.height = 0;
      let bad: Blob;
      if (kind === 'bytes') bad = new Blob([new Uint8Array(50 * 1024 * 1024 + 1)], { type: 'image/png' });
      else {
        const header = new Uint8Array(24); header.set([137, 80, 78, 71, 13, 10, 26, 10]); header.set([73, 72, 68, 82], 12);
        const view = new DataView(header.buffer); view.setUint32(16, kind === 'pixels' ? 10000 : 16, false); view.setUint32(20, kind === 'pixels' ? 10000 : 16, false);
        // The over-40MP declared PNG is rejected from its header before allocating its claimed raster.
        bad = new Blob([header], { type: 'image/png' });
      }
      const transfer = new DataTransfer(); transfer.items.add(new File([good], '有效图片.png', { type: 'image/png' })); transfer.items.add(new File([bad], `${kind}.png`, { type: 'image/png' }));
      document.querySelector('.canvas-viewport')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: point.x, clientY: point.y }));
    }, { kind, point: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } });
    await expect(page.locator('.notice-stack')).toContainText(message); await expect(page.locator('.notice-stack')).toContainText(`${kind}.png`);
    await expect.poll(() => page.evaluate(() => (window as any).__batchBitmaps.map((bitmap: ImageBitmap) => bitmap.width))).toEqual([0]);
    await page.evaluate(() => { window.createImageBitmap = (window as any).__batchNative; });
    const after = await state(page); expect(after.project).toEqual(before.project); expect(after.history).toEqual(before.history); expect(after.pixels).toBe(before.pixels); expect(after.blobs).toEqual([]); expect(after.images).toEqual([]);
  }
});

test('normalization context and encoding failures close the real bitmap and release temporary canvases, then a later import succeeds', async ({ page }) => {
  await setup(page); const before = await state(page);
  for (const fault of ['context', 'encoding'] as const) {
    // Generate the input before instrumenting normalization, so test setup canvases are not counted.
    const base64 = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16; canvas.getContext('2d')!.fillRect(0, 0, 16, 16); const result = canvas.toDataURL().split(',')[1]; canvas.width = canvas.height = 0; return result; });
    await page.evaluate(({ fault, base64 }) => {
      const nativeCreate = document.createElement.bind(document), nativeDecode = window.createImageBitmap.bind(window), bitmaps: ImageBitmap[] = [], canvases: HTMLCanvasElement[] = [];
      (window as any).__failure = { nativeCreate, nativeDecode, bitmaps, canvases };
      document.createElement = ((name: string, options?: ElementCreationOptions) => {
        const element = nativeCreate(name, options);
        if (name === 'canvas') {
          const canvas=element as HTMLCanvasElement,nativeContext=canvas.getContext.bind(canvas),nativeBlob=canvas.toBlob.bind(canvas);
          // Fault only the 16x16 normalization canvas; stable hidden panels also render thumbnails.
          canvas.getContext=((...args:any[])=>{if(canvas.width===16&&canvas.height===16){if(!canvases.includes(canvas))canvases.push(canvas);if(fault==='context')return null;}return (nativeContext as any)(...args);}) as typeof canvas.getContext;
          canvas.toBlob=((callback:BlobCallback,type?:string,quality?:any)=>{if(canvas.width===16&&canvas.height===16&&fault==='encoding')callback(null);else nativeBlob(callback,type,quality);}) as typeof canvas.toBlob;
        }
        return element;
      }) as typeof document.createElement;
      window.createImageBitmap = (async (...args: any[]) => { const bitmap = await (nativeDecode as any)(...args); bitmaps.push(bitmap); return bitmap; }) as typeof createImageBitmap;
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)), transfer = new DataTransfer(); transfer.items.add(new File([bytes], '失败图片.png', { type: 'image/png' }));
      const rect = document.querySelector('.canvas-viewport')!.getBoundingClientRect(); document.querySelector('.canvas-viewport')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
    }, { fault, base64 });
    await expect(page.locator('.notice-stack')).toContainText(fault === 'context' ? '无法创建图片画布' : '编码失败');
    const released = await page.evaluate(() => { const value = (window as any).__failure; document.createElement = value.nativeCreate; window.createImageBitmap = value.nativeDecode; return { widths: value.bitmaps.map((bitmap: ImageBitmap) => bitmap.width), canvases: value.canvases.map((canvas: HTMLCanvasElement) => [canvas.width, canvas.height]) }; });
    expect(released).toEqual({ widths: [0], canvases: [[0, 0]] }); const after = await state(page); expect(after.project).toEqual(before.project); expect(after.history).toEqual(before.history); expect(after.pixels).toBe(before.pixels);
  }
  await drop(page, '#ff0000'); await expect.poll(async () => Object.values((await state(page)).project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter((layer: any) => layer.type === 'image').length).toBe(1);
  expect((await state(page)).images).toHaveLength(1);
});
