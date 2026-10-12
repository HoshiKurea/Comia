import type { Project } from '../../src/domain/types';
import { menuCommand, waitForProjectIO } from './menuHelpers';
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function dragComponent(page: Page, name: string, x: number, y: number): Promise<void> {
  const item = page.locator('.library-item').filter({ hasText: name });
  await item.scrollIntoViewIfNeeded();
  const source = await item.boundingBox();
  expect(source).not.toBeNull();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
}

test('pages can be renamed, reordered, resized and deleted with one-step undo', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByRole('tab', { name: '页面', exact: true }).click();
  await page.getByRole('button', { name: '+ 新建漫画页' }).click();
  await page.getByRole('button', { name: '+ 新建漫画页' }).click();
  await expect(page.locator('.page-item')).toHaveCount(3);
  page.once('dialog', (dialog) => dialog.accept('封面'));
  await page.locator('.page-item').last().getByTitle('重命名页面').click();
  await expect(page.locator('.page-item').last()).toContainText('封面');
  await page.locator('.page-item').last().dragTo(page.locator('.page-item').first());
  await expect(page.locator('.page-item').first()).toContainText('封面');
  const thumbnail = page.locator('.page-item').first().locator('img');
  await expect(thumbnail).toBeVisible();
  const beforeThumb = await thumbnail.getAttribute('src');
  const otherThumbnail = page.locator('.page-item').nth(1).locator('img');
  await expect(otherThumbnail).toBeVisible();
  const otherBefore = await otherThumbnail.getAttribute('src');
  await page.getByLabel('页面宽度').fill('500');
  await page.getByLabel('页面高度').fill('600');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '应用页面尺寸' }).click();
  await expect(page.locator('.page-item').first()).toContainText('500 × 600');
  await expect.poll(async () => thumbnail.getAttribute('src')).not.toBe(beforeThumb);
  expect(await thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(160);
  expect(await otherThumbnail.getAttribute('src')).toBe(otherBefore);
  await page.getByLabel('页面宽度').fill('400');
  await page.getByLabel('页面高度').fill('800');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '应用页面尺寸' }).click();
  await page.getByLabel('页面宽度').fill('200');
  await page.getByLabel('页面高度').fill('600');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '应用页面尺寸' }).click();
  await expect(page.locator('.page-item').first()).toContainText('200 × 600');
  await expect.poll(async () => thumbnail.evaluate((img: HTMLImageElement) => img.naturalHeight)).toBe(320);
  await page.waitForTimeout(350);
  expect(await thumbnail.evaluate((img: HTMLImageElement) => img.naturalHeight)).toBe(320);
  await page.getByLabel('阅读方向').selectOption('rtl');
  await expect(page.getByLabel('阅读方向')).toHaveValue('rtl');
  const pdfDownload = page.waitForEvent('download');
  await (await menuCommand(page, 'PDF')).click();
  const pdf = (await readFile((await (await pdfDownload).path())!)).toString('latin1');
  const pageBoxes = [...pdf.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map((match) => match[1].trim().split(/\s+/).map(Number));
  expect(pageBoxes).toHaveLength(3);
  expect(pageBoxes[0][2]).toBeCloseTo(48, 0);
  expect(pageBoxes[0][3]).toBeCloseTo(144, 0);
  expect(pageBoxes[1][2]).toBeCloseTo(595.2, 0);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('.page-item').first().getByTitle('删除页面').click();
  await expect(page.locator('.page-item')).toHaveCount(2);
  await (await menuCommand(page, '撤销')).click();
  await expect(page.locator('.page-item')).toHaveCount(3);
  await expect(page.locator('.page-item').first()).toContainText('封面');
});

test('create, cut, undo and redo a panel as one transaction each', async ({ page }) => {
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  expect(rect).not.toBeNull();
  await dragComponent(page, '矩形分镜', rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  await page.getByRole('button', { name: '垂直切割' }).click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
  await (await menuCommand(page, '撤销')).click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  await (await menuCommand(page, '重做')).click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
});

test('edit text and download a PNG', async ({ page }) => {
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  await dragComponent(page, '文字', rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
  await expect(page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').first()).toContainText('文字');
  await page.mouse.dblclick(rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
  await expect(page.getByText('编辑文字', { exact: true })).toBeVisible();
  await page.getByLabel('编辑文字内容').fill('你好，Comia');
  await page.getByRole('button', { name: '完成' }).click();
  await expect(page.getByLabel('编辑文字内容')).toHaveCount(0);
  const pageShot = await page.locator('.canvas-viewport').screenshot();
  expect(pageShot.byteLength).toBeGreaterThan(1000);
  const downloadPromise = page.waitForEvent('download');
  await (await menuCommand(page, 'PNG')).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/i);
});

test('saved self-contained file opens with the same editable layers', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  await dragComponent(page, '矩形分镜', rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
  const downloadPromise = page.waitForEvent('download');
  await (await menuCommand(page, '保存')).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  await page.reload();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(0);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByLabel('打开项目文件', { exact: true }).setInputFiles(path!);
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  await expect((await menuCommand(page, '撤销'))).toBeDisabled();
});

test('drop image into a panel, split it, then reopen the embedded asset', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  const x = rect!.x + rect!.width / 2, y = rect!.y + rect!.height / 2;
  await dragComponent(page, '矩形分镜', x, y);
  await page.evaluate(async ({ x, y }) => {
    const source = document.createElement('canvas');
    source.width = 16; source.height = 16;
    const ctx = source.getContext('2d')!;
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 8, 16);
    ctx.fillStyle = '#0000ff'; ctx.fillRect(8, 0, 8, 16);
    const blob = await new Promise<Blob>((resolve) => source.toBlob((value) => resolve(value!), 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'panels.png', { type: 'image/png' }));
    document.querySelector('.canvas-viewport')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
  }, { x, y });
  await page.getByTitle('展开图层').click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
  await page.locator('.layer-row:not([data-layer-type="pageBackground"])').filter({ hasText: '分镜' }).locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').click();
  await page.getByRole('button', { name: '垂直切割' }).click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
  const downloadPromise = page.waitForEvent('download');
  await (await menuCommand(page, '保存')).click();
  const download = await downloadPromise;
  const path = await download.path();
  await page.reload();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByLabel('打开项目文件', { exact: true }).setInputFiles(path!);
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
  await page.getByTitle('展开图层').first().click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(3);
});

test('safe SVG imports as a local raster while external SVG references are rejected without requests', async ({ page }) => {
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  expect(rect).not.toBeNull();
  const x = rect!.x + rect!.width / 2, y = rect!.y + rect!.height / 2;
  const requests: string[] = [];
  page.on('request', (request) => { if (request.url().includes('example.com')) requests.push(request.url()); });
  const drop = async (source: string, name: string) => page.evaluate(({ source, name, x, y }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([source], name, { type: 'image/svg+xml' }));
    document.querySelector('.canvas-viewport')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
  }, { source, name, x, y });
  await drop('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="20" fill="#00f"/></svg>', 'safe.svg');
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  await drop('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><image href="https://example.com/exfil.png"/></svg>', 'unsafe.svg');
  await expect(page.locator('.notice.error')).toContainText('本批图片均未导入');
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  expect(requests).toEqual([]);
});

