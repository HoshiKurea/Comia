import { parkFloatingControls } from './floatingHelpers';
import { menuCommand } from './menuHelpers';
import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { ImageLayer, Project } from '../../src/domain/types';

async function state(page: Page): Promise<{ project: Project; past: number; selection: string[]; stats: { mainDraws: number; gestureDraws: number; overlayDraws: number } }> {
  return page.evaluate(async () => { const { getDocument } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts'); return { project: getDocument().project, past: getDocument().history.past.length, selection: sessionStore.getState().selection, stats: runtimeStore.getState().renderStats }; });
}
async function setup(page: Page) {
  await page.goto('/'); await expect(page.getByRole('tab', { name: '素材库', exact: true })).toBeVisible();
  await page.evaluate(async () => { const { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { resizePage } = await import('/src/' + 'pages/commands.ts'); const result = resizePage(sessionStore.getState().activePageId, { preset: 'custom', widthPx: 640, heightPx: 480, dpi: 72, orientation: 'portrait' }); if (!result.ok) throw Error(JSON.stringify(result)); });
  await (await menuCommand(page, '适应页面')).click();
  await page.getByRole('tab', { name: '素材库', exact: true }).click();
}
async function payload(page: Page, name = '拼贴.png', color = '#ff0000') {
  const base64 = await page.evaluate(color => { const c = document.createElement('canvas'); c.width = 512; c.height = 384; const ctx = c.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 256, 384); ctx.fillStyle = '#0000ff'; ctx.fillRect(256, 0, 256, 384); const data = c.toDataURL().split(',')[1]; c.width = c.height = 0; return data; }, color);
  return { name, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
}
async function importOne(page: Page) { await page.getByLabel('导入素材文件').setInputFiles(await payload(page)); await expect(page.getByRole('button', { name: '放置素材 拼贴.png', exact: true })).toBeVisible(); }
async function placed(page: Page) { await setup(page); await importOne(page); await page.getByRole('button', { name: '放置素材 拼贴.png', exact: true }).click(); return state(page); }
function imageOf(s: { project: Project; selection: string[] }): ImageLayer { const image = s.project.layers[s.selection[0]]; if (image?.type !== 'image') throw Error('Not an image'); return image; }
async function ready(page: Page) { await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }); }

test('file import fills the separate library without placing, deduplicates multiple files, and click places a selected independent image', async ({ page }) => {
  await setup(page); const before = await state(page), chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '＋ 导入图片', exact: true }).click(); const files = await chooser;
  await files.setFiles([await payload(page), await payload(page, '同图.png')]); await expect(page.locator('.asset-card')).toHaveCount(1);
  const imported = await state(page); expect(imported.past).toBe(before.past + 1); expect(Object.entries(imported.project.layers).filter(([, layer]) => (layer as { type: string }).type !== 'pageBackground').map(([id]) => id)).toHaveLength(0);
  await page.getByRole('button', { name: '放置素材 拼贴.png', exact: true }).click(); const after = await state(page), image = imageOf(after), paper = after.project.pages[image.pageId];
  expect(image.parentId).toBeNull(); expect(image.crop).toBeNull(); expect(image.matrix[4] + image.width * image.matrix[0] / 2).toBe(paper.width / 2); expect(after.past).toBe(imported.past + 1);
  await page.getByLabel('搜索素材').fill('不存在'); await expect(page.locator('.asset-card')).toHaveCount(0); await page.getByLabel('搜索素材').fill(''); await expect(page.locator('.asset-card')).toHaveCount(1);
  await page.screenshot({ path: `output/playwright/material-library-${test.info().project.name || 'edge'}.png` });
});

test('invalid batch imports nothing and leaves placed images, original resources and history untouched', async ({ page }) => {
  const before = await placed(page);
  await page.getByLabel('导入素材文件').setInputFiles([await payload(page, '新素材.png'), { name: '无效.png', mimeType: 'image/png', buffer: Buffer.from('broken') }]);
  await expect(page.locator('.notice-stack')).toContainText('本批素材未导入'); expect((await state(page)).project).toEqual(before.project); expect((await state(page)).past).toBe(before.past); await expect(page.locator('.asset-card')).toHaveCount(1);
});

