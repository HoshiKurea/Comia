import { menuCommand } from './menuHelpers';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('PDF keeps horizontal, vertical and SFX pixels frozen when the font catalog changes between pages', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createProject, createPage, createLayer } = await import('/src/' + 'domain/factories.ts');
    const { exportPdf, exportPng } = await import('/src/' + 'export/exportFiles.ts');
    const { actualFont, registerLocalFontFamilies } = await import('/src/' + 'text/fonts.ts');
    const project = createProject({ background: false }), first = project.pageOrder[0], second = createPage({ width: 400, height: 220 }), family = 'Comia_Frozen_Font_7812';
    Object.assign(project.pages[first], { width: 400, height: 220 }); project.pages[second.id] = second; project.pageOrder.push(second.id);
    project.schemaVersion=5; // Explicit legacy SFX recipe is part of this font-freezing fixture.
    for (const pageId of project.pageOrder) {
      for (const direction of ['horizontal', 'vertical']) {
        const text = createLayer('text', pageId); text.text.content = 'WWW iii（AB）中文'; text.text.font.family = family; text.text.font.size = 24; text.text.direction = direction;
        text.box = { x: 0, y: 0, width: 165, height: 130 }; text.matrix = [1, 0, 0, 1, direction === 'horizontal' ? 10 : 205, 10]; project.layers[text.id] = text; project.pages[pageId].roots.push(text.id);
      }
      const sfx = createLayer('decoration', pageId); sfx.spec = { kind: 'sfx', width: 380, height: 60, content: 'WWW iii BANG', fontFamily: family, fontSize: 32, color: '#000000FF', outline: '#FFFFFFFF', outlineWidth: 0 }; sfx.matrix = [1, 0, 0, 1, 10, 160]; project.layers[sfx.id] = sfx; project.pages[pageId].roots.push(sfx.id);
    }
    const hashes: number[] = [], native = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
      const pixels = this.getContext('2d')!.getImageData(0, 0, this.width, this.height).data;
      let hash = 2166136261; for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619); hashes.push(hash >>> 0);
      return native.call(this, callback, type, quality);
    };
    let before = '', after = '';
    try {
      const pdf = await exportPdf(project, new Map(), undefined, { onProgress: (progress: any) => {
        if (!before && progress.phase === 'encode' && progress.completed === 1) { before = actualFont(family); registerLocalFontFamilies([family]); after = actualFont(family); }
      } });
      if (!pdf.ok) throw Error(pdf.problems[0].message);
      const png = await exportPng(project, second.id, new Map()); if (!png.ok) throw Error(png.problems[0].message);
      return { before, after, hashes, size: pdf.value.size };
    } finally { HTMLCanvasElement.prototype.toBlob = native; }
  });
  expect(result.before).toBe('Noto Sans CJK SC'); expect(result.after).toBe('Comia_Frozen_Font_7812'); expect(result.hashes).toHaveLength(3);
  expect(result.hashes[1]).toBe(result.hashes[0]); expect(result.hashes[2]).not.toBe(result.hashes[1]); expect(result.size).toBeGreaterThan(1000);
});

