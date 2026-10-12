import { menuCommand } from '../e2e/menuHelpers';
import { test, expect } from '@playwright/test';

test('installed production shell reopens offline and keeps local editing and export usable', async ({ page, context }) => {
  await page.goto('/');
  await expect.poll(async () => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active && navigator.serviceWorker.controller && (await caches.keys()).some((name) => name.startsWith('comia-shell-')));
  })).toBe(true);

  await context.setOffline(true);
  await page.reload();
  const loadedFonts = await page.evaluate(() => [...document.fonts].filter((face) => face.family.includes('Noto Sans CJK SC')).map((face) => ({ status: face.status, weight: face.weight })));
  expect(loadedFonts).toEqual(expect.arrayContaining([{ status: 'loaded', weight: '400' }, { status: 'loaded', weight: '700' }]));
  await page.getByRole('button', { name: /矩形分镜/ }).click();
  const viewport = await page.locator('.canvas-viewport').boundingBox();
  expect(viewport).not.toBeNull();
  const x = viewport!.x + viewport!.width / 2;
  const y = viewport!.y + viewport!.height / 2;
  await page.mouse.click(x, y);
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);

  await page.evaluate(async ({ x, y }) => {
    const source = document.createElement('canvas');
    source.width = 16;
    source.height = 16;
    source.getContext('2d')!.fillRect(0, 0, 16, 16);
    const blob = await new Promise<Blob>((resolve) => source.toBlob((value) => resolve(value!), 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'offline.png', { type: 'image/png' }));
    document.querySelector('.canvas-viewport')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
  }, { x, y });
  await page.getByTitle('展开图层').click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);

  const downloadPromise = page.waitForEvent('download');
  await (await menuCommand(page, 'PNG')).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/i);
});
