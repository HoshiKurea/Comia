import { menuCommand } from './menuHelpers';
import { test, expect, type Page } from '@playwright/test';
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const source = (path: string) => performance.getEntriesByType('resource').find((entry) => entry.name.includes(`/src/${path}`))?.name ?? `/src/${path}`;
    const { documentStore } = await import(source('state/documentStore.ts')), { sessionStore } = await import(source('state/sessionStore.ts'));
    return { project: documentStore.getState().project, history: documentStore.getState().history.past.length, selection: sessionStore.getState().selection, expanded: sessionStore.getState().expanded };
  });
}
async function addPanels(page: Page, count = 3) { for (let index = 0; index < count; index++) await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); }
test('right-menu ordering moves every selected sibling in one stable block and one undo restores it', async ({ page }) => {
  await page.goto('/'); await addPanels(page, 4); const before = await snapshot(page), ids = before.project.pages[before.project.pageOrder[0]].roots.filter((id: string) => before.project.layers[id].type !== 'pageBackground');
  const row = (id: string) => page.locator(`.layer-row:not([data-layer-type="pageBackground"])[data-layer-id="${id}"]`); await row(ids[0]).locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').click(); await row(ids[2]).locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').click({ modifiers: ['Control'] });
  await row(ids[0]).click({ button: 'right' }); await page.getByRole('menuitem', { name: '置顶', exact: true }).click(); const after = await snapshot(page); expect(after.project.pages[before.project.pageOrder[0]].roots.filter((id: string) => after.project.layers[id].type !== 'pageBackground')).toEqual([ids[1], ids[3], ids[0], ids[2]]); expect(after.history).toBe(before.history + 1); expect(new Set(after.selection)).toEqual(new Set([ids[0], ids[2]]));
  await (await menuCommand(page, '撤销')).click(); expect((await snapshot(page)).project).toEqual(before.project);
});
test('Shift selects a contiguous visible range, Ctrl toggles, and selection reuses thumbnail pixels', async ({ page }) => {
  await page.goto('/'); await addPanels(page); const before = await snapshot(page), names = page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)');
  await names.first().click(); const paintings = await page.locator('.layer-thumbnail:not(.layer-row[data-layer-type="pageBackground"] .layer-thumbnail)').evaluateAll((items) => items.map((canvas) => (canvas as HTMLElement).dataset.paintCount));
  await names.last().click({ modifiers: ['Shift'] }); expect((await snapshot(page)).selection).toHaveLength(3);
  await names.nth(1).click({ modifiers: ['Control'] }); expect((await snapshot(page)).selection).toHaveLength(2);
  expect((await snapshot(page)).history).toBe(before.history); expect(await page.locator('.layer-thumbnail:not(.layer-row[data-layer-type="pageBackground"] .layer-thumbnail)').evaluateAll((items) => items.map((canvas) => (canvas as HTMLElement).dataset.paintCount))).toEqual(paintings);
});
test('batch labels undo once and name/color filtering only changes the list while retaining group context', async ({ page }) => {
  await page.goto('/'); await addPanels(page, 2); const names = page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)'); await names.first().click(); await names.last().click({ modifiers: ['Shift'] });
  const before = await snapshot(page); await page.locator('.layer-color:not(.layer-row[data-layer-type="pageBackground"] .layer-color)').first().selectOption('blue'); const colored = await snapshot(page); expect(colored.history).toBe(before.history + 1);
  for (const layer of Object.values(colored.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground') as any[]) expect(layer.colorLabel).toBe('blue');
  await (await menuCommand(page, '撤销')).click(); expect((await snapshot(page)).project).toEqual(before.project); await (await menuCommand(page, '重做')).click();
  await (await menuCommand(page, '编组')).click(); const grouped = await snapshot(page), child = Object.values(grouped.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((layer: any) => layer.type === 'panel') as any;
  await page.getByLabel('搜索图层').fill(`  ${child.name}  `); await page.getByLabel('按颜色筛选图层').selectOption('blue');
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"]).context-only')).toHaveCount(1);
  expect((await snapshot(page)).project).toEqual(grouped.project); expect((await snapshot(page)).history).toBe(grouped.history); expect((await snapshot(page)).expanded).toEqual(grouped.expanded);
  await page.getByLabel('按颜色筛选图层').selectOption('red'); await expect(page.getByText('没有匹配图层；可清除名称或颜色筛选')).toBeVisible();
  await page.getByLabel('搜索图层').fill(''); await page.getByLabel('按颜色筛选图层').selectOption(''); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
});
test('inline rename cancels Escape, retains invalid empty input and defers Enter during IME composition', async ({ page }) => {
  await page.goto('/'); await addPanels(page, 1); const before = await snapshot(page); await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').dblclick();
  const name = page.getByLabel('图层名称', { exact: true }); await name.fill('取消草稿'); await name.press('Escape'); expect((await snapshot(page)).project).toEqual(before.project); expect((await snapshot(page)).history).toBe(before.history);
  await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').dblclick(); await name.fill('  '); await name.press('Enter'); await expect(name).toBeVisible(); await expect(page.getByText('图层名称须为1～80个字符')).toBeVisible();
  await name.fill('你好😀'); await name.dispatchEvent('compositionstart'); await name.dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 }); expect((await snapshot(page)).history).toBe(before.history);
  await name.dispatchEvent('compositionend'); await name.press('Enter'); await expect(name).toHaveCount(0); await expect(page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)')).toHaveText('你好😀'); expect((await snapshot(page)).history).toBe(before.history + 1);
});
test('drag reorder uses visual order, right menu shares commands, and filtering disables reordering', async ({ page }) => {
  await page.goto('/'); await addPanels(page); const before = await snapshot(page), order = before.project.pages[before.project.pageOrder[0]].roots.filter((id: string) => before.project.layers[id].type !== 'pageBackground');
  const bottom = page.locator(`.layer-row:not([data-layer-type="pageBackground"])[data-layer-id="${order[0]}"]`), top = page.locator(`.layer-row:not([data-layer-type="pageBackground"])[data-layer-id="${order[2]}"]`);
  await bottom.dragTo(top, { targetPosition: { x: 100, y: 5 } }); expect((await snapshot(page)).project.pages[before.project.pageOrder[0]].roots.filter((id: string) => before.project.layers[id].type !== 'pageBackground')).toEqual([order[1], order[2], order[0]]);
  expect((await snapshot(page)).history).toBe(before.history + 1); await (await menuCommand(page, '撤销')).click(); expect((await snapshot(page)).project).toEqual(before.project);
  await top.click({ button: 'right' }); const menu = page.getByRole('menu', { name: '图层操作' }); await expect(menu).toBeVisible(); await menu.getByRole('menuitem', { name: '置底', exact: true }).click(); expect((await snapshot(page)).project.pages[before.project.pageOrder[0]].roots.filter((id: string) => before.project.layers[id].type !== 'pageBackground')).toEqual([order[2], order[0], order[1]]);
  await page.locator('.layer-row:not([data-layer-type="pageBackground"])').first().click({ button: 'right' }); await menu.getByRole('menuitem', { name: '复制', exact: true }).click(); await expect((await menuCommand(page, '粘贴'))).toBeEnabled();
  await page.getByLabel('搜索图层').fill('分镜'); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])').first()).toHaveAttribute('draggable', 'false'); await page.locator('.layer-row:not([data-layer-type="pageBackground"])').first().click({ button: 'right' }); await expect(menu.getByRole('menuitem', { name: '置顶', exact: true })).toBeDisabled(); await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0);
});
test('locked layers remain selectable for metadata and unlock while geometry controls are disabled', async ({ page }) => {
  await page.goto('/'); await addPanels(page, 1); await page.locator('button[aria-label="锁定"]:not(.layer-row[data-layer-type="pageBackground"] button)').click(); await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').click(); await expect(page.getByLabel('对象宽')).toBeDisabled();
  await page.locator('.layer-color:not(.layer-row[data-layer-type="pageBackground"] .layer-color)').selectOption('green'); await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').dblclick(); await page.getByLabel('图层名称', { exact: true }).fill('锁定但可命名'); await page.getByLabel('图层名称', { exact: true }).press('Enter');
  await expect(page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)')).toHaveText('锁定但可命名'); await page.locator('button[aria-label="解锁"]:not(.layer-row[data-layer-type="pageBackground"] button)').click(); await expect(page.getByLabel('对象宽')).toBeEnabled();
  await page.locator('button[aria-label="隐藏"]:not(.layer-row[data-layer-type="pageBackground"] button)').click(); await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').click(); await expect(page.getByLabel('对象宽')).toHaveValue('600'); const layer = Object.values((await snapshot(page)).project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground')[0] as any; expect(layer.visible).toBe(false); expect(layer.colorLabel).toBe('green');
});
test('120 layer rows virtualize while Shift range spans offscreen entries and thumbnail paints stay stable', async ({ page }) => {
  await page.goto('/'); await page.evaluate(async () => {
    const source = (path: string) => performance.getEntriesByType('resource').find((entry) => entry.name.includes(`/src/${path}`))?.name ?? `/src/${path}`;
    const { createLayer, createProject } = await import(source('domain/factories.ts')), { replaceDocument } = await import(source('history/commandBus.ts')); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const project = createProject(), pageId = project.pageOrder[0];
    for (let index = 0; index < 120; index++) { const layer = createLayer('panel', pageId, `对象${String(index).padStart(3, '0')}`); layer.matrix[4] = index * 20; project.layers[layer.id] = layer; project.pages[pageId].roots.push(layer.id); }
    const result = replaceDocument(numberFixture(project)); if (!result.ok) throw Error(JSON.stringify(result.problems));
  });
  await expect(page.locator('.layer-list')).toHaveAttribute('data-total-rows', '121'); expect(await page.locator('.layer-row:not([data-layer-type="pageBackground"])').count()).toBeLessThan(50);
  await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').first().click(); await page.locator('.layer-list').evaluate((list) => { list.scrollTop = list.scrollHeight; }); await expect(page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').last()).toHaveText('对象000');
  await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').last().click({ modifiers: ['Shift'] }); expect((await snapshot(page)).selection).toHaveLength(120); expect((await snapshot(page)).history).toBe(0); expect(await page.locator('.layer-row:not([data-layer-type="pageBackground"])').count()).toBeLessThan(50);
});

