import { menuCommand, setMenuTheme } from './menuHelpers';
import { expect, test, type Page } from '@playwright/test';
import type { Project } from '../../src/domain/types';

async function state(page: Page): Promise<{ project: Project; past: number; future: number; selection: string[] }> {
  return page.evaluate(async () => {
    const { getDocument } = await import('/src/' + 'state/documentStore.ts');
    const { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const { project, history } = getDocument();
    return { project, past: history.past.length, future: history.future.length, selection: sessionStore.getState().selection };
  });
}

const groups = [
  ['分镜形状', ['矩形分镜', '圆角分镜', '椭圆分镜', '三角分镜', '菱形分镜', '梯形分镜', '平行四边形', '五边形分镜', '六边形分镜', '八边形分镜']],
  ['分格版式', ['上下二格', '左右二格', '三横条', '三竖条', '四横条', '四格', '六格竖版', '六格横版', '上大下二', '上二下大', '左大右二', '左二右大']],
  ['气泡', ['对白气泡', '方框气泡', '圆形气泡', '云朵气泡', '尖刺气泡', '柔和手绘气泡', '粗糙速写气泡', '不规则多边形气泡', '波浪紧张气泡']],
  ['气泡尾',['短直尾','细线尾','弯曲长尾','多泡内心尾','锯齿喊叫尾','平头低语尾']],
  ['文字与装饰', ['文字', '速度线笔刷', '集中线', '音效字','重击声效字','裂响声效字','静默声效字','弧形呼喊声效字']],
  ['分格工具', ['行列等分', '随机分格', '手绘分格', '多边形分格']],
] as const;

test('all components appear once in compact icon-only categories with meaningful accessible names', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.library-item')).toHaveCount(45);
  await expect(page.getByRole('region', { name: '情绪气泡', exact: true })).toHaveCount(0);
  for (const [category, names] of groups) {
    const region = page.getByRole('region', { name: category, exact: true });
    await expect(region.locator('.library-tile')).toHaveCount(names.length);
    for (const name of names) await expect(region.getByRole('button', { name, exact: true })).toBeVisible();
  }
  const geometry = await page.locator('.library-item').evaluateAll(nodes => nodes.map(node => {
    const b = node.getBoundingClientRect(), label = node.querySelector('.component-label')!.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height, labelWidth: label.width, labelHeight: label.height };
  }));
  expect(geometry[1].y).toBe(geometry[0].y); expect(geometry[1].x).toBeGreaterThan(geometry[0].x);
  expect(geometry.every(b => b.width >= 34 && b.width < 70 && b.height === 44 && b.labelWidth <= 1 && b.labelHeight <= 1)).toBe(true);
  await expect(page.locator('.item-arrow')).toHaveCount(0);
  expect((await state(page)).past).toBe(0);
  await page.screenshot({ path: `output/playwright/component-library-${test.info().project.name || 'edge'}.png` });
});

test('hover shows a larger preview in the activity panel; leaving and scrolling retain it, Escape clears without editing', async ({ page }) => {
  await page.goto('/'); const before = await state(page),tile=page.getByRole('button',{name:'八边形分镜',exact:true}),reference=page.getByRole('region',{name:'快捷键参考',exact:true});
  await tile.hover(); await expect(reference.locator('strong')).toHaveText('八边形分镜'); await expect(reference.locator('canvas')).toHaveAttribute('data-ready','true');
  const small=(await tile.locator('canvas').boundingBox())!,large=(await reference.locator('canvas').boundingBox())!;expect(large.width).toBeGreaterThan(small.width);expect(large.height).toBeGreaterThan(small.height);
  const dock=(await page.locator('[data-panel-group="pg-hints"]').boundingBox())!;expect(dock.x+dock.width).toBeLessThanOrEqual(1440);expect(dock.y).toBeGreaterThanOrEqual(0);await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.screenshot({path:`output/playwright/component-library-hover-${test.info().project.name||'edge'}.png`});await page.mouse.move(400,150);await expect(reference.locator('strong')).toHaveText('八边形分镜');
  await page.locator('.library').evaluate(node=>{node.scrollTop=100;});await expect(reference.locator('strong')).toHaveText('八边形分镜');await page.keyboard.press('Escape');await expect(reference).toContainText('悬停组件或素材');expect(await state(page)).toEqual(before);
});

test('keyboard users can collapse categories, read names on focus and place one selected component', async ({ page }) => {
  await page.goto('/'); const before = await state(page);
  const category = page.getByRole('button', { name: '分镜形状', exact: true });
  await category.focus(); await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: '矩形分镜', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: '上下二格', exact: true })).toBeVisible();
  expect(await state(page)).toEqual(before);
  await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
  const tile = page.getByRole('button', { name: '矩形分镜', exact: true }); await expect(tile).toBeFocused();
  await expect(page.getByRole('region',{name:'快捷键参考',exact:true}).locator('strong')).toHaveText('矩形分镜');
  await page.keyboard.press('Enter'); await expect(page.getByRole('tooltip')).toHaveCount(0);
  const after = await state(page); expect(after.past).toBe(before.past + 1); expect(after.selection).toHaveLength(1);
  const layer = after.project.layers[after.selection[0]], sheet = after.project.pages[layer.pageId];
  expect(layer.type).toBe('panel'); if (layer.type !== 'panel') throw Error('Expected panel');
  expect(layer.matrix[4] + (Math.min(...layer.geometry.map(p => p.x)) + Math.max(...layer.geometry.map(p => p.x))) / 2).toBe(sheet.width / 2);
  expect(layer.matrix[5] + (Math.min(...layer.geometry.map(p => p.y)) + Math.max(...layer.geometry.map(p => p.y))) / 2).toBe(sheet.height / 2);
  await (await menuCommand(page, '撤销')).click(); expect((await state(page)).project).toEqual(before.project);
});