test('local format fixtures normalize animation frame zero and EXIF orientations 1 through 8', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  expect(rect).not.toBeNull();
  const x = rect!.x + rect!.width / 2, y = rect!.y + rect!.height / 2;
  const names = ['red.png', 'red.webp', 'red.avif', 'red-first.webp', 'red-first.gif', 'transparent.png', 'transparent.webp', 'transparent.avif', 'transparent.gif', ...Array.from({ length: 8 }, (_, i) => `orientation-${i + 1}.jpg`)];
  const canDecodeAnimatedWebp = await page.evaluate(async () => {
    const Decoder = (window as any).ImageDecoder;
    return Boolean(Decoder && (!Decoder.isTypeSupported || await Decoder.isTypeSupported('image/webp')));
  });
  let expected = 0;
  for (const name of names) {
    const bytes = Array.from(await readFile(resolve('tests/fixtures/formats', name)));
    await page.evaluate(({ bytes, name, x, y }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], name));
      document.querySelector('.canvas-viewport')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
    }, { bytes, name, x, y });
    if (name !== 'red-first.webp' || canDecodeAnimatedWebp) expected++;
    await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(expected);
  }
  const pending = page.waitForEvent('download');
  await (await menuCommand(page, '保存')).click();
  const envelope = JSON.parse((await readFile((await (await pending).path())!)).toString());
  const assets = Object.values(envelope.project.assets) as any[];
  for (const name of ['transparent.png', 'transparent.webp', 'transparent.avif', 'transparent.gif']) {
    const asset = assets.find((item) => item.name === name);
    expect(asset).toBeDefined();
    const blob = envelope.blobs.find((item: any) => item.hash === asset.renderHash);
    const alpha = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
      return ctx.getImageData(12, 8, 1, 1).data[3];
    }, blob.base64);
    expect(alpha).toBe(0);
  }
  for (let orientation = 1; orientation <= 8; orientation++) {
    const asset = assets.find((item) => item.name === `orientation-${orientation}.jpg`);
    expect(asset).toMatchObject({ width: orientation >= 5 ? 8 : 16, height: orientation >= 5 ? 16 : 8, normalizedOrientation: true });
    const blob = envelope.blobs.find((item: any) => item.hash === asset.renderHash);
    const rgba = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
      return [...ctx.getImageData(2, 2, 1, 1).data];
    }, blob.base64) as number[];
    const topLeftIsRed = [1, 4, 5, 6].includes(orientation);
    expect(rgba[topLeftIsRed ? 0 : 2]).toBeGreaterThan(200);
    expect(rgba[topLeftIsRed ? 2 : 0]).toBeLessThan(50);
  }
  for (const name of ['red-first.gif', ...(canDecodeAnimatedWebp ? ['red-first.webp'] : [])]) {
    const asset = assets.find((item) => item.name === name);
    expect(asset.framePolicy).toBe('first-frame');
    const blob = envelope.blobs.find((item: any) => item.hash === asset.renderHash);
    const rgba = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
      return [...ctx.getImageData(8, 8, 1, 1).data];
    }, blob.base64) as number[];
    expect(rgba[0]).toBeGreaterThan(200);
    expect(rgba[2]).toBeLessThan(50);
  }
});

test('animated AVIF either decodes frame zero or rejects without creating a layer', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  expect(rect).not.toBeNull();
  const x = rect!.x + rect!.width / 2, y = rect!.y + rect!.height / 2;
  const bytes = Array.from(await readFile(resolve('tests/fixtures/formats/red-first.avif')));
  await page.evaluate(({ bytes, x, y }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'red-first.avif', { type: 'image/avif' }));
    document.querySelector('.canvas-viewport')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
  }, { bytes, x, y });
  await expect.poll(async () => (await page.locator('.layer-row:not([data-layer-type="pageBackground"])').count()) > 0 || (await page.locator('.notice.error').count()) > 0).toBe(true);
  if (await page.locator('.layer-row:not([data-layer-type="pageBackground"])').count()) {
    const pending = page.waitForEvent('download');
    await (await menuCommand(page, '保存')).click();
    const envelope = JSON.parse((await readFile((await (await pending).path())!)).toString());
    const asset = Object.values(envelope.project.assets)[0] as any;
    expect(asset.framePolicy).toBe('first-frame');
    const blob = envelope.blobs.find((item: any) => item.hash === asset.renderHash);
    const rgba = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
      return [...ctx.getImageData(8, 8, 1, 1).data];
    }, blob.base64) as number[];
    expect(rgba[0]).toBeGreaterThan(200);
    expect(rgba[2]).toBeLessThan(50);
  } else {
    await expect(page.locator('.notice.error')).toContainText('静态PNG');
    await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(0);
  }
});

