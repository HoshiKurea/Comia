import { test, expect, type Page } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { menuCommand, waitForProjectIO } from './menuHelpers';
import type { Project } from '../../src/domain/types';

async function comic(page: Page, name: string) {
  await (await menuCommand(page, '新建项目…')).click();
  const d = page.getByRole('dialog', { name: '新建项目', exact: true });
  await d.getByLabel('新项目名称').fill(name); await d.getByLabel('新项目纸张').selectOption('custom');
  await d.getByLabel('新项目宽度').fill('640'); await d.getByLabel('新项目高度').fill('480');
  await d.getByLabel('新项目 DPI').fill('72'); await d.getByLabel('新项目背景').selectOption('transparent');
  await d.getByRole('button', { name: '创建项目', exact: true }).click(); await expect(d).toHaveCount(0);
}
async function model(page: Page): Promise<Project> { return page.evaluate(async () => (await import('/src/' + 'state/documentStore.ts')).getProject()); }
async function stable(page: Page) { await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))); }

test('new comic natural binding, own mask, local breakout, workspace isolation and actual saved file reopening preserve content', async ({ page }) => {
  test.setTimeout(45_000);
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/'); await comic(page, '破格漫画 A');
  await page.getByRole('tab', { name: '组件库', exact: true }).click(); await page.getByRole('button', { name: '矩形分镜', exact: true }).click();
  const initial = await model(page), panel = Object.values(initial.layers).find(l => l.type === 'panel')!;
  expect(panel).toMatchObject({ editorNumber: 1, style: { fill: '#FFFFFF00' } });
  await page.getByRole('tab', { name: '素材库', exact: true }).click();
  const raw = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 320; c.height = 240; const x = c.getContext('2d')!; x.fillStyle = '#ff000080'; x.fillRect(0, 0, 320, 240); return c.toDataURL().split(',')[1]; });
  await page.getByLabel('导入素材文件').setInputFiles({ name: '自然人物.png', mimeType: 'image/png', buffer: Buffer.from(raw, 'base64') });
  const tile = page.getByRole('button', { name: '放置素材 自然人物.png', exact: true });
  const target = await page.evaluate(async () => { const { sessionStore } = await import('/src/' + 'state/sessionStore.ts'); const s = sessionStore.getState(), v = s.viewportByPage[s.activePageId], r = document.querySelector('.canvas-viewport')!.getBoundingClientRect(); return { x: r.x + v.pan.x + 320 * v.zoom, y: r.y + v.pan.y + 240 * v.zoom }; });
  await tile.hover(); await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 20 }); await stable(page);
  await page.screenshot({ path: `output/playwright/panel-binding-target-${test.info().project.name || 'edge'}.png` }); await page.mouse.up();
  const image = Object.values((await model(page)).layers).find(l => l.type === 'image')!;
  expect(image.parentId).toBe(panel.id); await page.keyboard.press('Control+Alt+Shift+b'); expect((await model(page)).layers[image.id].parentId).toBeNull();
  await page.keyboard.press('Control+Alt+b'); expect((await model(page)).layers[image.id].parentId).toBe(panel.id);
  await page.getByRole('button', { name: '椭圆遮罩', exact: true }).click(); await page.getByRole('button', { name: '完成遮罩', exact: true }).click();
  await page.getByRole('button', { name: '椭圆破格区域', exact: true }).click(); await page.getByLabel('局部破格X').fill('20'); await page.getByLabel('局部破格X').press('Enter');
  await page.screenshot({ path: `output/playwright/panel-binding-local-${test.info().project.name || 'edge'}.png` });
  await page.getByRole('button', { name: '完成局部破格', exact: true }).click();
  await page.getByRole('menubar').getByRole('menuitem', { name: '视图', exact: true }).click(); await page.getByRole('menuitemcheckbox', { name: '显示分镜序号', exact: true }).click();
  const saved = await model(page); expect(saved.layers[image.id]).toMatchObject({ mask: { shape: 'ellipse' }, panelClip: { mode: 'partial', region: { shape: 'ellipse', matrix: [1, 0, 0, 1, 20, 0] } } });
  await comic(page, '破格漫画 B'); await page.getByRole('tab', { name: '组件库', exact: true }).click(); await page.getByRole('button', { name: '矩形分镜', exact: true }).click();
  expect(Object.values((await model(page)).layers).find(l => l.type === 'panel')).toMatchObject({ editorNumber: 1 });
  expect(await page.evaluate(async () => (await import('/src/' + 'state/sessionStore.ts')).sessionStore.getState().showPanelNumbers)).toBe(true);
  await page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab', { name: /破格漫画 A/ }).click(); await expect.poll(async () => (await model(page)).id).toBe(saved.id); expect(await model(page)).toEqual(saved);
  expect(await page.evaluate(async () => (await import('/src/' + 'state/sessionStore.ts')).sessionStore.getState().showPanelNumbers)).toBe(false);
  const event = page.waitForEvent('download'); await (await menuCommand(page, '保存')).click(); const file = await event, bytes = await readFile((await file.path())!);
  expect(JSON.parse(bytes.toString()).project).toEqual(saved); await waitForProjectIO(page);
  await page.locator('input[type=file][accept=".json,.Comia.json"]').setInputFiles({ name: '破格漫画.Comia.json', mimeType: 'application/json', buffer: bytes }); await waitForProjectIO(page);
  expect(await model(page)).toEqual(saved);
  await mkdir('output/audit/panel-binding-exports', { recursive: true });
  for (const name of ['PNG', 'PDF']) {
    const pending = page.waitForEvent('download'); await (await menuCommand(page, name)).click(); const out = await pending, data = await readFile((await out.path())!);
    expect(data.length).toBeGreaterThan(1000); await writeFile(`output/audit/panel-binding-exports/${test.info().project.name || 'edge'}-workflow.${name.toLowerCase()}`, data);
  }
});