test('PNG uses exact scale and transparency and ignores editor zoom and pan', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts');
    const { exportPng } = await import('/src/' + 'export/exportFiles.ts');
    const { sessionStore, setViewport } = await import('/src/' + 'state/sessionStore.ts');
    const project = createProject({ background: false }), id = project.pageOrder[0];
    project.pages[id].width = 64; project.pages[id].height = 80; 
    const panel = createLayer('panel', id); panel.geometry = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
    panel.matrix = [1, 0, 0, 1, 10, 10]; panel.style.fill = '#00FF00FF'; panel.style.borderWidth = 0;
    project.layers[panel.id] = panel; project.pages[id].roots = [panel.id];
    const pixels = async (scale: number) => {
      const rendered = await exportPng(project, id, new Map(), undefined, { scale });
      if (!rendered.ok) throw new Error(rendered.problems[0].message);
      const bitmap = await createImageBitmap(rendered.value), canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height; const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
      return { width: canvas.width, height: canvas.height, rgba: [...ctx.getImageData(0, 0, canvas.width, canvas.height).data] };
    };
    setViewport(sessionStore.getState().activePageId, { zoom: 0.5, pan: { x: 70, y: 20 } }); const first = await pixels(1);
    setViewport(sessionStore.getState().activePageId, { zoom: 2, pan: { x: -200, y: -100 } }); const second = await pixels(1);
    // Reference passes an independently painted ideal color through the same native PNG codec.
    // Win WebKit's decode color-management rounds one channel; retain exact comparison at that boundary.
    const reference = document.createElement('canvas'); reference.width = 64; reference.height = 80; const referenceCtx = reference.getContext('2d')!;
    referenceCtx.fillStyle = '#00FF00FF'; referenceCtx.fillRect(10, 10, 20, 20); const referenceRaw = [...referenceCtx.getImageData(15, 15, 1, 1).data];
    const referenceBlob = await new Promise<Blob>((resolve) => reference.toBlob((blob) => resolve(blob!), 'image/png'));
    const referenceBitmap = await createImageBitmap(referenceBlob); referenceCtx.clearRect(0, 0, 64, 80); referenceCtx.drawImage(referenceBitmap, 0, 0); referenceBitmap.close();
    return { first, second, half: await pixels(0.5), referenceRaw, referenceDecoded: [...referenceCtx.getImageData(15, 15, 1, 1).data] };
  });
  expect(result.first).toEqual(result.second); expect(result.first.width).toBe(64); expect(result.first.height).toBe(80);
  expect(result.first.rgba.slice(0, 4)).toEqual([0, 0, 0, 0]);
  expect(result.referenceRaw).toEqual([0, 255, 0, 255]); expect(result.first.rgba.slice((15 * 64 + 15) * 4, (15 * 64 + 15) * 4 + 4)).toEqual(result.referenceDecoded);
  expect(result.half.width).toBe(32); expect(result.half.height).toBe(40);
});

test('slow local fonts keep export pending and cancellation produces no download', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/fonts/NotoSansCJKsc-Regular.otf', async (route) => { await gate; await route.continue(); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const downloads: string[] = []; page.on('download', (download) => downloads.push(download.suggestedFilename()));
  try {
    await page.locator('.library-item').filter({ hasText: '文字' }).click();
    await (await menuCommand(page, 'PNG')).click();
    await expect(page.getByRole('status', { name: '导出进度' })).toContainText('准备字体与图片');
    await page.getByRole('button', { name: '取消导出' }).click();
    await expect(page.getByRole('status', { name: '导出进度' })).toHaveCount(0);
    await expect(page.getByText('导出已取消', { exact: true })).toBeVisible();
    await page.waitForTimeout(200); expect(downloads).toEqual([]);
    await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
    await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
  } finally { release(); }
});