test('crop drag and wheel preview commit as one undoable edit', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  const x = rect!.x + rect!.width / 2, y = rect!.y + rect!.height / 2;
  await dragComponent(page, '矩形分镜', x, y);
  await page.evaluate(async ({ x, y }) => {
    const source = document.createElement('canvas'); source.width = 16; source.height = 16;
    source.getContext('2d')!.fillRect(0, 0, 16, 16);
    const blob = await new Promise<Blob>((resolve) => source.toBlob((value) => resolve(value!), 'image/png'));
    const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'crop.png', { type: 'image/png' }));
    document.querySelector('.canvas-viewport')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
  }, { x, y });
  await page.getByTitle('展开图层').click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
  await page.locator('.layer-row:not([data-layer-type="pageBackground"])').filter({ hasText: '分镜' }).locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').click();
  await page.getByRole('button', { name: '编辑裁剪' }).click();
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + 18, { steps: 4 }); await page.mouse.up();
  await page.mouse.wheel(0, -300);
  await page.getByRole('button', { name: '完成裁剪' }).click();
  const firstDownload = page.waitForEvent('download');
  await (await menuCommand(page, '保存')).click();
  const firstFile = JSON.parse((await readFile((await (await firstDownload).path())!)).toString());
  const crop1 = Object.values(firstFile.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((layer: any) => layer.type === 'image') as any;
  expect(crop1.crop.zoom).toBeGreaterThan(1);
  await (await menuCommand(page, '撤销')).click();
  const secondDownload = page.waitForEvent('download');
  await (await menuCommand(page, '保存')).click();
  const secondFile = JSON.parse((await readFile((await (await secondDownload).path())!)).toString());
  const crop2 = Object.values(secondFile.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((layer: any) => layer.type === 'image') as any;
  expect(crop2.crop).toEqual({ focus: { u: 0.5, v: 0.5 }, zoom: 1 });
});

test('multiple dropped images import atomically and one undo removes the batch', async ({ page }) => {
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  const x = rect!.x + rect!.width / 2, y = rect!.y + rect!.height / 2;
  await dragComponent(page, '矩形分镜', x, y);
  const drop = async (bad: boolean) => page.evaluate(async ({ x, y, bad }) => {
    const source = document.createElement('canvas'); source.width = 8; source.height = 8;
    source.getContext('2d')!.fillRect(0, 0, 8, 8);
    const blob = await new Promise<Blob>((resolve) => source.toBlob((value) => resolve(value!), 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'one.png', { type: 'image/png' }));
    transfer.items.add(bad ? new File(['broken'], 'bad.png', { type: 'image/png' }) : new File([blob], 'two.png', { type: 'image/png' }));
    document.querySelector('.canvas-viewport')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
  }, { x, y, bad });
  await drop(true);
  await expect(page.getByText(/本批图片均未导入/)).toBeVisible();
  await page.getByTitle('展开图层').click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  await drop(false);
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(3);
  await (await menuCommand(page, '撤销')).click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
});

test('two adjacent layers group and ungroup without changing their count', async ({ page }) => {
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  for (const dx of [-65, 65]) {
    await dragComponent(page, '矩形分镜', rect!.x + rect!.width / 2 + dx, rect!.y + rect!.height / 2);
  }
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
  await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').last().click({ modifiers: ['Shift'] });
  await (await menuCommand(page, '编组')).click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  await page.getByTitle('展开图层').click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(3);
  await (await menuCommand(page, '解组')).click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
});

test('a free layer can explicitly enter and leave a group with undo restoring its parent', async ({ page }) => {
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  expect(rect).not.toBeNull();
  for (const dx of [-65, 65]) {
    await dragComponent(page, '矩形分镜', rect!.x + rect!.width / 2 + dx, rect!.y + rect!.height / 2);
  }
  await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').last().click({ modifiers: ['Shift'] });
  await (await menuCommand(page, '编组')).click();
  await dragComponent(page, '文字', rect!.x + rect!.width / 2, rect!.y + rect!.height / 2 + 100);
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
  await page.getByLabel('移入组').selectOption({ index: 1 });
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  await page.getByTitle('展开图层').click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(4);
  await page.getByRole('button', { name: '移出组' }).click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(4);
  await (await menuCommand(page, '撤销')).click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(4);
  await expect(page.getByRole('button', { name: '移出组' })).toBeVisible();
});

test('gesture preview keeps a higher sibling on top without redrawing the main layer', async ({ page }) => {
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  expect(rect).not.toBeNull();
  const cx = rect!.x + rect!.width / 2;
  const cy = rect!.y + rect!.height / 2;
  await dragComponent(page, '矩形分镜', cx - 35, cy);
  await page.locator('.color-field').filter({ hasText: '填充色' }).locator('input').fill('#ff0000');
  await dragComponent(page, '矩形分镜', cx + 35, cy);
  await page.locator('.color-field').filter({ hasText: '填充色' }).locator('input').fill('#0000ff');
  await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').last().click();
  // Sample inside the upper fill, away from selection handles after Fit's 32px margin adjustment.
  const clip = { x: cx + 33, y: cy + 12, width: 5, height: 5 };
  await page.screenshot({ path: 'output/playwright/occlusion-before.png' });
  const before = await page.screenshot({ clip });
  // This test isolates paint order; Alt hides intentional alignment overlays over the sampled sibling.
  await page.keyboard.down('Alt');
  await page.mouse.move(cx - 55, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 50, cy);
  await page.waitForTimeout(80);
  await page.evaluate(async () => { const path = performance.getEntriesByType('resource').find((entry) => entry.name.includes('/src/state/runtimeStore.ts'))?.name; if (!path) throw new Error('运行时模块未加载'); (await import(path)).resetRenderStats(); });
  await page.mouse.move(cx - 5, cy, { steps: 60 });
  await page.waitForTimeout(80);
  const during = await page.screenshot({ clip });
  await page.screenshot({ path: 'output/playwright/occlusion-during.png' });
  const stats = await page.evaluate(async () => { const path = performance.getEntriesByType('resource').find((entry) => entry.name.includes('/src/state/runtimeStore.ts'))?.name; if (!path) throw new Error('运行时模块未加载'); return (await import(path)).runtimeStore.getState().renderStats; });
  expect(stats.mainDraws).toBe(0);
  expect(stats.gestureDraws).toBeGreaterThan(0);
  expect(stats.overlayDraws).toBeGreaterThan(0);
  expect(during).toEqual(before);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const after = await page.screenshot({ clip });
  expect(after).toEqual(before);
});

test('PDF export contains one page per project page with A4 physical media boxes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: '页面', exact: true }).click();
  await page.getByRole('button', { name: '+ 新建漫画页' }).click();
  await expect(page.locator('.page-item')).toHaveCount(2);
  const downloadPromise = page.waitForEvent('download');
  await (await menuCommand(page, 'PDF')).click();
  const data = (await readFile((await (await downloadPromise).path())!)).toString('latin1');
  expect(data.startsWith('%PDF-')).toBe(true);
  expect((data.match(/\/Type\s*\/Page\b/g) ?? [])).toHaveLength(2);
  const boxes = [...data.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)];
  expect(boxes).toHaveLength(2);
  for (const box of boxes) {
    const nums = box[1].trim().split(/\s+/).map(Number);
    expect(nums[2]).toBeCloseTo(595.2, 0);
    expect(nums[3]).toBeCloseTo(841.9, 0);
  }
});

