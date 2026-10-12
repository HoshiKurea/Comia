import { menuCommand, setMenuTheme } from './menuHelpers';
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const source = (path: string) => performance.getEntriesByType('resource').find((entry) => entry.name.includes(`/src/${path}`))?.name ?? `/src/${path}`;
    const { documentStore } = await import(source('state/documentStore.ts')), { sessionStore } = await import(source('state/sessionStore.ts'));
    const { runtimeStore } = await import(source('state/runtimeStore.ts'));
    const state = documentStore.getState(), session = sessionStore.getState();
    return { project: state.project, history: state.history.past.length, viewport: session.viewportByPage[session.activePageId], render: runtimeStore.getState().renderStats };
  });
}
async function resetStats(page: Page) {
  await page.evaluate(async () => { const source = performance.getEntriesByType('resource').find((entry) => entry.name.includes('/src/state/runtimeStore.ts'))!.name; const { resetRenderStats } = await import(source); resetRenderStats(); });
}
test('dark theme changes chrome and persists but paper and exported PNG pixels stay unchanged', async ({ page }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  const initial = await snapshot(page);
  const pixel = async () => {
    const download = page.waitForEvent('download'); await (await menuCommand(page, 'PNG')).click();
    return (await readFile((await (await download).path())!)).toString('base64');
  };
  const before = await pixel(); await setMenuTheme(page, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect((await snapshot(page)).project).toEqual(initial.project); expect((await snapshot(page)).history).toBe(initial.history);
  expect(await pixel()).toBe(before);
  await page.screenshot({ path: 'output/playwright/comia-dark.png' });
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); expect(await page.evaluate(async () => { const { sessionStore } = await import('/src/' + 'state/sessionStore.ts'); return sessionStore.getState().theme; })).toBe('dark');
});
test('system theme follows media changes and denied localStorage does not prevent editing', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('disabled', 'SecurityError'); }; Storage.prototype.getItem = () => { throw new DOMException('disabled', 'SecurityError'); }; });
  await page.emulateMedia({ colorScheme: 'light' }); await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await setMenuTheme(page, 'light'); await expect(page.getByText('首选项已在本次会话应用；本机存储不可用，刷新后无法记忆', { exact: true })).toBeVisible();
  await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
});
test('direction key repeats preview without main redraw, commit on keyup and cancel on blur', async ({ page }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); await page.locator('.canvas-viewport').focus();
  const initial = await snapshot(page), id = Object.entries(initial.project.layers).filter(([, layer]) => (layer as { type: string }).type !== 'pageBackground').map(([id]) => id)[0];
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(100); await resetStats(page);
  for (let i = 0; i < 4; i++) await page.keyboard.down('ArrowRight');
  await page.keyboard.down('Shift'); await page.keyboard.down('ArrowRight'); await page.keyboard.up('Shift');
  await page.waitForTimeout(100); const during = await snapshot(page);
  expect(during.project).toEqual(initial.project); expect(during.history).toBe(initial.history); expect(during.render.mainDraws).toBe(0); expect(during.render.gestureDraws).toBeGreaterThan(0);
  await page.keyboard.up('ArrowRight'); const after = await snapshot(page);
  expect(after.project.layers[id].matrix[4] - initial.project.layers[id].matrix[4]).toBe(15); expect(after.history).toBe(initial.history + 1);
  await page.keyboard.press('Control+z'); expect((await snapshot(page)).project.layers[id].matrix).toEqual(initial.project.layers[id].matrix);
  await page.keyboard.down('ArrowDown'); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.keyboard.up('ArrowDown');
  expect((await snapshot(page)).project.layers[id].matrix).toEqual(initial.project.layers[id].matrix);
});
test('Space drag pans view with no document transaction or main redraw during preview', async ({ page }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); await page.locator('.canvas-viewport').focus();
  const initial = await snapshot(page), box = await page.locator('.canvas-viewport').boundingBox();
  const x = box!.x + box!.width / 2, y = box!.y + box!.height / 2;
  await page.keyboard.down('Space'); await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(100); await resetStats(page);
  await page.mouse.move(x + 80, y + 50, { steps: 20 }); await page.waitForTimeout(100);
  const during = await snapshot(page); expect(during.render.mainDraws).toBe(0); expect(during.render.gestureDraws).toBeGreaterThan(0);
  await page.mouse.up(); await page.keyboard.up('Space'); const after = await snapshot(page);
  expect(after.viewport.pan.x - initial.viewport.pan.x).toBeCloseTo(80, 6); expect(after.viewport.pan.y - initial.viewport.pan.y).toBeCloseTo(50, 6);
  expect(after.project).toEqual(initial.project); expect(after.history).toBe(initial.history);
});
test('Ctrl+D duplicates once and Ctrl+S works from native text input without browser save', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); await page.keyboard.press('Control+d');
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2); expect((await snapshot(page)).history).toBe(2);
  await page.keyboard.press('Control+z'); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  await page.locator('.library-item').filter({ hasText: /^文字/ }).click(); await page.getByRole('button', { name: '编辑文字', exact: true }).click();
  await page.getByLabel('编辑文字内容').fill('快捷保存的草稿');
  const download = page.waitForEvent('download'); await page.getByLabel('编辑文字内容').press('Control+s');
  const file = await download, data = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(Object.values(data.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((layer: any) => layer.type === 'text')).toMatchObject({ text: { content: '快捷保存的草稿' } });
  await expect(page.getByLabel('编辑文字内容')).toHaveCount(0);
});
test('modal traps focus, blocks Delete, Escape cancels and restores the opener', async ({ page }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  const before = (await snapshot(page)).project, open = page.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true });
  await (await menuCommand(page, '新建项目…')).click();
  const modal = page.getByRole('dialog', { name: '新建项目' }); await expect(modal).toBeVisible();
  const first = modal.getByLabel('新项目名称', { exact: true }), last = modal.getByRole('button', { name: '创建项目', exact: true });
  await expect(first).toBeFocused(); await page.keyboard.press('Shift+Tab'); await expect(last).toBeFocused();
  await page.keyboard.press('Tab'); await expect(first).toBeFocused();
  await page.keyboard.press('Delete'); expect((await snapshot(page)).project).toEqual(before);
  await page.keyboard.press('Escape'); await expect(modal).toHaveCount(0); await expect(open).toBeFocused();
});