test('moving from keyboard focus to another hovered component shows only the current preview', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '分镜形状', exact: true }).focus(); await page.keyboard.press('Tab');
  await expect(page.getByRole('region',{name:'快捷键参考',exact:true}).locator('strong')).toHaveText('矩形分镜');
  await page.getByRole('button', { name: '八边形分镜', exact: true }).hover();
  await expect(page.getByRole('region',{name:'快捷键参考',exact:true}).locator('strong')).toHaveText('八边形分镜'); await expect(page.getByRole('region',{name:'快捷键参考',exact:true})).toHaveCount(1);
});

test('dragging an icon dismisses the hover name and keeps the translucent outside-canvas preview', async ({ page }) => {
  await page.goto('/'); const before = await state(page);
  const tile = page.getByRole('button', { name: '矩形分镜', exact: true }); await tile.hover(); await expect(page.getByRole('region',{name:'快捷键参考',exact:true}).locator('strong')).toHaveText('矩形分镜');
  const source = (await tile.boundingBox())!, target = (await page.locator('.canvas-viewport').boundingBox())!;
  await page.mouse.down(); await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.mouse.move(source.x + source.width / 2 + 16, source.y + 25, { steps: 5 });
  const ghost = page.getByTestId('component-drag-preview'); await expect(ghost).toBeVisible();
  const opacity = await ghost.evaluate(node => Number(getComputedStyle(node).opacity)); expect(opacity).toBeGreaterThan(0); expect(opacity).toBeLessThan(1);
  expect(await state(page)).toEqual(before);
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 }); await page.mouse.up();
  await expect(ghost).toBeHidden(); const after = await state(page); expect(after.past).toBe(before.past + 1); expect(after.selection).toHaveLength(1);
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
});

test('user templates enter their own category, show full long names and retain deploy/delete/undo behavior', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '矩形分镜', exact: true }).click();
  const name = '长名称'.repeat(25) + '😀';
  await page.getByRole('button',{name:'保存选区为预设…',exact:true}).click();const save=page.getByRole('dialog',{name:'保存组件预设',exact:true});await save.getByLabel('预设名称').fill(name);await save.getByRole('button',{name:'保存预设',exact:true}).click();
  const category = page.getByRole('region', { name: '自定义组件', exact: true });
  const tile = category.getByRole('button', { name: `自定义 · ${name}`, exact: true }); await tile.hover();
  await expect(page.getByRole('region',{name:'快捷键参考',exact:true}).locator('strong')).toHaveText(`自定义 · ${name}`);
  await page.getByRole('button',{name:'展开快捷键提示面板',exact:true}).click();const expanded=page.getByRole('dialog',{name:'快捷键提示展开窗',exact:true});await expect(expanded.locator('.element-hint-heading strong')).toHaveText(`自定义 · ${name}`);const bounds=(await expanded.boundingBox())!,viewport=page.viewportSize()!;expect(bounds.x+bounds.width).toBeLessThanOrEqual(viewport.width);expect(bounds.y+bounds.height).toBeLessThanOrEqual(viewport.height);await expanded.getByRole('button',{name:'收回快捷键提示展开窗'}).click();
  await tile.click(); const beforeDelete = await state(page); expect(beforeDelete.selection).toHaveLength(1); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
  await category.getByRole('button', { name: `删除预设 ${name}`, exact: true }).click(); await expect(tile).toHaveCount(0);expect(Object.keys((await state(page)).project.templates)).toHaveLength(0);
  expect((await state(page)).project.layers).toEqual(beforeDelete.project.layers);
  await (await menuCommand(page, '撤销')).click(); await expect(tile).toBeVisible();
  expect((await state(page)).project).toEqual(beforeDelete.project);
});

test('narrow drawers and dark theme keep classified icons usable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 }); await page.goto('/');
  await page.getByRole('button', { name: '组件 / 页面', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '组件与页面' }); await expect(drawer).toBeVisible();
  for (const [name] of groups) await expect(drawer.getByRole('button', { name, exact: true })).toBeVisible();
  expect(await drawer.locator('.library').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: `output/playwright/component-library-mobile-${test.info().project.name || 'edge'}.png` });
  await drawer.getByRole('button', { name: '对白气泡', exact: true }).click(); await expect(drawer).toHaveCount(0);
  expect((await state(page)).selection).toHaveLength(1);
  await page.setViewportSize({ width: 1440, height: 900 }); await setMenuTheme(page, 'dark');
  await page.getByRole('button', { name: '速度线笔刷', exact: true }).hover(); await expect(page.getByRole('region',{name:'快捷键参考',exact:true}).locator('strong')).toHaveText('速度线笔刷');
  await page.screenshot({ path: `output/playwright/component-library-dark-${test.info().project.name || 'edge'}.png` });
});