test('copy and paste creates independent layers and undo removes only the last paste', async ({ page }) => {
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  await dragComponent(page, '矩形分镜', rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
  await (await menuCommand(page, '复制')).click();
  await (await menuCommand(page, '粘贴')).click();
  await (await menuCommand(page, '粘贴')).click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(3);
  await (await menuCommand(page, '撤销')).click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
});

test('dragging a multi-selection moves both layers in one undo step', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  const x = rect!.x + rect!.width / 2, y = rect!.y + rect!.height / 2;
  for (const dx of [-75, 75]) {
    await dragComponent(page, '矩形分镜', x + dx, y);
  }
  const initial = async () => {
    const pending = page.waitForEvent('download');
    await (await menuCommand(page, '保存')).click();
    const data = JSON.parse((await readFile((await (await pending).path())!)).toString());
    return Object.fromEntries(Object.values(data.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').map((layer: any) => [layer.id, layer.matrix]));
  };
  const before = await initial();
  await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').last().click({ modifiers: ['Shift'] });
  await page.mouse.move(x + 75, y); await page.mouse.down(); await page.mouse.move(x + 91, y + 12, { steps: 4 }); await page.mouse.up();
  const after = await initial();
  const ids = Object.keys(before);
  expect(ids).toHaveLength(2);
  for (const id of ids) {
    expect((after[id] as number[])[4]).toBeGreaterThan((before[id] as number[])[4]);
    expect((after[id] as number[])[5]).toBeGreaterThan((before[id] as number[])[5]);
  }
  await (await menuCommand(page, '撤销')).click();
  expect(await initial()).toEqual(before);
});

test('five bubble templates and a dragged tail persist in the project', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  const x = rect!.x + rect!.width / 2, y = rect!.y + rect!.height / 2;
  const names = ['对白气泡', '方框气泡', '圆形气泡', '云朵气泡', '尖刺气泡'];
  for (let i = 0; i < names.length; i++) {
    await dragComponent(page, names[i], x + (i - 2) * 70, y);
  }
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(5);
  await page.getByRole('button', { name: '三角尾' }).click();
  const tipBox=(await page.getByLabel('尾巴尖端',{exact:true}).boundingBox())!,tipX=tipBox.x+tipBox.width/2,tipY=tipBox.y+tipBox.height/2;
  await page.mouse.move(tipX, tipY); await page.mouse.down(); await page.mouse.move(tipX + 10, tipY + 12, { steps: 4 }); await page.mouse.up();
  const pending = page.waitForEvent('download');
  await (await menuCommand(page, '保存')).click();
  const data = JSON.parse((await readFile((await (await pending).path())!)).toString());
  const bubbles = Object.values(data.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter((layer: any) => layer.type === 'bubble') as any[];
  expect(bubbles.map((bubble) => bubble.shape).sort()).toEqual(['circle', 'cloud', 'rect', 'roundRect', 'spiky']);
  const spiky=bubbles.find(b=>b.shape==='spiky'),tail=spiky.children.map((id:string)=>data.project.layers[id]).find((l:any)=>l.type==='bubbleTail');expect(tail.appearance).toBe('triangle');
  expect(tail.tip.y).toBeGreaterThan(240);
  expect(bubbles.find((bubble) => bubble.shape === 'circle').width).toBe(bubbles.find((bubble) => bubble.shape === 'circle').height);
});

test('component pointer drag stays visible outside the page and commits only on the page', async ({ page }) => {
  await page.goto('/');
  const thumbnailPixels = await page.locator('.library-icon canvas').evaluateAll((canvases) => canvases.map((item) => {
    const canvas = item as HTMLCanvasElement;
    const rgba = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let visible = 0; for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 0) visible++;
    return visible;
  }));
  // 44 deployable canvas thumbnails plus the vector speed-brush tool icon.
  expect(thumbnailPixels).toHaveLength(44);
  await expect(page.locator('.library-item')).toHaveCount(45);
  await expect(page.locator('.speed-brush-tool svg')).toBeVisible();
  expect(Math.min(...thumbnailPixels)).toBeGreaterThan(10);
  const item = page.locator('.library-item').filter({ hasText: '矩形分镜' });
  const source = await item.boundingBox(), canvas = await page.locator('.canvas-viewport').boundingBox();
  expect(source).not.toBeNull(); expect(canvas).not.toBeNull();
  const sx = source!.x + source!.width / 2, sy = source!.y + source!.height / 2;
  const cx = canvas!.x + canvas!.width / 2, cy = canvas!.y + canvas!.height / 2;
  await page.mouse.move(sx, sy); await page.mouse.down();
  await page.mouse.move(sx + 24, sy + 24, { steps: 4 });
  const outsideGhost = page.getByTestId('component-drag-preview');
  await expect(outsideGhost).toBeVisible();
  const ghostStyle = await outsideGhost.evaluate((node) => ({ opacity: Number(getComputedStyle(node).opacity), pointerEvents: getComputedStyle(node).pointerEvents }));
  expect(ghostStyle.opacity).toBeGreaterThan(0);
  expect(ghostStyle.opacity).toBeLessThan(1);
  expect(ghostStyle.pointerEvents).toBe('none');
  await page.screenshot({ path: 'output/playwright/component-ghost-outside.png' });
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(0);
  await page.mouse.move(cx - 30, cy, { steps: 8 });
  await expect(outsideGhost).toBeHidden();
  await page.waitForTimeout(80);
  await page.evaluate(async () => { const path = performance.getEntriesByType('resource').find((entry) => entry.name.includes('/src/state/runtimeStore.ts'))?.name; if (!path) throw new Error('运行时模块未加载'); (await import(path)).resetRenderStats(); });
  await page.mouse.move(cx + 30, cy, { steps: 30 });
  await page.waitForTimeout(80);
  const stats = await page.evaluate(async () => { const path = performance.getEntriesByType('resource').find((entry) => entry.name.includes('/src/state/runtimeStore.ts'))?.name; if (!path) throw new Error('运行时模块未加载'); return (await import(path)).runtimeStore.getState().renderStats; });
  expect(stats.mainDraws).toBe(0);
  expect(stats.gestureDraws).toBeGreaterThan(0);
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  await page.mouse.move(sx, sy); await page.mouse.down();
  await page.mouse.move(source!.x + 10, source!.y + 10, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  await item.click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
  expect((await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').allTextContents()).sort()).toEqual(['分镜 1', '分镜 2']);
  await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(cx, cy, { steps: 6 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
  await expect(outsideGhost).toBeHidden();
});

test('clicking or keyboard activating a component creates one selected object at the page center', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: '组件库', exact: true })).toBeVisible();
  const centeredView = await page.evaluate(async () => {
    const { getProject } = await import('/src/' + 'state/documentStore.ts');
    const { getViewport, sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const id = sessionStore.getState().activePageId, sheet = getProject().pages[id], view = getViewport(id)!;
    const rect = document.querySelector('.canvas-viewport')!.getBoundingClientRect();
    return { x: view.pan.x + view.zoom * sheet.width / 2, y: view.pan.y + view.zoom * sheet.height / 2, width: rect.width, height: rect.height };
  });
  expect(centeredView.x).toBeCloseTo(centeredView.width / 2); expect(centeredView.y).toBeCloseTo(centeredView.height / 2);
  const item = page.locator('.library-item').filter({ hasText: '矩形分镜' });
  await item.click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"]).selected')).toHaveCount(1);
  const placed = await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').find((entry) => entry.name.includes('/src/state/documentStore.ts'))?.name;
    if (!path) throw new Error('文档模块未加载');
    const { project } = (await import(path)).getDocument();
    const currentPage = project.pages[project.pageOrder[0]], layer = project.layers[currentPage.roots.find((id: string) => project.layers[id].type !== 'pageBackground')!];
    const xs = layer.geometry.map((p: { x: number }) => p.x), ys = layer.geometry.map((p: { y: number }) => p.y);
    return { actual: [layer.matrix[4] + (Math.min(...xs) + Math.max(...xs)) / 2, layer.matrix[5] + (Math.min(...ys) + Math.max(...ys)) / 2], expected: [currentPage.width / 2, currentPage.height / 2] };
  });
  expect(placed.actual).toEqual(placed.expected);
  await (await menuCommand(page, '撤销')).click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(0);
  await item.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"]).selected')).toHaveCount(1);
});

test('touch drag from library creates one object', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto(test.info().project.use.baseURL ?? 'http://127.0.0.1:5173');
    const item = page.locator('.library-item').filter({ hasText: '圆形气泡' }); await item.scrollIntoViewIfNeeded();
    const source = await item.boundingBox();
    const canvas = await page.locator('.canvas-viewport').boundingBox();
    expect(source).not.toBeNull(); expect(canvas).not.toBeNull();
    const sx = source!.x + source!.width / 2, sy = source!.y + source!.height / 2;
    const cx = canvas!.x + canvas!.width / 2, cy = canvas!.y + canvas!.height / 2;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy, id: 1 }] });
    for (let i = 1; i <= 12; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx + (cx - sx) * i / 12, y: sy + (cy - sy) * i / 12, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  } finally { await context.close(); }
});

