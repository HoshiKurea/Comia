import { menuCommand } from './menuHelpers';
import { expect, test } from '@playwright/test';

test('1024 and 1440 desktop sizes show empty paper and both sidebars with canvas confined to its container', async ({ page }) => {
  await page.goto('/');
  for (const viewport of [{ width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport); await expect(page.locator('.left-panel')).toBeVisible(); await expect(page.locator('.right-panel')).toBeVisible(); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(0);
    const left = (await page.locator('.left-panel').boundingBox())!, canvas = (await page.locator('.canvas-viewport').boundingBox())!, right = (await page.locator('.right-panel').boundingBox())!;
    expect(canvas.x).toBeGreaterThanOrEqual(left.x + left.width - 1); expect(canvas.x + canvas.width).toBeLessThanOrEqual(right.x + 1); expect(canvas.width).toBeGreaterThan(200);
    await expect(page.locator('.canvas-viewport canvas').first()).toBeVisible(); await expect((await menuCommand(page, '保存'))).toBeVisible(); await expect((await menuCommand(page, 'PNG'))).toBeVisible();
  }
});

test('narrow editor keeps component, page and layer operations reachable through keyboard-safe drawers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 }); await page.goto('/');
  await expect(page.locator('.left-panel')).toBeHidden(); await expect(page.locator('.right-panel')).toBeHidden();
  const library = page.getByRole('button', { name: '组件 / 页面', exact: true }); await library.click();
  const left = page.getByRole('dialog', { name: '组件与页面' }); await expect(left).toBeVisible();
  await page.keyboard.press('Shift+Tab'); expect(await left.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape'); await expect(left).toHaveCount(0); await expect(library).toBeFocused();
  await library.click(); await left.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); await expect(page.locator('.left-panel')).toBeHidden();
  const layers = page.getByRole('button', { name: '属性 / 图层', exact: true }); await layers.click();
  const right = page.getByRole('dialog', { name: '属性与图层' }); await expect(right.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  await right.getByLabel('对象宽').fill('320'); await right.getByLabel('对象宽').press('Enter'); await expect(right.getByLabel('对象宽')).toHaveValue('320');
  await right.getByRole('button', { name: '关闭属性与图层', exact: true }).click(); await expect(layers).toBeFocused();
  await library.click(); await left.getByRole('button', { name: '页面', exact: true }).click(); await left.getByRole('button', { name: '+ 新建漫画页', exact: true }).click(); await expect(left.locator('.page-item')).toHaveCount(2);
  await page.keyboard.press('Escape'); await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.left-panel')).toBeVisible(); await expect(page.locator('.right-panel')).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
  const dimensions = await page.locator('.canvas-viewport').boundingBox(); expect(dimensions!.width).toBeGreaterThan(300); expect(dimensions!.height).toBeGreaterThan(300);
});

test('bubble RGBA input preserves alpha, rejects invalid colors and Escape restores applied fill', async ({ page }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '对白气泡' }).click();
  const color = page.getByLabel('气泡填充色RGBA'); await color.fill('#ff000080'); await color.press('Enter'); await expect(color).toHaveValue('#FF000080');
  await color.fill('#00FF00FF'); await color.press('Escape'); await expect(color).toHaveValue('#FF000080');
  await color.fill('#GGFFFFFF'); await color.press('Enter'); await expect(color).toHaveValue('#FF000080'); await expect(page.getByText('颜色须为#RRGGBBAA，包含透明度', { exact: true })).toBeVisible();
  await page.getByLabel('对象圆角').fill('4096'); await page.getByLabel('对象圆角').press('Enter'); await expect(page.getByLabel('对象圆角')).toHaveValue('4096');
  const state = await page.evaluate(async () => { const { getDocument } = await import('/src/' + 'state/documentStore.ts'); const doc = getDocument(); return { past: doc.history.past.length, layers: Object.values(doc.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground') }; });
  expect(state.past).toBe(3); expect(state.layers).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'bubble', style: expect.objectContaining({ fill: '#FF000080', radius: 4096 }) })]));
  await (await menuCommand(page, '撤销')).click(); await expect(page.getByLabel('对象圆角')).toHaveValue('24'); await (await menuCommand(page, '撤销')).click(); await expect(color).toHaveValue('#FFFFFFFF');
});

test('dialog opened inside a narrow drawer remains above the drawer and Escape returns to its trigger', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 }); await page.goto('/');
  await page.getByRole('button', { name: '属性 / 图层', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '属性与图层' }), trigger = drawer.getByRole('button', { name: '清空历史', exact: true }); await trigger.click();
  const dialog = page.getByRole('dialog', { name: '清空编辑历史' }); await expect(dialog).toBeVisible();
  const cancel = dialog.getByRole('button', { name: '取消', exact: true }); await expect(cancel).toBeFocused();
  expect(await cancel.evaluate((node) => { const box = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })).toBe(true);
  await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: '确认清空' })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(drawer).toBeVisible(); await expect(trigger).toBeFocused();
  await page.keyboard.press('Escape'); await expect(drawer).toHaveCount(0); await expect(page.getByRole('button', { name: '属性 / 图层', exact: true })).toBeFocused();
});
