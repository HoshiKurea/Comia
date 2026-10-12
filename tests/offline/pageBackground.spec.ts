import { menuCommand, waitForProjectIO } from '../e2e/menuHelpers';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('offline templates remain editable and saved backgrounds reopen while deleted backgrounds export transparent PNG', async ({ page, context }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }));
  await page.goto('/'); await expect.poll(() => page.evaluate(async () => { await navigator.serviceWorker.ready; return !!navigator.serviceWorker.controller; })).toBe(true);
  await context.setOffline(true); await page.reload(); await page.locator('.layer-name').filter({ hasText: /^页面背景$/ }).click();
  await page.getByRole('button', { name: '背景模板：水印纸', exact: true }).click(); await page.getByLabel('水印文字', { exact: true }).fill('离线原稿'); await page.getByLabel('水印文字', { exact: true }).press('Tab'); await page.getByLabel('页面边框', { exact: true }).selectOption('single'); await page.getByRole('button', { name: '完成背景编辑', exact: true }).click();
  const save = page.waitForEvent('download'); await (await menuCommand(page, '保存')).click(); const saved = await readFile((await (await save).path())!), envelope = JSON.parse(saved.toString());
  expect(envelope.project.schemaVersion).toBe(8); const background: any = Object.values(envelope.project.layers).find((layer: any) => layer.type === 'pageBackground'); expect(background.watermark.content).toBe('离线原稿'); expect(background.frame.kind).toBe('single'); expect(envelope.project.pages[background.pageId]).not.toHaveProperty('background');
  await page.getByRole('button', { name: '删除页面背景', exact: true }).click(); const png = page.waitForEvent('download'); await (await menuCommand(page, 'PNG')).click(); const transparent = await readFile((await (await png).path())!);
  const alpha = await page.evaluate(async bytes => { const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' })), c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height; const ctx = c.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); const corner = [...ctx.getImageData(0, 0, 1, 1).data], center = [...ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data]; bitmap.close(); c.width = c.height = 0; return { corner, center }; }, [...transparent]); expect(alpha).toEqual({ corner: [0, 0, 0, 0], center: [0, 0, 0, 0] });
  await page.locator('input[type=file][accept*=json]').setInputFiles({ name: '背景.Comia.json', mimeType: 'application/json', buffer: saved }); await waitForProjectIO(page); await page.locator('.layer-name').filter({ hasText: /^页面背景$/ }).click(); await expect(page.getByLabel('水印文字', { exact: true })).toHaveValue('离线原稿'); await expect(page.getByLabel('页面边框', { exact: true })).toHaveValue('single');
});