test('a split panel saved as a user template can be reused after reopening', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  expect(rect).not.toBeNull();
  const x = rect!.x + rect!.width / 2, y = rect!.y + rect!.height / 2;
  await page.evaluate(async()=>{const{createObjectDraft}=await import('/src/'+'app/actions.ts'),{execute}=await import('/src/'+'history/commandBus.ts'),{sessionStore}=await import('/src/'+'state/sessionStore.ts');const pageId=sessionStore.getState().activePageId,r=createObjectDraft('layout:two-columns',pageId);if(!r.ok)throw Error('legacy template fixture');const{layer,descendants}=r.value;const made=execute({label:'既有旧版双格',context:{pageId,selection:[]},afterSelection:[layer.id],mutate(d: Project){d.layers[layer.id]=layer;for(const l of descendants)d.layers[l.id]=l;d.pages[pageId].roots.push(layer.id);}});if(!made.ok)throw Error(JSON.stringify(made));});
  page.once('dialog', (dialog) => dialog.accept('双格素材'));
  await page.getByRole('button', { name: '存为组件' }).click();
  const templateItem = page.locator('.library-item').filter({ hasText: '自定义 · 双格素材' });
  await expect(templateItem).toBeVisible();
  await templateItem.scrollIntoViewIfNeeded();
  const source = await templateItem.boundingBox();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down(); await page.mouse.move(x + 100, y, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(3);
  const pending = page.waitForEvent('download');
  await (await menuCommand(page, '保存')).click();
  const path = (await (await pending).path())!;
  const data = JSON.parse((await readFile(path)).toString());
  const templates = Object.values(data.project.templates) as any[];
  expect(templates).toHaveLength(1);
  expect(templates[0].root.children).toHaveLength(2);
  await page.reload();
  if (await page.getByRole('button', { name: '稍后' }).isVisible()) await page.getByRole('button', { name: '稍后' }).click();
  await page.locator('input[type=file][accept=".json,.Comia.json"]').setInputFiles(path);
  await expect(page.locator('.library-item').filter({ hasText: '自定义 · 双格素材' })).toBeVisible();
  await page.getByRole('button', { name: '删除 双格素材' }).click();
  await expect(page.locator('.library-item').filter({ hasText: '自定义 · 双格素材' })).toHaveCount(0);
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(3);
  await (await menuCommand(page, '撤销')).click();
  await expect(page.locator('.library-item').filter({ hasText: '自定义 · 双格素材' })).toBeVisible();
});