test('Alt library drag creates a free instance at the release point even over a frame and undo removes just that instance', async ({ page }) => {
  await setup(page); await importOne(page); await page.getByRole('tab', { name: '组件库', exact: true }).click(); await page.getByRole('button', { name: '矩形分镜', exact: true }).click(); await page.getByRole('tab', { name: '素材库', exact: true }).click();
  const before = await state(page), tile = page.getByRole('button', { name: '放置素材 拼贴.png', exact: true }), target = page.locator('.canvas-viewport');
  const source = (await tile.boundingBox())!, canvas = (await target.boundingBox())!; await ready(page); const baseline = await state(page);
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page.mouse.down(); await page.mouse.move(source.x + source.width / 2 + 15, source.y + source.height / 2 + 15); await ready(page);
  await expect(page.getByTestId('asset-drag-preview')).toBeVisible(); const during = await state(page); expect(during.project).toEqual(before.project); expect(during.past).toBe(before.past); expect(during.stats.mainDraws).toBe(baseline.stats.mainDraws);
  await page.screenshot({ path: `output/playwright/material-drag-${test.info().project.name || 'edge'}.png` });
  await page.keyboard.down('Alt'); await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2, { steps: 15 }); await page.mouse.up(); await page.keyboard.up('Alt'); const after = await state(page), image = imageOf(after); expect(after.past).toBe(before.past + 1); expect(image.parentId).toBeNull(); expect(Object.values(after.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter(l => l.type === 'image')).toHaveLength(1);
  await expect(page.getByTestId('asset-drag-preview')).toBeHidden();
  await (await menuCommand(page, '撤销')).click(); expect((await state(page)).project).toEqual(before.project);
});

test('an existing frame image remains editable and can unbind/rebind with visible position, size and rotation controls', async ({ page }) => {
  await setup(page); await importOne(page); await page.getByRole('tab', { name: '组件库', exact: true }).click(); await page.getByRole('button', { name: '矩形分镜', exact: true }).click(); const frame = (await state(page)).selection[0];
  await page.getByRole('tab', { name: '素材库', exact: true }).click(); await page.getByRole('button', { name: '放入选中分镜', exact: true }).click(); const bound = await state(page), image = imageOf(bound); expect(image.parentId).toBe(frame); expect(image.crop).toBeNull();
  await page.evaluate(async frame => (await import('/src/' + 'state/sessionStore.ts')).sessionStore.setState({ selection: [frame] }), frame);
  await expect(page.getByRole('button', { name: '编辑裁剪', exact: true })).toHaveCount(0);
  const viewport = (await page.locator('.canvas-viewport').boundingBox())!; await page.mouse.dblclick(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await expect(page.getByRole('region', { name: '编辑图片与遮罩', exact: true })).toBeVisible(); expect((await state(page)).project).toEqual(bound.project); expect((await state(page)).past).toBe(bound.past);
  await page.getByRole('button', { name: '取消遮罩编辑', exact: true }).click();
  await expect(page.getByLabel('对象X', { exact: true })).toBeEnabled(); await expect(page.getByLabel('对象旋转', { exact: true })).toBeEnabled();
  await page.getByLabel('对象旋转', { exact: true }).fill('20'); await page.getByLabel('对象旋转', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '解除分镜关联', exact: true }).click(); expect(imageOf(await state(page)).parentId).toBeNull();
  await page.getByLabel('素材关联分镜').selectOption(frame); expect(imageOf(await state(page)).parentId).toBe(frame);
  await (await menuCommand(page, '撤销')).click(); expect(imageOf(await state(page)).parentId).toBeNull();
});

