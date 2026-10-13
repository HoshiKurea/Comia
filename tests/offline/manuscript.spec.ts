import { expect, test } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { menuCommand, setMenuScale, waitForProjectIO } from '../e2e/menuHelpers';

test('production offline comic setup and saved guides reopen; actual PNG and all 8 PDF pages omit guides', async ({ page, context }) => {
  await mkdir('output/manuscript', { recursive: true });
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }));
  await page.goto('/'); await expect.poll(() => page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!(r.active && navigator.serviceWorker.controller && (await caches.keys()).some(key => key.startsWith('comia-shell-'))); })).toBe(true);
  await context.setOffline(true); await page.reload();
  await (await menuCommand(page, '新建项目…')).click(); const dialog = page.getByRole('dialog', { name: '新建项目', exact: true });
  await expect(dialog.getByLabel('新项目 DPI')).toHaveValue('600'); await expect(dialog.getByLabel('新项目页数')).toHaveValue('8');
  await expect(dialog.getByLabel('新项目纸张',{exact:true})).toHaveValue('comic-B5'); await expect(dialog.getByLabel('新项目单位')).toHaveValue('mm'); await expect(dialog.getByText(/装订|成品/)).toHaveCount(0);
  await dialog.getByLabel('新项目名称').fill('离线原稿'); await dialog.getByRole('button', { name: '创建项目', exact: true }).click(); await expect(dialog).toHaveCount(0);
  const download = page.waitForEvent('download'); await (await menuCommand(page, '保存')).click(); const saved = await readFile((await (await download).path())!);
  const envelope = JSON.parse(saved.toString()); expect(envelope.project.schemaVersion).toBe(13); expect(envelope.project.pageOrder).toHaveLength(8);
  for (const id of envelope.project.pageOrder) expect(envelope.project.pages[id]).toMatchObject({ width: 4961, height: 7016, dpi: 600, manuscript: { trim: { widthMm: 182, heightMm: 257 }, bleedMm: 5, basicFrame: { widthMm: 149, heightMm: 219 } } });
  await page.locator('input[type=file][accept*=json]').setInputFiles({ name: '原稿.Comia.json', mimeType: 'application/json', buffer: saved }); await waitForProjectIO(page);
  await page.getByRole('tab', { name: '页面', exact: true }).click(); await expect(page.locator('.page-guide-overlay')).toHaveCount(8);
  await page.getByRole('button', { name: '漫画原稿与定位线设置…', exact: true }).click(); const settings = page.getByRole('dialog', { name: '漫画原稿设置', exact: true });
  await expect(settings.getByLabel('页面基本框宽度')).toHaveValue('149'); await settings.getByRole('button', { name: '取消', exact: true }).click();
  const again = page.waitForEvent('download'); await (await menuCommand(page, '保存')).click(); const reopened = JSON.parse(await readFile((await (await again).path())!, 'utf8')); expect(reopened.project).toEqual(envelope.project);
  await setMenuScale(page, '0.25'); const pngEvent = page.waitForEvent('download'); await (await menuCommand(page, 'PNG')).click(); const png = await pngEvent, pngBytes = await readFile((await png.path())!); await png.saveAs(`output/manuscript/offline-${test.info().project.name}.png`);
  const pixels = await page.evaluate(async bytes => { const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' })), c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height; const ctx = c.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); const data = ctx.getImageData(0, 0, c.width, c.height).data; let different = 0; for (const value of data) if (value !== 255) different++; bitmap.close(); return { width: c.width, height: c.height, different }; }, [...pngBytes]); expect(pixels).toEqual({ width: 1240, height: 1754, different: 0 });
  const pdfEvent = page.waitForEvent('download'); await (await menuCommand(page, 'PDF')).click(); await (await pdfEvent).saveAs(`output/manuscript/offline-${test.info().project.name}.pdf`);
});
