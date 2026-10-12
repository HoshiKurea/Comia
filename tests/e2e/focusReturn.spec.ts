import { menuCommand, waitForProjectIO } from './menuHelpers';
import { expect, test } from '@playwright/test';
import { Buffer } from 'node:buffer';
test('a menu opener supersedes a recent component pointer before a modal and receives focus after Escape', async ({ page }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  const file = page.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true });
  await (await menuCommand(page, '新建项目…')).click();
  const dialog = page.getByRole('dialog', { name: '新建项目', exact: true }); await expect(dialog).toBeVisible(); await expect(dialog.getByLabel('新项目名称', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(file).toBeFocused(); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
});
test('native file chooser lasting longer than a second keeps the persistent menu opener and opens a separate tab', async ({ page }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  const project = await page.evaluate(async () => { const { getProject } = await import('/src/' + 'state/documentStore.ts'); return getProject(); });
  const file = page.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true }), chosen = page.waitForEvent('filechooser'); await (await menuCommand(page, '打开')).click();
  const chooser = await chosen; await page.waitForTimeout(1100);
  await chooser.setFiles({ name: 'same.Comia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'Comia', version: 1, project, blobs: [] })) }); await waitForProjectIO(page);
  await expect(page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab')).toHaveCount(2); await expect(file).toBeFocused(); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
});