test('mask edit previews are cancellable, complete once, and toggling/removing reveals the original without changing source hashes', async ({ page }) => {
  const before = await placed(page), image = imageOf(before); await page.getByRole('button', { name: '椭圆遮罩', exact: true }).click(); await expect(page.getByRole('region', { name: '编辑图片与遮罩', exact: true })).toBeVisible();
  await page.getByLabel('遮罩编辑X', { exact: true }).fill('24'); await page.getByLabel('遮罩编辑X', { exact: true }).press('Enter'); expect((await state(page)).project).toEqual(before.project);
  await page.getByRole('button', { name: '取消遮罩编辑', exact: true }).click(); expect((await state(page)).project).toEqual(before.project);
  await page.getByRole('button', { name: '椭圆遮罩', exact: true }).click(); await page.getByRole('button', { name: '完成遮罩', exact: true }).click(); const masked = await state(page); expect(masked.past).toBe(before.past + 1); expect(imageOf(masked).mask?.shape).toBe('ellipse');
  await page.getByLabel('启用素材遮罩', { exact: true }).uncheck(); expect(imageOf(await state(page)).mask?.enabled).toBe(false); await page.getByLabel('启用素材遮罩', { exact: true }).check();
  await page.getByRole('button', { name: '移除遮罩', exact: true }).click(); expect(imageOf(await state(page)).mask).toBeUndefined(); expect((await state(page)).project.assets[image.assetId]).toEqual(before.project.assets[image.assetId]);
  await (await menuCommand(page, '撤销')).click(); expect(imageOf(await state(page)).mask?.enabled).toBe(true);
});

test('polygon handles really edit the contour and insertion/deletion are preview-only', async ({ page }) => {
  const before = await placed(page); await page.getByRole('button', { name: '多边形遮罩', exact: true }).click(); await ready(page);
  const handle = page.getByLabel('遮罩顶点1', { exact: true }), b = (await handle.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 25, b.y + b.height / 2 + 15, { steps: 12 }); await page.mouse.up();
  expect((await state(page)).past).toBe(before.past); await page.getByRole('button', { name: '插入遮罩顶点', exact: true }).click(); await expect(page.locator('.mask-vertex')).toHaveCount(5); await page.getByRole('button', { name: '删除遮罩顶点', exact: true }).click(); await expect(page.locator('.mask-vertex')).toHaveCount(4);
  await page.screenshot({ path: `output/playwright/material-mask-${test.info().project.name || 'edge'}.png` });
  await page.getByRole('button', { name: '完成遮罩', exact: true }).click(); const after = await state(page); expect(imageOf(after).mask?.geometry[0]).not.toEqual({ x: 51.2, y: 38.4 });
  await (await menuCommand(page, '撤销')).click(); expect((await state(page)).project).toEqual(before.project);
});

test('asset dragging outside the paper or cancelling with Escape never places or enters history', async ({ page }) => {
  await setup(page); await importOne(page); const tile = page.getByRole('button', { name: '放置素材 拼贴.png', exact: true }), source = (await tile.boundingBox())!, before = await state(page);
  for (const escape of [false, true]) {
    await page.mouse.move(source.x + 20, source.y + 20); await page.mouse.down(); await page.mouse.move(source.x + 35, source.y + 35); await expect(page.getByTestId('asset-drag-preview')).toBeVisible();
    if (escape) await page.keyboard.press('Escape'); await page.mouse.up(); await expect(page.getByTestId('asset-drag-preview')).toBeHidden();
    expect((await state(page)).project).toEqual(before.project); expect((await state(page)).past).toBe(before.past);
  }
  await tile.click(); expect((await state(page)).past).toBe(before.past + 1);
});

test('cancelled pointer capture restores its start draft; Escape removes the uncommitted mask', async ({ page }) => {
  const before = await placed(page); await page.getByRole('button', { name: '矩形遮罩', exact: true }).click(); await ready(page);
  const b = (await page.getByLabel('调整手柄0', { exact: true }).boundingBox())!;
  await page.evaluate(() => document.querySelector('.mask-editor-surface')!.addEventListener('pointerdown', event => { (window as any).__maskPointerId = (event as PointerEvent).pointerId; }, { once: true }));
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 50, b.y + b.height / 2 + 30); await ready(page);
  await page.evaluate(() => document.querySelector('.mask-editor-surface')!.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: (window as any).__maskPointerId }))); await page.mouse.up();
  const matrix = await page.evaluate(async () => { const { currentMaskEdit } = await import('/src/' + 'images/maskController.ts'); return currentMaskEdit().preview.layers[currentMaskEdit().imageId].mask.matrix; }); expect(matrix).toEqual([1, 0, 0, 1, 0, 0]);
  await page.keyboard.press('Escape'); await expect(page.getByLabel('素材遮罩调整画布')).toHaveCount(0); expect((await state(page)).project).toEqual(before.project); expect((await state(page)).past).toBe(before.past);
});

