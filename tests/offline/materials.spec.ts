import { menuCommand, waitForProjectIO } from '../e2e/menuHelpers';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function png(page: Page) {
  const pending = page.waitForEvent('download'); await (await menuCommand(page, 'PNG')).click();
  return readFile((await (await pending).path())!);
}
test('offline production imports library originals, edits a real mask, saves/reopens and exports identical pixels', async ({ page, context }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }));
  await page.goto('/'); await expect.poll(() => page.evaluate(async () => { const registration = await navigator.serviceWorker.ready; return Boolean(registration.active && navigator.serviceWorker.controller); })).toBe(true);
  await context.setOffline(true); await page.reload();
  await page.getByRole('tab', { name: '素材库', exact: true }).click(); await page.getByLabel('导入素材文件').setInputFiles('tests/fixtures/formats/red.png');
  await expect(page.locator('.asset-card')).toHaveCount(1); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(0);
  await page.getByRole('button', { name: '放置素材 red.png', exact: true }).click(); await page.getByRole('button', { name: '椭圆遮罩', exact: true }).click();
  await page.getByLabel('遮罩编辑角度', { exact: true }).fill('20'); await page.getByLabel('遮罩编辑角度', { exact: true }).press('Enter'); await page.getByRole('button', { name: '完成遮罩', exact: true }).click();
  const before = await png(page), save = page.waitForEvent('download'); await (await menuCommand(page, '保存')).click(); const saved = await readFile((await (await save).path())!), data = JSON.parse(saved.toString());
  expect(data.project.schemaVersion).toBe(8); expect(data.project.libraryAssetIds).toHaveLength(1); expect(data.blobs.length).toBeGreaterThan(0);
  const image: any = Object.values(data.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground')[0]; expect(image.mask.shape).toBe('ellipse'); expect(image.crop).toBeNull();
  await page.locator('input[type=file][accept*=json]').setInputFiles({ name: 'offline-materials.Comia.json', mimeType: 'application/json', buffer: saved });
  await waitForProjectIO(page); await expect(page.locator('.asset-card')).toHaveCount(1); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  expect(await png(page)).toEqual(before); await page.getByRole('button', { name: '放置素材 red.png', exact: true }).click(); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
});
