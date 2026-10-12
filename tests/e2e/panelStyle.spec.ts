import { menuCommand } from './menuHelpers';
import { test, expect, type Page } from '@playwright/test';
async function state(page: Page) { return page.evaluate(async () => { const source = (path: string) => performance.getEntriesByType('resource').find((entry) => entry.name.includes(`/src/${path}`))?.name ?? `/src/${path}`; const { getDocument } = await import(source('state/documentStore.ts')), { runtimeStore } = await import(source('state/runtimeStore.ts')); const doc = getDocument(); return { project: doc.project, past: doc.history.past.length, stats: runtimeStore.getState().renderStats }; }); }
test('mixed panel radii show a dash and one batch edit undoes to independent values', async ({ page }) => {
  await page.goto('/'); for (let i = 0; i < 2; i++) await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  await page.getByLabel('对象圆角', { exact: true }).fill('20'); await page.getByLabel('对象圆角', { exact: true }).press('Enter'); const before = await state(page);
  await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').first().click(); await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').last().click({ modifiers: ['Shift'] }); const radius = page.getByLabel('对象圆角', { exact: true }); await expect(radius).toHaveValue(''); await expect(radius).toHaveAttribute('placeholder', '—');
  await radius.fill('12'); await radius.press('Enter'); const after = await state(page); expect(after.past).toBe(before.past + 1); for (const layer of Object.values(after.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground') as any[]) expect(layer.style.borderRadius).toBe(12);
  await (await menuCommand(page, '撤销')).click(); expect((await state(page)).project).toEqual(before.project);
});
test('a range draft renders below an upper sibling with zero main redraw and commits only on release; Escape rolls back', async ({ page }) => {
  await page.goto('/'); for (let i = 0; i < 2; i++) await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  await page.getByLabel('填充色RGBA').fill('#0000FFFF'); await page.getByLabel('填充色RGBA').press('Enter'); await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').last().click(); await page.evaluate(async () => { await document.fonts.ready; }); await page.waitForTimeout(250);
  const slider = page.getByLabel('圆角滑块'); await slider.scrollIntoViewIfNeeded(); const before = await state(page), rect = await slider.boundingBox();
  await page.mouse.move(rect!.x + 3, rect!.y + rect!.height / 2); await page.mouse.down();
  for (let step = 1; step <= 20; step++) await page.mouse.move(rect!.x + rect!.width * step / 21, rect!.y + rect!.height / 2);
  await page.waitForTimeout(120); const draft = await state(page); expect(draft.project).toEqual(before.project); expect(draft.past).toBe(before.past); expect(draft.stats.mainDraws).toBe(before.stats.mainDraws); expect(draft.stats.gestureDraws).toBeGreaterThan(before.stats.gestureDraws);
  expect(await page.evaluate(() => { const root = document.querySelector('.canvas-viewport')!, canvas = root.querySelectorAll('canvas')[1]; const dpr = canvas.width / root.clientWidth; return [...canvas.getContext('2d')!.getImageData(Math.floor(root.clientWidth / 2 * dpr), Math.floor((root.clientHeight / 2 + 12) * dpr), 1, 1).data]; })).toEqual([0, 0, 255, 255]);
  await page.mouse.up(); expect((await state(page)).past).toBe(before.past + 1); await expect(page.getByText(/保留请求圆角/)).toBeVisible(); const committed = await state(page);
  await page.mouse.move(rect!.x + 5, rect!.y + rect!.height / 2); await page.mouse.down(); await page.mouse.move(rect!.x + rect!.width / 3, rect!.y + rect!.height / 2); await page.keyboard.press('Escape'); await page.mouse.up(); expect((await state(page)).project).toEqual(committed.project); expect((await state(page)).past).toBe(committed.past);
});
test('RGBA alpha zero remains selectable and invalid input is rejected with the requested value restored', async ({ page }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  const fill = page.getByLabel('填充色RGBA'); await fill.fill('#FF000000'); await fill.press('Enter'); await expect(fill).toHaveValue('#FF000000'); const before = await state(page);
  await fill.fill('#XYZXYZFF'); await fill.press('Enter'); await expect(page.getByText('颜色须为#RRGGBBAA，包含透明度')).toBeVisible(); await expect(fill).toHaveValue('#FF000000'); expect((await state(page)).project).toEqual(before.project);
  await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').click(); await expect(page.getByLabel('对象宽')).toHaveValue('600'); await page.locator('button[aria-label="锁定"]:not(.layer-row[data-layer-type="pageBackground"] button)').click(); await expect(fill).toBeDisabled();
});
