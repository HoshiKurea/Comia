import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { menuCommand, waitForProjectIO } from '../e2e/menuHelpers';

test('production offline editor creates independent comics, switches history and exports through category menus', async ({ page, context }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/'); await expect.poll(() => page.evaluate(async () => { const registration = await navigator.serviceWorker.ready; return Boolean(registration.active && navigator.serviceWorker.controller && (await caches.keys()).some(name => name.startsWith('comia-shell-'))); })).toBe(true); await context.setOffline(true);
  await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); const saved = page.waitForEvent('download'); await (await menuCommand(page, '保存')).click(); const a = JSON.parse(await readFile((await (await saved).path())!, 'utf8'));
  await (await menuCommand(page, '新建项目…')).click(); const dialog = page.getByRole('dialog', { name: '新建项目', exact: true }); await dialog.getByLabel('新项目名称', { exact: true }).fill('离线漫画 B'); await dialog.getByLabel('新项目纸张', { exact: true }).selectOption('custom'); await dialog.getByLabel('新项目宽度', { exact: true }).fill('160'); await dialog.getByLabel('新项目高度', { exact: true }).fill('120'); await dialog.getByLabel('新项目 DPI', { exact: true }).fill('72'); await dialog.getByLabel('新项目背景', { exact: true }).selectOption('transparent'); await dialog.getByRole('button', { name: '创建项目', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab')).toHaveCount(2); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(0);
  const download = page.waitForEvent('download'); await (await menuCommand(page, 'PNG')).click(); expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab').first().click(); await waitForProjectIO(page); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1); const savedAgain = page.waitForEvent('download'); await (await menuCommand(page, '保存')).click(); expect(JSON.parse(await readFile((await (await savedAgain).path())!, 'utf8')).project).toEqual(a.project);
  await (await menuCommand(page, '撤销')).click(); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(0); await page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab', { name: /离线漫画 B/ }).click(); await waitForProjectIO(page); await expect(page.locator('.layer-row')).toHaveCount(1);
});
