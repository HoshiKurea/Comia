import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import type { Project } from '../../src/domain/types';
import type { SessionStoreState } from '../../src/state/sessionStore';
import { menuCommand, setMenuScale } from './menuHelpers';
async function state(page: Page): Promise<{project:Project;past:number;stateId:string;session:SessionStoreState}> { return page.evaluate(async () => { const { getDocument } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts'); const d = getDocument(); return { project: d.project, past: d.history.past.length, stateId: d.history.stateId, session: sessionStore.getState() }; }); }
async function guides(page: Page) { if (await page.getByRole('menu').count()) await page.keyboard.press('Escape'); await page.getByRole('menubar').getByRole('menuitem', { name: '视图', exact: true }).click(); await page.getByRole('menuitemcheckbox', { name: '显示漫画定位线', exact: true }).click(); }
async function openPageSetup(page: Page) { await page.getByRole('tab', { name: '页面', exact: true }).click(); await page.getByRole('button', { name: '漫画原稿与定位线设置…', exact: true }).click(); return page.getByRole('dialog', { name: '漫画原稿设置', exact: true }); }
test.beforeEach(async ({ page }) => { await page.goto('/'); await expect(page.getByRole('menubar')).toBeVisible(); await mkdir('output/manuscript', { recursive: true }); });

test('default comic setup creates 8 independent A4/600/B5 manuscript pages and adding a page inherits the active settings', async ({ page }) => {
  const initial = await state(page); expect(initial.project.pages[initial.project.pageOrder[0]]).toMatchObject({ width: 4961, height: 7016, dpi: 600, manuscript: { bleedMm: 5 } });
  await (await menuCommand(page, '新建项目…')).click(); const dialog = page.getByRole('dialog', { name: '新建项目', exact: true });
  await expect(dialog.getByLabel('新项目页数')).toHaveValue('8'); await expect(dialog.getByLabel('新项目 DPI')).toHaveValue('600');
  await expect(dialog.getByLabel('新项目纸张',{exact:true})).toHaveValue('comic-B5'); await expect(dialog.getByLabel('新项目单位')).toHaveValue('mm'); await expect(dialog.getByText(/装订|成品/)).toHaveCount(0);
  await expect(dialog.getByLabel('新项目宽度')).toHaveValue('210'); await expect(dialog.getByLabel('新项目定位框宽度')).toHaveValue('182');
  await expect(dialog.getByRole('img', { name: '漫画原稿定位线预览' })).toBeVisible(); await dialog.getByLabel('新项目名称').fill('日式漫画');
  await dialog.screenshot({ path: `output/manuscript/new-comic-dpr${test.info().project.name.endsWith('1') ? 1 : 2}.png` });
  await dialog.getByRole('button', { name: '创建项目', exact: true }).click(); await expect(dialog).toHaveCount(0);
  let s = await state(page); expect(s.project.pageOrder).toHaveLength(8); expect(s.past).toBe(0); expect(s.project.settings.readingDirection).toBe('rtl');
  expect(Object.values(s.project.layers).map(l => l.type)).toEqual(Array(8).fill('pageBackground'));
  expect(s.project.pageOrder.map(id => s.project.pages[id].name)).toEqual(Array.from({ length: 8 }, (_, i) => `第${i + 1}页`));
  await page.getByRole('tab', { name: '页面', exact: true }).click(); await expect(page.locator('.page-guide-overlay')).toHaveCount(8);
  await expect(page.locator('.page-thumbnail img')).toHaveCount(8, { timeout: 30000 });
  await page.screenshot({ path: `output/manuscript/editor-dpr${test.info().project.name.endsWith('1') ? 1 : 2}.png` });
  await page.getByRole('button', { name: '+ 新建漫画页', exact: true }).click(); s = await state(page); expect(s.project.pageOrder).toHaveLength(9); expect(s.past).toBe(1);
  expect(s.project.pages[s.session.activePageId].manuscript).toEqual(s.project.pages[s.project.pageOrder[0]].manuscript);
  await (await menuCommand(page, '撤销')).click(); expect((await state(page)).project.pageOrder).toHaveLength(8);
  await (await menuCommand(page, '重做')).click(); expect((await state(page)).project.pageOrder).toHaveLength(9);
  await expect(page.locator('.page-thumbnail img')).toHaveCount(9, { timeout: 30000 });
});

test('canvas guides toggle on their independent layer with zero content redraws/history and follow zoom and pan', async ({ page }) => {
  await expect(page.locator('.konvajs-content canvas')).toHaveCount(4); await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const before = await state(page); await page.evaluate(async () => (await import('/src/' + 'state/runtimeStore.ts')).resetRenderStats());
  const visiblePixels = await page.locator('.konvajs-content canvas').nth(3).evaluate((c: HTMLCanvasElement) => [...c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data].filter((v, i) => i % 4 === 3 && v).length);
  expect(visiblePixels).toBeGreaterThan(500); await guides(page); await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const stats = await page.evaluate(async () => (await import('/src/' + 'state/runtimeStore.ts')).runtimeStore.getState().renderStats); expect(stats.mainDraws).toBe(0); expect(stats.overlayDraws).toBeGreaterThan(0);
  const hiddenPixels = await page.locator('.konvajs-content canvas').nth(3).evaluate((c: HTMLCanvasElement) => [...c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data].filter((v, i) => i % 4 === 3 && v).length);
  expect(hiddenPixels).toBe(0); expect((await state(page)).project).toEqual(before.project); expect((await state(page)).stateId).toBe(before.stateId);
  await guides(page); await page.evaluate(async () => { const s = await import('/src/' + 'state/sessionStore.ts'); s.setViewport(s.sessionStore.getState().activePageId, { zoom: .1, pan: { x: 55, y: 22 } }); });
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const pixel = await page.evaluate(async () => { const s = await import('/src/' + 'state/sessionStore.ts'), d = await import('/src/' + 'state/documentStore.ts'), m = await import('/src/' + 'pages/manuscript.ts'); const id = s.sessionStore.getState().activePageId, p = d.getProject().pages[id], g = m.manuscriptGeometry(p, p.manuscript!), vp = s.getViewport(id)!; const canvas = document.querySelectorAll<HTMLCanvasElement>('.konvajs-content canvas')[3], ctx = canvas.getContext('2d')!, k = devicePixelRatio; let alpha = 0; const x = (vp.pan.x + g.trim.x * vp.zoom) * k, y = (vp.pan.y + (g.trim.y + g.trim.height / 2) * vp.zoom) * k; for (let dx = -2; dx <= 2; dx++) alpha = Math.max(alpha, ctx.getImageData(Math.round(x + dx), Math.round(y), 1, 1).data[3]); return alpha; }); expect(pixel).toBeGreaterThan(0);
});

test('page dialog validates frame bounds, cancels without edits, and commits offsets/safety in one reversible change', async ({ page }) => {
  const before = await state(page); let dialog = await openPageSetup(page);
  await dialog.getByLabel('页面横向偏移').fill('100'); await expect(dialog.getByRole('button', { name: '应用原稿设置' })).toBeDisabled(); await expect(dialog.getByRole('alert')).toContainText('基本框');
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); expect((await state(page)).project).toEqual(before.project);
  dialog = await openPageSetup(page); await dialog.getByLabel('页面横向偏移').fill('3'); await dialog.getByLabel('安全线', { exact: true }).check(); await dialog.getByLabel('页面安全边距').fill('7'); await dialog.getByRole('button', { name: '应用原稿设置' }).click();
  let s = await state(page); expect(s.past).toBe(before.past + 1); expect(s.project.pages[s.session.activePageId].manuscript).toMatchObject({ basicFrame: { offsetXMm: 3 }, safeInsetMm: 7 });
  await (await menuCommand(page, '撤销')).click(); expect((await state(page)).project).toEqual(before.project); await (await menuCommand(page, '重做')).click();
  dialog = await openPageSetup(page); await page.evaluate(async () => { const s = (await import('/src/' + 'state/sessionStore.ts')).sessionStore.getState(), commands = await import('/src/' + 'pages/commands.ts'), d = (await import('/src/' + 'state/documentStore.ts')).getProject().pages[s.activePageId]; commands.configurePage(d.id, d, { ...d.manuscript!, bleedMm: 3 }); });
  await dialog.getByRole('button', { name: '应用原稿设置' }).click(); await expect(dialog.getByRole('alert')).toContainText('已改变');
});

test('actual project download/reopen retains physical guides; PNG/PDF artwork never contains guide strokes', async ({ page }) => {
  await page.evaluate(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
  const save = page.waitForEvent('download'); await (await menuCommand(page, '保存')).click(); const saved = await save, path = await saved.path(); if (!path) throw Error('download');
  const bytes = await readFile(path), envelope = JSON.parse(bytes.toString()); expect(envelope.project.schemaVersion).toBe(14);
  const before = await state(page); const decoded = await page.evaluate(async json => { const codec = await import('/src/' + 'storage/codec.ts'), r = await codec.decodeProject(new File([json], 'comic.Comia.json', { type: 'application/json' })); if (!r.ok) throw Error(JSON.stringify(r)); const replace = (await import('/src/' + 'history/commandBus.ts')).replaceDocument(r.value.project); if (!replace.ok) throw Error(JSON.stringify(replace)); return r.value.project; }, bytes.toString()); expect(decoded.pages).toEqual(before.project.pages);
  await setMenuScale(page, '.25'.replace(/^\./, '0.')); const pngEvent = page.waitForEvent('download'); await (await menuCommand(page, 'PNG')).click(); const png = await pngEvent; await png.saveAs(`output/manuscript/guide-free-dpr${test.info().project.name.endsWith('1') ? 1 : 2}.png`);
  const color = await page.evaluate(async () => { const d = (await import('/src/' + 'state/documentStore.ts')).getProject(), id = d.pageOrder[0], e = await import('/src/' + 'export/exportFiles.ts'); const r = await e.exportPng(d, id, new Map(), undefined, { scale: .25 }); if (!r.ok) throw Error(JSON.stringify(r)); const image = await createImageBitmap(r.value), c = document.createElement('canvas'); c.width = image.width; c.height = image.height; c.getContext('2d')!.drawImage(image, 0, 0); const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let nonWhite = 0; for (let i = 0; i < data.length; i += 4) if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255 || data[i + 3] !== 255) nonWhite++; image.close(); return { width: c.width, height: c.height, nonWhite }; }); expect(color).toEqual({ width: 1240, height: 1754, nonWhite: 0 });
  const pdfEvent = page.waitForEvent('download'); await (await menuCommand(page, 'PDF')).click(); const pdf = await pdfEvent; await pdf.saveAs(`output/manuscript/guide-free-dpr${test.info().project.name.endsWith('1') ? 1 : 2}.pdf`);
});

test('millimetre/pixel custom pages, orientation, page counts and transparent paper remain editable with guards', async ({ page }) => {
  await (await menuCommand(page, '新建项目…')).click(); const dialog = page.getByRole('dialog', { name: '新建项目', exact: true });
  await dialog.getByLabel('新项目漫画原稿设置').uncheck(); await dialog.getByLabel('新项目纸张', { exact: true }).selectOption('custom'); await dialog.getByLabel('新项目单位').selectOption('px');
  await dialog.getByLabel('新项目宽度').fill('113'); await dialog.getByLabel('新项目高度').fill('79'); await dialog.getByLabel('新项目方向').selectOption('landscape');
  await dialog.getByLabel('新项目页数').fill('0'); await expect(dialog.getByRole('button', { name: '创建项目' })).toBeDisabled(); await dialog.getByLabel('新项目页数').fill('1');
  await dialog.getByLabel('新项目背景').selectOption('transparent'); await dialog.getByRole('button', { name: '创建项目' }).click(); const s = await state(page); const p = s.project.pages[s.session.activePageId]; expect(p).toMatchObject({ width: 113, height: 79 }); expect(p.manuscript).toBeUndefined(); expect(s.project.layers[p.roots[0]]).toMatchObject({ fill: '#FFFFFF00' });
});

test('page sidebar defaults to B5 manuscript and mm; reopening retains the exact nominal manuscript dimensions', async ({ page }) => {
  await page.getByRole('tab', { name: '页面', exact: true }).click(); const before = await state(page);
  await expect(page.locator('.page-item').first()).toContainText('B5 漫画原稿 · 210 × 297 mm');
  await expect(page.getByLabel('页面单位')).toHaveValue('mm'); await expect(page.getByLabel('页面宽度')).toHaveValue('210'); await expect(page.getByLabel('页面高度')).toHaveValue('297');
  await page.getByLabel('页面单位').selectOption('px'); await expect(page.getByLabel('页面宽度')).toHaveValue('4961'); await expect(page.locator('.page-item').first()).toContainText('4961 × 7016 px');
  await page.getByLabel('页面单位').selectOption('mm'); await expect(page.getByLabel('页面宽度')).toHaveValue('210'); expect((await state(page)).project).toEqual(before.project); expect((await state(page)).stateId).toBe(before.stateId);
  const dialog = await openPageSetup(page); await expect(dialog.getByLabel('页面单位')).toHaveValue('mm'); await expect(dialog.getByLabel('页面宽度')).toHaveValue('210'); await expect(dialog.getByLabel('页面高度')).toHaveValue('297');
  await expect(dialog.getByLabel('页面定位框预设')).toHaveValue('B5-JIS'); await expect(dialog.getByLabel('页面定位框宽度')).toHaveValue('182'); await expect(dialog.getByLabel('页面定位框高度')).toHaveValue('257');
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); expect((await state(page)).project).toEqual(before.project);
  await page.getByLabel('页面宽度').fill('220'); page.once('dialog', dialog=>dialog.accept()); await page.getByRole('button',{name:'应用页面尺寸',exact:true}).click();
  const changed=await state(page); expect(changed.project.pages[changed.session.activePageId].width).toBe(5197); expect(changed.project.pages[changed.session.activePageId].manuscript).toEqual(before.project.pages[before.session.activePageId].manuscript); expect(changed.past).toBe(before.past+1);
  await (await menuCommand(page,'撤销')).click(); expect((await state(page)).project).toEqual(before.project); await expect(page.getByLabel('页面宽度')).toHaveValue('210');
});

test('positioning guide render cost is bounded on the active A4 manuscript without painting main content', async ({ page }) => {
  const timing = await page.evaluate(async () => { const m = await import('/src/' + 'pages/guideOverlay.ts'), d = (await import('/src/' + 'state/documentStore.ts')).getProject(), p = d.pages[d.pageOrder[0]], canvas = document.createElement('canvas'); canvas.width = 800 * devicePixelRatio; canvas.height = 750 * devicePixelRatio; const ctx = canvas.getContext('2d')!, samples: number[] = []; ctx.scale(devicePixelRatio, devicePixelRatio); for (let i = 0; i < 130; i++) { const start = performance.now(); ctx.clearRect(0, 0, 800, 750); m.drawManuscriptGuides(ctx, p, { zoom: .08 + i / 10000, pan: { x: 50 + i / 10, y: 25 } }); if (i >= 10) samples.push(performance.now() - start); } return { samples, dpr: devicePixelRatio, ua: navigator.userAgent }; });
  const sorted = timing.samples.slice().sort((a, b) => a - b), p95 = sorted[Math.ceil(sorted.length * .95) - 1];
  await writeFile(`output/manuscript/guide-performance-dpr${timing.dpr}.json`, JSON.stringify({ ...timing, p95Ms: p95, scene: 'A4 4961x7016px 600dpi B5 trim, 5mm bleed, 149x219 basic; 800x750CSS editor overlay; 120 pan/zoom paints after10 warm; no artwork', measurement: 'synchronous JS and Canvas2D submissions, excludes GPU completion and browser IPC', device: { os: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0].model, memoryBytes: os.totalmem() } }, null, 2)); expect(timing.samples).toHaveLength(120); expect(p95).toBeLessThan(16.7);
});
