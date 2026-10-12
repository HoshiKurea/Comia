import { menuCommand, waitForProjectIO } from './menuHelpers';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function model(page: Page) { return page.evaluate(async () => (await import('/src/' + 'state/documentStore.ts')).getDocument().project); }
async function pixels(page: Page) {
  return page.evaluate(async () => {
    const { getDocument } = await import('/src/' + 'state/documentStore.ts'), { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts'), { exportPng } = await import('/src/' + 'export/exportFiles.ts');
    const project = getDocument().project, hashes: string[] = [];
    for (const id of project.pageOrder) {
      const result = await exportPng(project, id, runtimeStore.getState().images); if (!result.ok) throw Error(result.problems[0].message);
      const bitmap = await createImageBitmap(result.value), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      hashes.push([...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map((byte) => byte.toString(16).padStart(2, '0')).join('')); canvas.width = canvas.height = 0;
    }
    return hashes;
  });
}

test('continuous two-page comic workflow preserves image crop, split, tail, dialogue, group scale, order and exact round-trip pixels', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }); Object.defineProperty(window, 'showDirectoryPicker', { value: undefined }); }); await page.goto('/');
  await page.getByRole('tab', { name: '页面', exact: true }).click(); await page.getByRole('button', { name: '+ 新建漫画页', exact: true }).click();
  for (let index = 0; index < 2; index++) {
    await page.locator('.page-item').nth(index).locator('button').first().click(); await page.getByLabel('页面宽度').fill('800'); await page.getByLabel('页面高度').fill('600'); await page.getByRole('button', { name: '应用页面尺寸', exact: true }).click();
  }
  await page.locator('.page-item').first().locator('button').first().click(); await page.getByRole('tab', { name: '组件库', exact: true }).click();
  const rect = (await page.locator('.canvas-viewport').boundingBox())!, center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const drag = async (name: string, x: number, y: number) => { const item = page.locator('.library-item').filter({ hasText: name }); await item.scrollIntoViewIfNeeded(); const box = (await item.boundingBox())!; await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(x, y, { steps: 12 }); await page.mouse.up(); };
  await drag('梯形分镜', center.x, center.y); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  await page.evaluate(async ({ x, y }) => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48; const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ff000080'; ctx.fillRect(0, 0, 32, 48); ctx.fillStyle = '#0000ff'; ctx.fillRect(32, 0, 32, 48);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png')), transfer = new DataTransfer(); transfer.items.add(new File([blob], 'transparent-comic.png', { type: 'image/png' }));
    document.querySelector('.canvas-viewport')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
  }, center);
  await expect.poll(async () => Object.values((await model(page)).layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter((layer: any) => layer.type === 'image').length).toBe(1);
  await page.mouse.dblclick(center.x, center.y); await expect(page.getByLabel('裁剪缩放倍数')).toBeVisible(); await page.getByLabel('裁剪缩放倍数').fill('2'); await page.getByLabel('裁剪缩放倍数').press('Enter');
  await page.mouse.move(center.x, center.y); await page.mouse.down(); await page.mouse.move(center.x + 18, center.y + 12, { steps: 6 }); await page.mouse.up(); await page.getByRole('button', { name: '完成裁剪', exact: true }).click();
  await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').filter({ hasText: '分镜' }).first().click(); await page.getByLabel('切割比例').fill('0.4'); await page.getByLabel('切割间隙').fill('12'); await page.getByRole('button', { name: '垂直切割', exact: true }).click();
  expect(Object.values((await model(page)).layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter((layer: any) => layer.type === 'image')).toHaveLength(2);
  await drag('对白气泡', center.x, center.y); await page.getByRole('button', { name: '三角尾', exact: true }).click(); await page.mouse.dblclick(center.x, center.y);
  await page.getByLabel('编辑文字内容').fill('你好，Comia！\n第二行对白😀'); await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').filter({ hasText: '气泡' }).first().click(); await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').filter({ hasText: '分镜' }).first().click({ modifiers: ['Control'] }); await (await menuCommand(page, '编组')).click();
  await page.getByLabel('对象宽').fill('720'); await page.getByLabel('对象宽').press('Enter'); const scaled = await model(page);
  await (await menuCommand(page, '撤销')).click(); expect(await model(page)).not.toEqual(scaled); await (await menuCommand(page, '重做')).click(); expect(await model(page)).toEqual(scaled);
  const beforePixels = await pixels(page), saved = page.waitForEvent('download'); await (await menuCommand(page, '保存')).click(); const file = await saved, path = (await file.path())!;
  const envelope = JSON.parse(await readFile(path, 'utf8')); expect(envelope.project).toEqual(scaled); expect(envelope.blobs).toHaveLength(1);
  await page.locator('input[type=file][accept=".json,.Comia.json"]').setInputFiles(path); await waitForProjectIO(page);
  expect(await model(page)).toEqual(scaled); expect(await pixels(page)).toEqual(beforePixels);
  const pngDownload = page.waitForEvent('download'); await (await menuCommand(page, 'PNG')).click(); expect((await pngDownload).suggestedFilename()).toMatch(/\.png$/);
  const pdfDownload = page.waitForEvent('download'); await (await menuCommand(page, 'PDF')).click(); const pdf = await pdfDownload; const binary = (await readFile((await pdf.path())!)).toString('latin1'); expect(binary.match(/\/Type\s*\/Page\b/g)).toHaveLength(2); await pdf.saveAs('output/playwright/workflow.pdf');
});