test('missing fonts are declared without changing requested font and bundled styles load locally', async ({ page }) => {
  await page.goto('/');
  const fonts = await page.evaluate(async () => {
    const { resolveFont } = await import('/src/' + 'text/fonts.ts');
    await resolveFont('Noto Sans CJK SC');
    return [...document.fonts].filter((face) => face.family.includes('Noto Sans CJK SC')).map((face) => ({ weight: face.weight, status: face.status }));
  });
  expect(fonts).toEqual(expect.arrayContaining([{ weight: '400', status: 'loaded' }, { weight: '700', status: 'loaded' }]));
  await page.locator('.library-item').filter({ hasText: '文字' }).click();
  // Import asynchronously, then commit synchronously through a handle. Keeping the
  // module import and React-triggering transaction in one CDP async evaluation
  // reproducibly loses the evaluation promise in Edge; the transaction itself succeeds.
  const changeMissingFont = await page.evaluateHandle(async () => {
    const { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const { changeLayer } = await import('/src/' + 'app/actions.ts');
    return () => changeLayer(sessionStore.getState().selection[0], '测试缺失字体', (layer: any) => { layer.text.font.family = 'Comia_Missing_Font_2394'; });
  });
  try { expect((await changeMissingFont.evaluate(change => change())).ok).toBe(true); }
  finally { await changeMissingFont.dispose(); }
  await expect(page.getByText(/找不到字体“Comia_Missing_Font_2394”/)).toBeVisible();
  await expect(page.getByLabel('文字字体')).toHaveValue('Comia_Missing_Font_2394');
  await expect(page.getByText('显示替代字体：Noto Sans CJK SC', { exact: true })).toBeVisible();
});

test('PDF freezes page order and pixels even if original pages change while encoding', async ({ page }) => {
  await page.goto('/');
  const download = page.waitForEvent('download');
  await page.evaluate(async () => {
    const { createProject, createPage, createPageBackground } = await import('/src/' + 'domain/factories.ts');
    const { downloadPdf } = await import('/src/' + 'export/exportFiles.ts');
    const project = createProject({ background: false }), first = project.pageOrder[0], second = createPage({ width: 80, height: 100 });
    project.pages[first].width = 64; project.pages[first].height = 80; const redBackground = createPageBackground(first, '#FF0000FF'); project.layers[redBackground.id] = redBackground; project.pages[first].roots = [redBackground.id];
    const greenBackground = createPageBackground(second.id, '#00FF00FF'); project.layers[greenBackground.id] = greenBackground; second.roots = [greenBackground.id]; project.pages[second.id] = second; project.pageOrder.push(second.id);
    const result = await downloadPdf(project, new Map(), undefined, { onProgress: (progress: any) => {
      if (progress.phase === 'encode' && progress.completed === 1) { greenBackground.fill = '#0000FFFF'; project.pages[second.id].width = 400; project.pageOrder.reverse(); }
    } });
    if (!result.ok) throw new Error(result.problems[0].message);
  });
  const file = await download; await file.saveAs('output/playwright/export-snapshot.pdf');
  const data = (await readFile((await file.path())!)).toString('latin1');
  expect((data.match(/\/Type\s*\/Page\b/g) ?? [])).toHaveLength(2);
  const sizes = [...data.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map((match) => match[1].trim().split(/\s+/).map(Number));
  expect(sizes[0][2]).toBeCloseTo(15.36, 2); expect(sizes[1][2]).toBeCloseTo(19.2, 2);
});

test('PDF UserUnit preserves the physical size of maximum paper at low DPI', async ({ page }) => {
  await page.goto('/'); const download = page.waitForEvent('download');
  await page.evaluate(async () => {
    const { createProject } = await import('/src/' + 'domain/factories.ts');
    const { downloadPdf } = await import('/src/' + 'export/exportFiles.ts');
    const project = createProject({ background: false }), id = project.pageOrder[0];
    Object.assign(project.pages[id], { width: 16384, height: 16, dpi: 72 });
    const result = await downloadPdf(project, new Map(), undefined, { scale: 0.25 });
    if (!result.ok) throw new Error(result.problems[0].message);
  });
  const file = await download; await file.saveAs('output/playwright/export-large-paper.pdf');
  const data = (await readFile((await file.path())!)).toString('latin1');
  expect(data.startsWith('%PDF-1.6')).toBe(true); expect(data).toContain('/UserUnit 2');
  const box = /\/MediaBox\s*\[([^\]]+)\]/.exec(data)![1].trim().split(/\s+/).map(Number);
  expect(box[2] * 2).toBe(16384); expect(box[3] * 2).toBe(16);
});

test('export owns its image snapshot after the editor closes the original and releases its copy afterwards', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts');
    const { exportPng } = await import('/src/' + 'export/exportFiles.ts');
    const project = createProject({ background: false }), id = project.pageOrder[0]; Object.assign(project.pages[id], { width: 64, height: 80 });
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ffff00'; ctx.fillRect(0, 0, 16, 16);
    const source = await createImageBitmap(canvas), image = createLayer('image', id), hash = '0'.repeat(64);
    image.assetId = crypto.randomUUID(); image.width = image.height = 16; image.matrix = [1, 0, 0, 1, 10, 10];
    project.layers[image.id] = image; project.pages[id].roots = [image.id];
    project.assets[image.assetId] = { id: image.assetId, width: 16, height: 16, renderHash: hash };
    const native = window.createImageBitmap, observed: ImageBitmap[] = [];
    window.createImageBitmap = ((...args: any[]) => (native as any)(...args).then((bitmap: ImageBitmap) => { if (args[0] === source) observed.push(bitmap); return bitmap; })) as typeof createImageBitmap;
    try {
      const rendered = await exportPng(project, id, new Map([[hash, source]]), undefined, { onProgress: (progress: any) => { if (progress.phase === 'render') source.close(); } });
      if (!rendered.ok) throw new Error(rendered.problems[0].message);
      const bitmap = await native(rendered.value), output = document.createElement('canvas'); output.width = bitmap.width; output.height = bitmap.height;
      const out = output.getContext('2d')!; out.drawImage(bitmap, 0, 0); bitmap.close();
      return { pixel: [...out.getImageData(15, 15, 1, 1).data], sourceWidth: source.width, copyWidths: observed.map((copy) => copy.width) };
    } finally { window.createImageBitmap = native; source.close(); }
  });
  expect(result.pixel).toEqual([255, 255, 0, 255]); expect(result.sourceWidth).toBe(0); expect(result.copyWidths).toEqual([0]);
});