test('speed, focus and editable sound effects survive undo and project save', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  expect(rect).not.toBeNull();
  const x = rect!.x + rect!.width / 2, y = rect!.y + rect!.height / 2;
  // Existing rectangular speed objects remain editable after the library entry becomes a brush.
  await page.evaluate(async () => {
    const { getProject } = await import('/src/' + 'state/documentStore.ts'), { addObject } = await import('/src/' + 'app/actions.ts');
    const p = getProject(), r = addObject('speed', p.pageOrder[0], { x: 600, y: 900 }); if (!r.ok) throw Error(JSON.stringify(r));
  });
  await page.getByLabel('线数').fill('30'); await page.getByLabel('线数').press('Tab');
  await page.getByLabel('角度').fill('90'); await page.getByLabel('角度').press('Tab');
  await dragComponent(page, '集中线', x, y);
  await page.getByLabel('留白比例').fill('0.7'); await page.getByLabel('留白比例').press('Tab');
    await dragComponent(page, '音效字', x + 80, y);
    await page.getByRole('button',{name:'编辑文字',exact:true}).click();await page.getByLabel('编辑文字内容').fill('轰！');await page.getByLabel('编辑文字内容').press('Control+Enter');
    const renderedHash = () => page.evaluate(async () => {
      const { getDocument } = await import('/src/' + 'state/documentStore.ts'), { exportPng } = await import('/src/' + 'export/exportFiles.ts');
      const doc = getDocument(), result = await exportPng(doc.project, doc.project.pageOrder[0], new Map()); if (!result.ok) throw Error(result.problems[0].message);
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await result.value.arrayBuffer()))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    });
    const originalPixels = await renderedHash();
  await (await menuCommand(page, '撤销')).click();
  expect(await page.evaluate(async()=>{const p=(await import('/src/'+'state/documentStore.ts')).getProject();return (Object.values(p.layers).find((l:any)=>l.type==='text'&&l.role==='sfx') as any).text.content;})).toBe('砰！');
    await (await menuCommand(page, '重做')).click();
    expect(await page.evaluate(async()=>{const p=(await import('/src/'+'state/documentStore.ts')).getProject();return (Object.values(p.layers).find((l:any)=>l.type==='text'&&l.role==='sfx') as any).text.content;})).toBe('轰！');
    expect(await renderedHash()).toBe(originalPixels);
  const pending = page.waitForEvent('download');
  await (await menuCommand(page, '保存')).click();
  const data = JSON.parse((await readFile((await (await pending).path())!)).toString());
  const specs = Object.values(data.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter((layer: any) => layer.type === 'decoration').map((layer: any) => layer.spec) as any[];
  expect(specs).toHaveLength(2);
  expect(specs.find((spec) => spec.kind === 'speed')).toMatchObject({ count: 30, angleDeg: 90 });
  expect(specs.find((spec) => spec.kind === 'focus')).toMatchObject({ count: 48, innerRatio: 0.7 });
    expect(Object.values(data.project.layers).find((l:any)=>l.type==='text'&&l.role==='sfx')).toMatchObject({text:{content:'轰！'},effects:{recipe:'layout'}});
    await page.locator('input[type=file][accept=".json,.Comia.json"]').setInputFiles({ name: 'decorations.Comia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await waitForProjectIO(page);
    expect(await renderedHash()).toBe(originalPixels);
});

test('tail base drag changes attachment without moving the bubble and undoes in one step', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  expect(rect).not.toBeNull();
  const x = rect!.x + rect!.width / 2, y = rect!.y + rect!.height / 2;
  await dragComponent(page, '对白气泡', x, y);
  await page.getByRole('button', { name: '三角尾' }).click();
  const saveBubble = async () => {
    const pending = page.waitForEvent('download');
    await (await menuCommand(page, '保存')).click();
    const data = JSON.parse((await readFile((await (await pending).path())!)).toString());
    const bubble:any=Object.values(data.project.layers).find((layer:any)=>layer.type==='bubble'),tail=bubble.children.map((id:string)=>data.project.layers[id]).find((l:any)=>l.type==='bubbleTail');if(!tail)throw Error('Missing independent tail');return {...bubble,tail:{...tail.attachment,tip:tail.tip}};
  };
  const initial = await saveBubble();
  const zoom = parseInt((await page.locator('.zoom-readout').innerText()), 10) / 100;
  const base=(await page.getByLabel('尾巴底座',{exact:true}).boundingBox())!;const baseX=base.x+base.width/2,baseY=base.y+base.height/2;await page.mouse.move(baseX,baseY);
  await page.mouse.down();
  await page.mouse.move(baseX+70*zoom,baseY,{steps:8});
  await page.mouse.up();
  const moved = await saveBubble();
  expect(moved.tail.attachU).not.toBe(initial.tail.attachU);
  expect(moved.matrix).toEqual(initial.matrix);
  await (await menuCommand(page, '撤销')).click();
  const restored = await saveBubble();
  expect(restored.tail).toEqual(initial.tail);
});

test('resizing a bubble updates its text safe box in the same undo step', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  const x = rect!.x + rect!.width / 2, y = rect!.y + rect!.height / 2;
  await dragComponent(page, '对白气泡', x, y);
  const zoom = parseInt((await page.locator('.zoom-readout').innerText()), 10) / 100;
  const corner = { x: x + 150 * zoom, y: y + 90 * zoom };
  await page.mouse.move(corner.x, corner.y); await page.mouse.down(); await page.mouse.move(corner.x + 20, corner.y + 14, { steps: 4 }); await page.mouse.up();
  const snapshot = async () => {
    const pending = page.waitForEvent('download');
    await (await menuCommand(page, '保存')).click();
    const data = JSON.parse((await readFile((await (await pending).path())!)).toString());
    const bubble = Object.values(data.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((layer: any) => layer.type === 'bubble') as any;
    return { width: bubble.width, height: bubble.height, box: data.project.layers[bubble.children[0]].box };
  };
  const resized = await snapshot();
  expect(resized.width).toBeGreaterThan(300);
  expect(resized.height).toBeGreaterThan(180);
  expect(resized.box.width).toBeGreaterThan(200);
  await (await menuCommand(page, '撤销')).click();
  const original = await snapshot();
  expect(original.width).toBe(300);
  expect(original.height).toBe(180);
  expect(original.box.width).toBeLessThan(resized.box.width);
});