test('a delayed native library decode is discarded and its bitmap closed when another project replaces the import target', async ({ page }) => {
  await setup(page); const file = await payload(page);
  await page.evaluate(() => { const native = window.createImageBitmap.bind(window), gate: any = { entered: false, bitmap: null, native }; const held = new Promise<void>(resolve => { gate.resume = resolve; }); let armed = true; window.createImageBitmap = (async (...args: any[]) => { if (!armed) return (native as any)(...args); armed = false; gate.entered = true; await held; const bitmap = await (native as any)(...args); gate.bitmap = bitmap; return bitmap; }) as typeof createImageBitmap; (window as any).__libraryDecode = gate; });
  await page.getByLabel('导入素材文件').setInputFiles(file); await expect.poll(() => page.evaluate(() => (window as any).__libraryDecode.entered)).toBe(true);
  await page.evaluate(async () => { const { createProject } = await import('/src/' + 'domain/factories.ts'), { replaceDocument } = await import('/src/' + 'history/commandBus.ts'); const result = replaceDocument(createProject({ background: false })); if (!result.ok) throw Error(JSON.stringify(result)); const gate = (window as any).__libraryDecode; window.createImageBitmap = gate.native; gate.resume(); });
  await expect(page.locator('.notice-stack')).toContainText('导入已取消'); await expect.poll(() => page.evaluate(() => (window as any).__libraryDecode.bitmap?.width)).toBe(0); const after = await state(page); expect(after.project.libraryAssetIds).toEqual([]); expect(Object.keys(after.project.assets)).toHaveLength(0); expect(after.past).toBe(0);
});

