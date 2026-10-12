import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { menuCommand, waitForProjectIO } from '../e2e/menuHelpers';
import { parkFloatingControls } from '../e2e/floatingHelpers';

test('draws, saves, opens and exports schema7 speed brush vectors in an actually offline production shell', async ({ page, context }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/'); await expect(page.locator('.canvas-viewport')).toBeVisible();
  await expect.poll(() => page.evaluate(async () => { await navigator.serviceWorker.ready; return Boolean(navigator.serviceWorker.controller); })).toBe(true);
  await context.setOffline(true); await page.reload(); await expect(page.locator('.canvas-viewport')).toBeVisible();
  await page.getByRole('button', { name: '速度线笔刷', exact: true }).click(); await parkFloatingControls(page); const box = (await page.locator('.canvas-viewport').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 - 65, box.y + box.height * .4); await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + box.width / 2 - 65 + i * 6, box.y + box.height * .4 + 25 * Math.sin(i / 9));
  await page.mouse.up(); await page.getByRole('button', { name: '返回选择', exact: true }).click(); await expect(page.locator('.layer-name').filter({ hasText: /^速度线笔触$/ })).toHaveCount(1);
  const save = page.waitForEvent('download'); await (await menuCommand(page,'保存')).click(); const file = await save, path = (await file.path())!; const data = JSON.parse(await readFile(path,'utf8'));
  expect(data.project.schemaVersion).toBe(8); expect(data.project.settings.readingDirection).toBe('rtl'); const brush: any = Object.values(data.project.layers).find((l: any) => l.type === 'decoration' && l.spec.kind === 'speed-brush'); expect(brush.spec.ribbons.length).toBeGreaterThan(1);
  await page.reload(); await expect(page.locator('.canvas-viewport')).toBeVisible(); await page.getByLabel('打开项目文件', { exact: true }).setInputFiles(path); await waitForProjectIO(page); await expect(page.locator('.layer-name').filter({ hasText: /^速度线笔触$/ })).toHaveCount(1);
  const nextSave = page.waitForEvent('download'); await (await menuCommand(page,'保存')).click(); const next = await nextSave; expect(JSON.parse(await readFile((await next.path())!,'utf8')).project).toEqual(data.project);
  const image = page.waitForEvent('download'); await (await menuCommand(page,'PNG')).click(); const png = await image; expect((await readFile((await png.path())!)).byteLength).toBeGreaterThan(1000);
});