test('text direction and alignment edits are undoable without changing content', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  await dragComponent(page, '文字', rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
  await page.getByLabel('文字方向').selectOption('vertical');
  await page.getByLabel('文字对齐').selectOption('center');
  const snapshot = async () => {
    const pending = page.waitForEvent('download');
    await (await menuCommand(page, '保存')).click();
    const data = JSON.parse((await readFile((await (await pending).path())!)).toString());
    return Object.values(data.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((layer: any) => layer.type === 'text') as any;
  };
  const vertical = await snapshot();
  expect(vertical.text.direction).toBe('vertical');
  expect(vertical.text.align).toBe('center');
  await (await menuCommand(page, '撤销')).click();
  await (await menuCommand(page, '撤销')).click();
  const original = await snapshot();
  expect(original.text.direction).toBe('horizontal');
  expect(original.text.content).toBe(vertical.text.content);
});

test('copying a panel-owned image makes an independent image sharing the same asset', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  const x = rect!.x + rect!.width / 2, y = rect!.y + rect!.height / 2;
  await dragComponent(page, '矩形分镜', x, y);
  await page.evaluate(async ({ x, y }) => {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
    const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'owned.png', { type: 'image/png' }));
    document.querySelector('.canvas-viewport')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
  }, { x, y });
  await page.getByTitle('展开图层').click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
  await page.locator('.layer-row:not([data-layer-type="pageBackground"])').filter({ hasText: '图片' }).locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').click();
  await (await menuCommand(page, '复制')).click();
  await (await menuCommand(page, '粘贴')).click();
  const pending = page.waitForEvent('download');
  await (await menuCommand(page, '保存')).click();
  const data = JSON.parse((await readFile((await (await pending).path())!)).toString());
  const images = Object.values(data.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter((layer: any) => layer.type === 'image') as any[];
  expect(images).toHaveLength(2);
  expect(images[0].assetId).toBe(images[1].assetId);
  expect(Object.keys(data.project.assets)).toHaveLength(1);
  expect(images.filter((image) => image.parentId === null && image.crop === null)).toHaveLength(1);
  expect(images.filter((image) => image.parentId !== null && image.crop !== null)).toHaveLength(1);
});

test('resizing an illustrated panel keeps its image covering the new geometry and undoes together', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  const x = rect!.x + rect!.width / 2, y = rect!.y + rect!.height / 2;
  await dragComponent(page, '矩形分镜', x, y);
  await page.evaluate(async ({ x, y }) => {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
    const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'cover.png', { type: 'image/png' }));
    document.querySelector('.canvas-viewport')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
  }, { x, y });
  await page.getByTitle('展开图层').click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
  await page.locator('.layer-row:not([data-layer-type="pageBackground"])').filter({ hasText: '分镜' }).locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').click();
  const zoom = parseInt((await page.locator('.zoom-readout').innerText()), 10) / 100;
  const corner = { x: x + 300 * zoom, y: y + 200 * zoom };
  await page.mouse.move(corner.x, corner.y); await page.mouse.down(); await page.mouse.move(corner.x + 20, corner.y + 14, { steps: 4 }); await page.mouse.up();
  const snapshot = async () => {
    const pending = page.waitForEvent('download');
    await (await menuCommand(page, '保存')).click();
    const data = JSON.parse((await readFile((await (await pending).path())!)).toString());
    return { panel: Object.values(data.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((layer: any) => layer.type === 'panel') as any, image: Object.values(data.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((layer: any) => layer.type === 'image') as any };
  };
  const resized = await snapshot();
  expect(Math.max(...resized.panel.geometry.map((point: any) => point.x))).toBeGreaterThan(600);
  const crop = resized.image.crop;
  expect(crop.zoom).toBeGreaterThanOrEqual(1);
  const width = Math.max(...resized.panel.geometry.map((point: any) => point.x)) - Math.min(...resized.panel.geometry.map((point: any) => point.x));
  const height = Math.max(...resized.panel.geometry.map((point: any) => point.y)) - Math.min(...resized.panel.geometry.map((point: any) => point.y));
  const scale = Math.max(width / resized.image.width, height / resized.image.height) * crop.zoom;
  const tx = width / 2 - crop.focus.u * resized.image.width * scale;
  const ty = height / 2 - crop.focus.v * resized.image.height * scale;
  expect(tx).toBeLessThanOrEqual(1e-6);
  expect(ty).toBeLessThanOrEqual(1e-6);
  expect(tx + resized.image.width * scale).toBeGreaterThanOrEqual(width - 1e-6);
  expect(ty + resized.image.height * scale).toBeGreaterThanOrEqual(height - 1e-6);
  await (await menuCommand(page, '撤销')).click();
  const original = await snapshot();
  expect(Math.max(...original.panel.geometry.map((point: any) => point.x))).toBe(600);
  expect(original.image.crop).toEqual({ focus: { u: 0.5, v: 0.5 }, zoom: 1 });
});

test('opening preserves unsaved work in its own tab and closing offers cancel or discard for only that comic', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  const x = rect!.x + rect!.width / 2, y = rect!.y + rect!.height / 2;
  await dragComponent(page, '矩形分镜', x, y);
  const pending = page.waitForEvent('download');
  await (await menuCommand(page, '保存')).click();
  const path = await (await pending).path();
  await dragComponent(page, '对白气泡', x + 70, y);
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
  await page.getByLabel('打开项目文件', { exact: true }).setInputFiles(path!);
  await waitForProjectIO(page); await expect(page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab')).toHaveCount(2);
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  await page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab').first().click(); await waitForProjectIO(page);
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
  await page.getByRole('button', { name: '关闭项目 未命名项目', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: '关闭项目', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
  await page.getByRole('button', { name: '关闭项目 未命名项目', exact: true }).first().click();
  await page.getByRole('button', { name: '放弃更改并关闭', exact: true }).click(); await waitForProjectIO(page);
  await expect(page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab')).toHaveCount(1);
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
});

test('an unsaved project can be restored from local recovery after reload', async ({ page }) => {
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  await dragComponent(page, '矩形分镜', rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  await page.waitForTimeout(2600);
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByText('发现本机恢复草稿')).toBeVisible();
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  await expect(page.getByText('发现本机恢复草稿')).toHaveCount(0);
});


test('component drop respects 50 percent zoom and pan, with the whole bubble removed by one undo', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { sessionStore, setViewport } = await import('/src/' + 'state/sessionStore.ts');
    setViewport(sessionStore.getState().activePageId, { zoom: 0.5, pan: { x: -500, y: -400 } });
  });
  await expect(page.locator('.zoom-readout')).toHaveText('50%');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  await dragComponent(page, '对白气泡', rect!.x + 600, rect!.y + 350);
  const snapshot = await page.evaluate(async () => {
    const { getProject } = await import('/src/' + 'state/documentStore.ts');
    return Object.values(getProject().layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').map((layer: any) => ({ type: layer.type, matrix: layer.matrix, width: layer.width, height: layer.height }));
  });
  const bubble = snapshot.find((layer) => layer.type === 'bubble')!;
  expect(bubble.matrix[4] + bubble.width / 2).toBeCloseTo(2200, 6);
  expect(bubble.matrix[5] + bubble.height / 2).toBeCloseTo(1500, 6);
  expect(snapshot).toHaveLength(2);
  await (await menuCommand(page, '撤销')).click();
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(0);
  expect(await page.evaluate(async () => Object.entries((await import('/src/' + 'state/documentStore.ts')).getProject().layers).filter(([, layer]) => (layer as { type: string }).type !== 'pageBackground').map(([id]) => id))).toHaveLength(0);
});

test('pointer cancellation and loss of capture discard the component without consuming a name', async ({ page }) => {
  await page.goto('/');
  const item = page.locator('.library-item').filter({ hasText: '矩形分镜' });
  const rect = await item.boundingBox();
  const sx = rect!.x + rect!.width / 2, sy = rect!.y + rect!.height / 2;
  for (const kind of ['pointercancel', 'capture'] as const) {
    await page.mouse.move(sx, sy); await page.mouse.down();
    await page.mouse.move(sx + 30, sy + 30);
    await expect(page.getByTestId('component-drag-preview')).toBeVisible();
    await item.evaluate(async (element, kind) => {
      const url = performance.getEntriesByType('resource').find((entry) => entry.name.includes('/src/library/creationController.ts'))?.name;
      if (!url) throw Error('应用尚未加载组件拖动模块');
      const { currentCreation } = await import(url);
      const pointerId = currentCreation()!.pointerId;
      if (!element.hasPointerCapture(pointerId)) throw Error('Dragged component does not own pointer capture');
      if (kind === 'capture') element.releasePointerCapture(pointerId);
      else element.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId }));
    }, kind);
    // Chromium processes pending pointer-capture loss at the next pointer event.
    await page.mouse.move(sx + 32, sy + 30);
    await expect(page.getByTestId('component-drag-preview')).toBeHidden();
    await page.mouse.up();
    await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(0);
  }
  await item.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)')).toContainText('分镜 1');
});