test('an unused library image survives actual local recovery and resource collection, then places with a live native bitmap', async ({ page }) => {
  test.setTimeout(45_000); await setup(page); await importOne(page); const before = await state(page);
  const key = await page.evaluate(async id => { const { listRecoveries } = await import('/src/' + 'storage/recovery.ts'); for (let i = 0; i < 70; i++) { const result = await listRecoveries(); if (result.ok) { const entry = result.value.find((value: any) => value.key.startsWith(`${id}:`)); if (entry) return entry.key; } await new Promise(resolve => setTimeout(resolve, 100)); } throw Error('No recovery written'); }, before.project.id);
  const stored = await page.evaluate(async key => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('comia-recovery-v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { const row: any = await new Promise((resolve, reject) => { const request = db.transaction('drafts').objectStore('drafts').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      return Promise.all(row.blobs.map(async (item: any) => { const bytes = item.blob ? await item.blob.arrayBuffer() : item.bytes; return { hash: item.hash, actual: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join(''), bytes: bytes.byteLength, representation: item.blob ? 'Blob' : 'Uint8Array' }; }));
    } finally { db.close(); }
  }, key);
  expect(stored.length).toBeGreaterThan(0); for (const item of stored) { expect(item.actual).toBe(item.hash); expect(item.bytes).toBeGreaterThan(0); }
  await mkdir('output/audit/materials-recovery', { recursive: true }); await writeFile(`output/audit/materials-recovery/${test.info().project.name || 'edge'}.json`, JSON.stringify(stored, null, 2));
  expect(await page.evaluate(async key => { const { replaceDocument } = await import('/src/' + 'history/commandBus.ts'), { createProject } = await import('/src/' + 'domain/factories.ts'), { restoreRecovery } = await import('/src/' + 'storage/recovery.ts'), { collectUnreferencedBlobs } = await import('/src/' + 'storage/blobRepository.ts'); replaceDocument(createProject({ background: false })); await collectUnreferencedBlobs(); const result = await restoreRecovery(key); if (!result.ok) throw Error(JSON.stringify(result)); return true; }, key)).toBe(true);
  expect((await state(page)).project).toEqual(before.project); await expect(page.locator('.asset-card')).toHaveCount(1); await page.getByRole('button', { name: '放置素材 拼贴.png', exact: true }).click(); expect(Object.values((await state(page)).project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground')).toHaveLength(1);
  const placed = await state(page);
  const corrupted = await page.evaluate(async key => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('comia-recovery-v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { const row: any = await new Promise((resolve, reject) => { const request = db.transaction('drafts').objectStore('drafts').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const item = row.blobs[0], bytes = new Uint8Array(item.blob ? await item.blob.arrayBuffer() : item.bytes); bytes[0] ^= 255; row.blobs[0] = { hash: item.hash, bytes, mimeType: item.blob?.type ?? item.mimeType };
      await new Promise<void>((resolve, reject) => { const tx = db.transaction('drafts', 'readwrite'); tx.objectStore('drafts').put(row); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    } finally { db.close(); }
    const { restoreRecovery } = await import('/src/' + 'storage/recovery.ts'); return restoreRecovery(key);
  }, key);
  expect(corrupted).toMatchObject({ ok: false, problems: [{ code: 'recovery/hash' }] }); expect((await state(page)).project).toEqual(placed.project); expect((await state(page)).past).toBe(placed.past);
});

test('unlinked image adjustments keep the mask in place, and mask resize/rotation do not alter the original image matrix', async ({ page }) => {
  const initial = await placed(page); await page.getByRole('button', { name: '矩形遮罩', exact: true }).click(); await page.getByLabel('编辑时链接遮罩').uncheck();
  await page.getByRole('button', { name: '调整图片', exact: true }).click(); await page.getByLabel('遮罩编辑X', { exact: true }).fill('190'); await page.getByLabel('遮罩编辑X', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '调整遮罩', exact: true }).click(); await page.getByLabel('遮罩编辑宽', { exact: true }).fill('210'); await page.getByLabel('遮罩编辑宽', { exact: true }).press('Enter'); await page.getByLabel('遮罩编辑角度', { exact: true }).fill('13'); await page.getByLabel('遮罩编辑角度', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '完成遮罩', exact: true }).click(); const after = await state(page), image = imageOf(after); expect(image.matrix[4]).toBe(190); expect(image.mask?.linked).toBe(false); expect(image.mask?.matrix[0]).not.toBe(1); expect(after.project.assets[image.assetId]).toEqual(initial.project.assets[image.assetId]);
  await (await menuCommand(page, '撤销')).click(); expect((await state(page)).project).toEqual(initial.project);
});

