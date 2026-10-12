import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { menuCommand, setMenuTheme, waitForProjectIO } from './menuHelpers';
async function state(page: Page) { return page.evaluate(async () => { const { getDocument } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { workspaceStore } = await import('/src/' + 'projects/workspaces.ts'); return { doc: getDocument(), session: sessionStore.getState(), workspaces: workspaceStore.getState() }; }); }
async function newProject(page: Page, name: string, transparent = false) {
  await (await menuCommand(page, '新建项目…')).click(); const dialog = page.getByRole('dialog', { name: '新建项目', exact: true });
  await dialog.getByLabel('新项目名称', { exact: true }).fill(name); await dialog.getByLabel('新项目纸张', { exact: true }).selectOption('custom');
  await dialog.getByLabel('新项目宽度', { exact: true }).fill('640'); await dialog.getByLabel('新项目高度', { exact: true }).fill('480'); await dialog.getByLabel('新项目 DPI', { exact: true }).fill('72');
  if (transparent) await dialog.getByLabel('新项目背景', { exact: true }).selectOption('transparent');
  await dialog.getByRole('button', { name: '创建项目', exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab', { name, exact: false })).toHaveAttribute('aria-selected', 'true');
}
test('six top categories expose real commands and new projects retain separate page/history/session states', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('menubar').getByRole('menuitem')).toHaveText(['文件', '编辑', '图层', '页面', '视图','窗口']); await expect(page.locator('.topbar button')).toHaveCount(6);
  await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); await page.getByRole('tab', { name: '页面', exact: true }).click(); await page.getByRole('button', { name: '+ 新建漫画页', exact: true }).click();
  await page.evaluate(async () => { const { sessionStore } = await import('/src/' + 'state/sessionStore.ts'); const id = sessionStore.getState().activePageId; sessionStore.setState({ viewportByPage: { [id]: { pan: { x: 123, y: 81 }, zoom: 1.25 } } }); }); const a = await state(page);
  await newProject(page, '漫画 B'); await page.getByRole('tab', { name: '组件库', exact: true }).click(); await page.locator('.library-item').filter({ hasText: '椭圆分镜' }).click(); const b = await state(page);
  expect(b.doc.project.id).not.toBe(a.doc.project.id); expect(b.doc.project.pageOrder).toHaveLength(1); expect(b.doc.history.past).toHaveLength(1);
  await page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab', { name: /未命名项目/ }).click(); await expect.poll(async () => (await state(page)).doc.project.id).toBe(a.doc.project.id); const restored = await state(page);
  expect(restored.doc.project).toEqual(a.doc.project); expect(restored.doc.history).toEqual(a.doc.history); expect(restored.session.activePageId).toBe(a.session.activePageId); expect(restored.session.viewportByPage).toEqual(a.session.viewportByPage);
  await (await menuCommand(page, '撤销')).click(); expect((await state(page)).doc.project.pageOrder).toHaveLength(1);
  await page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab', { name: /漫画 B/ }).click(); await expect.poll(async () => (await state(page)).doc.project.id).toBe(b.doc.project.id); expect((await state(page)).doc.project).toEqual(b.doc.project);
});
test('new project validation preserves final custom axes, orientation and editable transparent background', async ({ page }) => {
  await page.goto('/'); const original = await state(page); await (await menuCommand(page, '新建项目…')).click(); const d = page.getByRole('dialog', { name: '新建项目', exact: true });
  await d.getByLabel('新项目名称', { exact: true }).fill(' '); await expect(d.getByRole('button', { name: '创建项目', exact: true })).toBeDisabled(); await expect(d.getByRole('alert')).toContainText('名称');
  await d.getByLabel('新项目名称', { exact: true }).fill('透明漫画'); await d.getByLabel('新项目纸张', { exact: true }).selectOption('custom');
  await d.getByLabel('新项目宽度', { exact: true }).fill('113'); await d.getByLabel('新项目高度', { exact: true }).fill('79'); await d.getByLabel('新项目方向', { exact: true }).selectOption('landscape'); await d.getByLabel('新项目 DPI', { exact: true }).fill('72'); await d.getByLabel('新项目背景', { exact: true }).selectOption('transparent');
  await d.getByRole('button', { name: '创建项目', exact: true }).click(); await expect(d).toHaveCount(0); const s = await state(page), p = s.doc.project.pages[s.doc.project.pageOrder[0]];
  expect(p).toMatchObject({ width: 113, height: 79, dpi: 72 }); expect(Object.values(s.doc.project.layers)[0]).toMatchObject({ type: 'pageBackground', fill: '#FFFFFF00' }); expect(s.doc.savedStateId).toBeNull(); expect(s.workspaces.tabs).toHaveLength(original.workspaces.tabs.length + 1);
});
test('close cancellation and discard affect only one comic; closing the last tab creates an editable blank', async ({ page }) => {
  await page.goto('/'); await newProject(page, '关闭目标'); await page.getByRole('button', { name: '关闭项目 关闭目标', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '关闭项目', exact: true });
  await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: '取消', exact: true }).click(); await expect(page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab', { name: /关闭目标/ })).toBeVisible();
  await page.getByRole('button', { name: '关闭项目 关闭目标', exact: true }).click(); await dialog.getByRole('button', { name: '放弃更改并关闭', exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab')).toHaveCount(1);
  await page.getByRole('button', { name: '关闭项目 未命名项目', exact: true }).click(); await expect(page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab')).toHaveCount(1); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
});
test('file save bindings remain independent across tabs and the first save of a new comic selects a new file', async ({ page }) => {
  await page.goto('/'); await page.evaluate(() => { const w = window as any; w.__writes = []; w.__picks = 0; w.showSaveFilePicker = async () => { const index = ++w.__picks; return { name: `${index}.json`, createWritable: async () => ({ write: async (blob: Blob) => { const parsed = JSON.parse(await blob.text()); w.__writes.push({ index, project: parsed.project }); }, close: async () => {}, abort: async () => {} }) }; }; });
  await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); const a = (await state(page)).doc.project.id; await (await menuCommand(page, '保存')).click(); await expect.poll(() => page.evaluate(() => (window as any).__writes.length)).toBe(1);
  await newProject(page, '保存 B'); const b = (await state(page)).doc.project.id; await (await menuCommand(page, '保存')).click(); await expect.poll(() => page.evaluate(() => (window as any).__writes.length)).toBe(2);
  await page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab', { name: /未命名项目/ }).click(); await expect.poll(async () => (await state(page)).doc.project.id).toBe(a); await (await menuCommand(page, '保存')).click(); await expect.poll(() => page.evaluate(() => (window as any).__writes.length)).toBe(3);
  const writes = await page.evaluate(() => ({ picks: (window as any).__picks, rows: (window as any).__writes.map((r: any) => [r.index, r.project.id]) })); expect(writes).toEqual({ picks: 2, rows: [[1, a], [2, b], [1, a]] });
});
test('open adds a tab, duplicate project IDs get independent recovery slots, and invalid reads leave all comics intact', async ({ page }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); const first = await state(page), payload = Buffer.from(JSON.stringify({ format: 'Comia', version: 1, project: first.doc.project, blobs: [] }));
  for (let i = 0; i < 2; i++) { const chosen = page.waitForEvent('filechooser'); await (await menuCommand(page, '打开')).click(); await (await chosen).setFiles({ name: 'comic.Comia.json', mimeType: 'application/json', buffer: payload }); await expect(page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab')).toHaveCount(i + 2); }
  const before = await state(page); const chooser = page.waitForEvent('filechooser'); await (await menuCommand(page, '打开')).click(); await (await chooser).setFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}') }); await expect(page.locator('.notice.error')).toContainText(/无效|格式/); expect((await state(page)).workspaces.tabs).toHaveLength(3); expect((await state(page)).doc.project).toEqual(before.doc.project);
  await page.locator('.library-item').filter({ hasText: '椭圆分镜' }).click(); await page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab').first().click(); await expect.poll(() => page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab').first().getAttribute('aria-selected')).toBe('true');
  const keys = await page.evaluate(async () => { const { listRecoveries } = await import('/src/' + 'storage/recovery.ts'); const r = await listRecoveries(); if (!r.ok) throw Error('recovery'); return r.value.map((v: { key: string }) => v.key); }); expect(new Set(keys).size).toBeGreaterThanOrEqual(2);
});
test('keyboard menus preserve canvas coordinates and restore persistent focus after modal cancellation', async ({ page }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); const before = (await state(page)).doc;
  const file = page.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true }); await file.focus(); await page.keyboard.press('ArrowDown'); await expect(page.getByRole('menuitem', { name: '新建项目…', exact: true })).toBeFocused(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '新建项目', exact: true })).toBeVisible(); await page.keyboard.press('Escape'); await expect(file).toBeFocused();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Home'); await page.keyboard.press('Escape');
  expect((await state(page)).doc.project).toEqual(before.project); expect((await state(page)).doc.history).toEqual(before.history);
});
test('menu navigation uses a separate DOM overlay without history or main canvas redraw', async ({ page }, info) => {
  await page.goto('/'); await page.evaluate(async () => { const { resolveFont } = await import('/src/' + 'text/fonts.ts'); await resolveFont('Noto Sans CJK SC'); await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  // WebKit can publish the initial fitted viewport after fonts.ready; it is
  // initialization, so wait for the actual store and stable draws before measuring.
  await expect.poll(async () => { const session = (await state(page)).session; return Boolean(session.viewportByPage[session.activePageId]); }).toBe(true);
  await page.evaluate(async () => {
    const { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts');
    let previous = -1, stable = 0;
    for (let frame = 0; frame < 120 && stable < 4; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const draws = runtimeStore.getState().renderStats.mainDraws;
      stable = draws === previous ? stable + 1 : 0; previous = draws;
    }
    if (stable < 4) throw Error('初始主画布在120帧内未稳定');
  });
  const before = await state(page), stats = await page.evaluate(async () => { const { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts'); return runtimeStore.getState().renderStats.mainDraws; });
  const file = page.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true }); for (let i = 0; i < 100; i++) await file.click();
  const after = await state(page); expect(after.doc).toEqual(before.doc); expect(after.session.viewportByPage).toEqual(before.session.viewportByPage);
  expect(await page.evaluate(async () => { const { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts'); return runtimeStore.getState().renderStats.mainDraws; })).toBe(stats);
  await mkdir('output/audit/project-menu-performance', { recursive: true }); await writeFile(`output/audit/project-menu-performance/${info.project.name || 'edge'}.json`, JSON.stringify({ ...await page.evaluate(() => ({ userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio })), actions: 100, mainDrawsDuringNavigation: 0, documentUnchanged: true, historyUnchanged: true }, null, 2));
});

test('copied image survives closing its source tab and remains editable and saveable in the destination', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined })); await page.goto('/'); await newProject(page, '图片 A');
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 128; c.height = 96; const ctx = c.getContext('2d')!; ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 128, 96); return c.toDataURL().split(',')[1]; });
  await page.getByRole('tab', { name: '素材库', exact: true }).click(); await page.getByLabel('导入素材文件').setInputFiles({ name: '原图.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }); await page.getByRole('button', { name: '放置素材 原图.png', exact: true }).click(); await (await menuCommand(page, '复制')).click();
  await newProject(page, '图片 B'); await page.getByRole('button', { name: '关闭项目 图片 A', exact: true }).click(); await page.getByRole('button', { name: '放弃更改并关闭', exact: true }).click(); await waitForProjectIO(page);
  await (await menuCommand(page, '粘贴')).click(); const pasted = await state(page); expect(Object.values(pasted.doc.project.layers).filter((l: any) => l.type === 'image')).toHaveLength(1);
  const exported = page.waitForEvent('download'); await (await menuCommand(page, 'PNG')).click(); const path = (await (await exported).path())!; expect((await readFile(path)).length).toBeGreaterThan(100);
  const pixels = await page.evaluate(async () => { const { getProject } = await import('/src/' + 'state/documentStore.ts'), { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts'), { exportPng } = await import('/src/' + 'export/exportFiles.ts'); const p = getProject(), r = await exportPng(p, p.pageOrder[0], runtimeStore.getState().images); if (!r.ok) throw Error('export'); const image = await createImageBitmap(r.value), c = document.createElement('canvas'); c.width = image.width; c.height = image.height; const ctx = c.getContext('2d')!; ctx.drawImage(image, 0, 0); const pixel = [...ctx.getImageData(336, 256, 1, 1).data]; image.close(); return pixel; }); expect(pixels).toEqual([255, 0, 0, 255]);
  const saved = page.waitForEvent('download'); await (await menuCommand(page, '保存')).click(); const bytes = await readFile((await (await saved).path())!); expect(JSON.parse(bytes.toString()).blobs.length).toBeGreaterThan(0);
  await page.locator('input[type=file][accept*=json]').setInputFiles({ name: 'B.Comia.json', mimeType: 'application/json', buffer: bytes }); await waitForProjectIO(page); expect((await state(page)).doc.project).toEqual(pasted.doc.project);
});

test('close save cancellation and download confirmation preserve the comic until explicit completion', async ({ page }) => {
  await page.goto('/'); await newProject(page, '待保存漫画'); await page.evaluate(() => { (window as any).showSaveFilePicker = async () => { throw new DOMException('cancel', 'AbortError'); }; });
  await page.getByRole('button', { name: '关闭项目 待保存漫画', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '关闭项目', exact: true }); await dialog.getByRole('button', { name: '先保存再关闭', exact: true }).click(); await expect(page.locator('.notice.error')).toContainText('取消保存'); await expect(dialog).toBeVisible(); await expect(page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab')).toHaveCount(2);
  await page.evaluate(() => { (window as any).showSaveFilePicker = undefined; }); const download = page.waitForEvent('download'); await dialog.getByRole('button', { name: '先保存再关闭', exact: true }).click(); await download; await expect(dialog.getByRole('button', { name: '确认文件已保存并关闭', exact: true })).toBeVisible(); await expect(page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab')).toHaveCount(2);
  await dialog.getByRole('button', { name: '确认文件已保存并关闭', exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab')).toHaveCount(1);
});

test('inactive unsaved work blocks save-and-upgrade and browser departure even when the current comic is saved', async ({ page }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); await newProject(page, '已保存漫画');
  await page.evaluate(async () => { const { offlineStore } = await import('/src/' + 'offline/register.ts'); (window as any).showSaveFilePicker = async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => {}, abort: async () => {} }) }); offlineStore.setState({ waiting: true }); });
  await page.getByRole('button', { name: '重启使用新版本', exact: true }).click(); await page.getByRole('button', { name: '保存后重启', exact: true }).click(); await expect(page.locator('.notice.error')).toContainText('其他漫画项目仍未保存'); await expect(page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab')).toHaveCount(2);
  expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
  await page.getByRole('dialog', { name: '重启使用新版本', exact: true }).getByRole('button', { name: '取消', exact: true }).click(); await expect(page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab')).toHaveCount(2);
});

test('unavailable directory capability remains disabled with a readable single-file alternative', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }));
  await page.goto('/'); await menuCommand(page, '打开目录');
  const item = page.getByRole('menuitem', { name: '打开项目目录…', exact: true });
  await item.focus(); await page.keyboard.press('Enter');
  await expect(item).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('menu', { name: '文件菜单', exact: true })).toContainText('此浏览器不支持目录读写，请使用单文件保存或打开');
  await expect(page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab')).toHaveCount(1);
});
test('narrow and dark menu/submenu layouts stay inside the viewport with real project tabs', async ({ page }, info) => {
  await page.goto('/'); await newProject(page, '超长漫画项目名称'.repeat(8)); await mkdir('output/playwright', { recursive: true }); await page.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true }).click(); await page.screenshot({ path: `output/playwright/project-menus-desktop-${info.project.name || 'edge'}.png` }); await page.keyboard.press('Escape'); await setMenuTheme(page, 'dark'); await page.setViewportSize({ width: 390, height: 700 });
  await page.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true }).click(); await page.getByRole('menuitem', { name: '导出倍率', exact: true }).click();
  for (const menu of await page.getByRole('menu').all()) { const box = (await menu.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(8); expect(box.x + box.width).toBeLessThanOrEqual(382.1); expect(box.y + box.height).toBeLessThanOrEqual(692.1); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390); await mkdir('output/playwright', { recursive: true }); await page.screenshot({ path: `output/playwright/project-menus-narrow-${info.project.name || 'edge'}.png` });
});
