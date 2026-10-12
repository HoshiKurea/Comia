import { test, expect } from '@playwright/test';

test('a real thumbnail encoder failure shows retry and recovers without changing document or history', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob; let fail = true;
    HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) { if (fail && type === 'image/png' && this.width <= 320) { fail = false; callback(null); } else original.call(this, callback, type, quality); };
  });
  await page.getByRole('tab', { name: '页面', exact: true }).click(); const retry = page.getByRole('button', { name: '重试缩略图' }); await expect(retry).toBeVisible(); await expect(page.getByText('生成失败', { exact: true })).toBeVisible();
  const errorBounds = await page.locator('.page-item').first().boundingBox();
  const before = await page.evaluate(async () => { const path = performance.getEntriesByType('resource').find((entry) => entry.name.includes('/src/state/documentStore.ts'))!.name; const { getDocument } = await import(path); return { project: getDocument().project, history: getDocument().history }; });
  await retry.click(); await expect(page.getByAltText('第 1 页缩略图')).toBeVisible(); await expect(retry).toHaveCount(0);
  const after = await page.evaluate(async () => { const path = performance.getEntriesByType('resource').find((entry) => entry.name.includes('/src/state/documentStore.ts'))!.name; const { getDocument } = await import(path); return { project: getDocument().project, history: getDocument().history }; }); expect(after).toEqual(before);
  const readyBounds = await page.locator('.page-item').first().boundingBox(); expect(readyBounds!.height).toBeCloseTo(errorBounds!.height, 2);
});

test('pending thumbnail and page insertion feedback keep native drop target dimensions unchanged', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob; let held = false;
    HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
      if (!held && type === 'image/png' && this.width <= 320) {
        held = true; document.documentElement.dataset.thumbnailHeld = 'yes';
        document.addEventListener('release-page-thumbnail', () => original.call(this, callback, type, quality), { once: true });
      } else original.call(this, callback, type, quality);
    };
  });
  await page.getByRole('tab', { name: '页面', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-thumbnail-held', 'yes');
  const card = page.locator('.page-item').first(), pending = await card.boundingBox();
  await expect(card.locator('.page-thumbnail')).toHaveAttribute('aria-busy', 'true');
  expect((await card.locator('.page-thumbnail').boundingBox())!.height).toBeGreaterThan(200);
  await card.evaluate((element) => element.classList.add('drop-before'));
  expect((await card.boundingBox())!.height).toBeCloseTo(pending!.height, 2);
  await page.evaluate(() => document.dispatchEvent(new Event('release-page-thumbnail')));
  await expect(page.getByAltText('第 1 页缩略图')).toBeVisible();
  expect((await card.boundingBox())!.height).toBeCloseTo(pending!.height, 2);
});