test('unused library originals and edited masks survive a real encoded-file reopen and remain placeable', async ({ page }) => {
  await placed(page); await page.getByLabel('导入素材文件').setInputFiles(await payload(page, '未放置.png', '#00ff00')); await expect(page.locator('.asset-card')).toHaveCount(2); await page.getByRole('button', { name: '椭圆遮罩', exact: true }).click(); await page.getByRole('button', { name: '完成遮罩', exact: true }).click(); const before = await state(page);
  const result = await page.evaluate(async () => { const { getProject } = await import('/src/' + 'state/documentStore.ts'), { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts'), { encodeProject, decodeProject } = await import('/src/' + 'storage/codec.ts'), { installLoadedProject } = await import('/src/' + 'storage/fileSave.ts'); const p = getProject(), saved = await encodeProject(p, runtimeStore.getState().blobs); if (!saved.ok) throw Error(JSON.stringify(saved)); const file = new File([saved.value], 'test.Comia.json'); const decoded = await decodeProject(file); if (!decoded.ok) throw Error(JSON.stringify(decoded)); const installed = await installLoadedProject(decoded.value.project, decoded.value.blobs); return installed.ok; });
  expect(result).toBe(true); expect((await state(page)).project).toEqual(before.project); await page.getByRole('button', { name: '放置素材 未放置.png', exact: true }).click(); expect(Object.values((await state(page)).project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter(l => l.type === 'image')).toHaveLength(2);
});

test('a true ellipse clips source corners in exported PNG and hit testing; PDF uses the same full-resolution masked scene', async ({ page }) => {
  const initial = await placed(page); await page.getByRole('button', { name: '椭圆遮罩', exact: true }).click(); await page.getByRole('button', { name: '完成遮罩', exact: true }).click(); await ready(page);
  const hits = await page.evaluate(async () => { const { getProject } = await import('/src/' + 'state/documentStore.ts'), { hitLayer } = await import('/src/' + 'render/drawScene.ts'); const p = getProject(); return [hitLayer(p, p.pageOrder[0], { x: 200, y: 150 }), hitLayer(p, p.pageOrder[0], { x: 280, y: 240 })]; }); expect(hits).toEqual([null, imageOf(initial).id]);
  const pngPending = page.waitForEvent('download'); await (await menuCommand(page, 'PNG')).click(); const png = await readFile((await (await pngPending).path())!);
  const pixels = await page.evaluate(async base64 => { const data = Uint8Array.from(atob(base64), c => c.charCodeAt(0)), bitmap = await createImageBitmap(new Blob([data], { type: 'image/png' })), c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height; const ctx = c.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); const sample = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data]; const result = { width: c.width, height: c.height, corner: sample(200, 150), red: sample(280, 240), blue: sample(360, 240) }; bitmap.close(); c.width = c.height = 0; return result; }, png.toString('base64'));
  expect(pixels).toEqual({ width: 640, height: 480, corner: [255, 255, 255, 255], red: [255, 0, 0, 255], blue: [0, 0, 255, 255] });
  const pdfPending = page.waitForEvent('download'); await (await menuCommand(page, 'PDF')).click(); const pdf = await readFile((await (await pdfPending).path())!); expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  await mkdir('output/audit/materials-export', { recursive: true }); const browser = test.info().project.name || 'edge'; await writeFile(`output/audit/materials-export/${browser}.png`, png); await writeFile(`output/audit/materials-export/${browser}.pdf`, pdf);
});

test('160 trusted mask moves keep the main layer still and history unchanged until completion', async ({ page }) => {
  test.setTimeout(120_000); const initial = await placed(page); await page.getByRole('button', { name: '矩形遮罩', exact: true }).click(); await ready(page); await parkFloatingControls(page);
  const surface = (await page.getByLabel('素材遮罩调整画布').boundingBox())!, x = surface.x + surface.width / 2, y = surface.y + surface.height / 3;
  await page.mouse.move(x, y); await page.mouse.down(); const baseline = await state(page), latencies: number[] = [];
  for (let index = 0; index < 160; index++) { const start = Date.now(); await page.mouse.move(x + 12 * Math.sin(index / 8), y + 8 * Math.cos(index / 8)); await ready(page); latencies.push(Date.now() - start); }
  const during = await state(page); expect(during.stats.mainDraws - baseline.stats.mainDraws).toBe(0); expect(during.stats.gestureDraws - baseline.stats.gestureDraws).toBeGreaterThanOrEqual(100); expect(during.project).toEqual(initial.project); expect(during.past).toBe(initial.past);
  await page.mouse.up(); await page.getByRole('button', { name: '完成遮罩', exact: true }).click(); expect((await state(page)).past).toBe(initial.past + 1);
  await mkdir('output/audit/materials-performance', { recursive: true }); await writeFile(`output/audit/materials-performance/${test.info().project.name || 'edge'}.json`, JSON.stringify({ browser: test.info().project.name || 'edge', viewport: { width: 1440, height: 900 }, scene: '640x480 page, one 512x384 image, rectangle mask, 160 native mouse moves', samples: latencies, mainDraws: 0, gestureDraws: during.stats.gestureDraws - baseline.stats.gestureDraws, metric: 'automation move plus font-ready and two-rAF roundtrip; includes IPC, not scanout or pure render latency' }, null, 2));
});

test('a free image mask preview respects a sheared ancestor frame, rounded corners and the upper sibling paint order', async ({ page }) => {
  await setup(page); await importOne(page);
  const imageId = await page.evaluate(async () => {
    const { getProject } = await import('/src/' + 'state/documentStore.ts'), { createLayer } = await import('/src/' + 'domain/factories.ts'), { execute } = await import('/src/' + 'history/commandBus.ts');
    const { placeLibraryAsset } = await import('/src/' + 'assets/libraryCommands.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const p = getProject(), pageId = p.pageOrder[0], group = createLayer('group', pageId), frame = createLayer('panel', pageId), upper = createLayer('panel', pageId);
    group.matrix = [1, .2, .15, 1, 80, 60]; group.children = [frame.id]; frame.parentId = group.id; frame.geometry = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 160 }, { x: 0, y: 160 }]; frame.style.borderRadius = 30; frame.style.borderWidth = 0;
    upper.geometry = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }]; upper.matrix = [1, 0, 0, 1, 160, 130]; upper.style.fill = '#00FF00FF'; upper.style.borderWidth = 0;
    const fixture = execute({ label: '真实遮罩夹具', context: { pageId, selection: [] }, mutate(draft: Project) { for (const layer of [group, frame, upper]) draft.layers[layer.id] = layer; draft.pages[pageId].roots = [...draft.pages[pageId].roots.filter((id: string) => draft.layers[id]?.type === 'pageBackground'), ...([group.id, upper.id])]; } }); if (!fixture.ok) throw Error(JSON.stringify(fixture));
    const placed = placeLibraryAsset(p.libraryAssetIds![0], pageId, { x: 190, y: 160 }, frame.id); if (!placed.ok) throw Error(JSON.stringify(placed));
    const adjusted = execute({ label: '调整源图', context: { pageId, selection: [placed.value] }, afterSelection: [placed.value], mutate(draft: Project) { draft.layers[placed.value].matrix = [1, 0, 0, 1, -100, -80]; } }); if (!adjusted.ok) throw Error(JSON.stringify(adjusted));
    sessionStore.setState({ scopeId: null, viewportByPage: { [pageId]: { zoom: 1, pan: { x: 10, y: 10 } } } }); return placed.value;
  });
  const before = await state(page); expect(before.selection).toEqual([imageId]); await page.getByRole('button', { name: '矩形遮罩', exact: true }).click(); await ready(page); const baseline = await state(page);
  for (const [label, value] of [['X', '150'], ['Y', '130'], ['宽', '80'], ['高', '80']]) { const input = page.getByLabel(`遮罩编辑${label}`, { exact: true }); await input.fill(value); await input.press('Enter'); }
  await ready(page);
  const pixels = async (index: number) => page.locator('.canvas-viewport').evaluate((root, index) => {
    const canvas = root.querySelectorAll('canvas')[index], ratio = canvas.width / root.clientWidth, context = canvas.getContext('2d')!;
    const sample = (x: number, y: number) => [...context.getImageData(Math.round((x + 10) * ratio), Math.round((y + 10) * ratio), 1, 1).data];
    return { upper: sample(170, 140), inside: sample(216.5, 194), ghost: sample(130.5, 138), outside: sample(70.5, 126), roundedCorner: sample(85.75, 66) };
  }, index);
  const preview = await pixels(1); expect(preview.upper).toEqual([0, 255, 0, 255]); expect(preview.inside).toEqual([255, 0, 0, 255]); expect(preview.outside).toEqual([255, 255, 255, 255]); expect(preview.roundedCorner).toEqual([255, 255, 255, 255]); expect(preview.ghost[0]).toBe(255); expect(preview.ghost[1]).toBeGreaterThan(150); expect(preview.ghost[1]).toBeLessThan(230);
  const during = await state(page); expect(during.project).toEqual(before.project); expect(during.past).toBe(before.past); expect(during.stats.mainDraws).toBe(baseline.stats.mainDraws);
  await page.getByRole('button', { name: '完成遮罩', exact: true }).click(); await ready(page); const normal = await pixels(0); expect(normal).toEqual({ ...preview, ghost: [255, 255, 255, 255] }); expect((await state(page)).past).toBe(before.past + 1);
  await (await menuCommand(page, '撤销')).click(); expect((await state(page)).project).toEqual(before.project);
});