test('entering a group creates and selects a centered component within that group and restores it with redo', async ({ page }) => {
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  const x = rect!.x + rect!.width / 2, y = rect!.y + rect!.height / 2;
  await dragComponent(page, '矩形分镜', x - 65, y);
  await dragComponent(page, '矩形分镜', x + 65, y);
  await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').last().click({ modifiers: ['Shift'] });
  await (await menuCommand(page, '编组')).click();
  await page.getByRole('button', { name: '进入组', exact: true }).click();
  await expect(page.getByRole('button', { name: '退出组', exact: true })).toBeVisible();
  await page.locator('.library-item').filter({ hasText: '文字' }).click();
  const read = () => page.evaluate(async () => {
    const { getProject } = await import('/src/' + 'state/documentStore.ts');
    const { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const { worldMatrix, apply } = await import('/src/' + 'geometry/matrix.ts');
    const project = getProject(), id = sessionStore.getState().selection[0], layer = project.layers[id];
    return { parent: layer.parentId, scope: sessionStore.getState().scopeId, roots: project.pages[project.pageOrder[0]].roots.filter((id: string) => project.layers[id].type !== 'pageBackground').length,
      center: layer.type === 'text' ? apply(worldMatrix(project, id), { x: layer.box.x + layer.box.width / 2, y: layer.box.y + layer.box.height / 2 }) : null,
      page: project.pages[project.pageOrder[0]], count: Object.entries(project.layers).filter(([, layer]) => (layer as { type: string }).type !== 'pageBackground').map(([id]) => id).length };
  });
  const placed = await read();
  expect(placed.parent).toBe(placed.scope); expect(placed.roots).toBe(1); expect(placed.count).toBe(4);
  expect(placed.center!.x).toBeCloseTo(placed.page.width / 2); expect(placed.center!.y).toBeCloseTo(placed.page.height / 2);
  await (await menuCommand(page, '撤销')).click();
  expect(await page.evaluate(async () => Object.entries((await import('/src/' + 'state/documentStore.ts')).getProject().layers).filter(([, layer]) => (layer as { type: string }).type !== 'pageBackground').map(([id]) => id).length)).toBe(3);
  await (await menuCommand(page, '重做')).click();
  expect((await read()).parent).toBe(placed.parent);
  await page.getByRole('button', { name: '退出组', exact: true }).click();
  await expect(page.getByRole('button', { name: '退出组', exact: true })).toHaveCount(0);
});

test('a component preview inserted into a lower group remains behind a higher page sibling', async ({ page }) => {
  await page.goto('/');
  const rect = await page.locator('.canvas-viewport').boundingBox();
  const x = rect!.x + rect!.width / 2, y = rect!.y + rect!.height / 2;
  await dragComponent(page, '矩形分镜', x - 70, y); await dragComponent(page, '矩形分镜', x + 70, y);
  await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').last().click({ modifiers: ['Shift'] });
  await (await menuCommand(page, '编组')).click();
  await dragComponent(page, '矩形分镜', x, y);
  await page.getByLabel('填充色RGBA', { exact: true }).fill('#0000FFFF');
  await page.getByLabel('填充色RGBA', { exact: true }).press('Enter');
  // Verify content paint order independently of editor-only numeric aids.
  await page.evaluate(async () => (await import('/src/' + 'state/sessionStore.ts')).sessionStore.setState({ showPanelNumbers: false }));
  await page.locator('.layer-row:not([data-layer-type="pageBackground"])').filter({ hasText: '编组' }).locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').click();
  await page.getByRole('button', { name: '进入组', exact: true }).click();
  const clip = { x: x - 2, y: y - 2, width: 5, height: 5 };
  const before = await page.screenshot({ clip });
  const item = page.locator('.library-item').filter({ hasText: '矩形分镜' });
  const source = await item.boundingBox();
  await page.mouse.move(source!.x + 80, source!.y + 20); await page.mouse.down();
  await page.mouse.move(x, y, { steps: 10 });
  await page.waitForTimeout(80);
  expect(await page.screenshot({ clip })).toEqual(before);
  await page.evaluate(async () => (await import('/src/' + 'state/runtimeStore.ts')).resetRenderStats());
  await page.mouse.move(x + 10, y, { steps: 10 }); await page.waitForTimeout(80);
  const stats = await page.evaluate(async () => (await import('/src/' + 'state/runtimeStore.ts')).runtimeStore.getState().renderStats);
  expect(stats.mainDraws).toBe(0); expect(stats.gestureDraws).toBeGreaterThan(0);
  await page.mouse.up();
  expect(await page.screenshot({ clip })).toEqual(before);
});
