import { menuCommand } from './menuHelpers';
import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test('three mixed paper sizes export in narrative order with full white-backed rasters', async ({ page }) => {
  await page.goto('/');
  const artifact = await page.evaluate(async () => {
    const { createProject, createPage, createPageBackground } = await import('/src/' + 'domain/factories.ts');
    const { resolvePageSize } = await import('/src/' + 'pages/commands.ts');
    const { exportPdf } = await import('/src/' + 'export/exportFiles.ts');
    const project = createProject({ background: false }); project.pages = {}; project.pageOrder = [];
    const inputs = [{ preset: 'A4', orientation: 'portrait', dpi: 72 }, { preset: 'B4-ISO', orientation: 'landscape', dpi: 150 }, { preset: 'custom', orientation: 'portrait', dpi: 300, widthPx: 600, heightPx: 900 }] as const;
    const colors = ['#FF0000FF', '#00FF00FF', '#0000FFFF'];
    for (const [i, input] of inputs.entries()) { const size = resolvePageSize(input); if (!size.ok) throw Error(size.problems[0].message); const item = createPage({ name: `Page ${i + 1}` }); Object.assign(item, size.value); const background = createPageBackground(item.id, colors[i]); project.layers[background.id] = background; item.roots = [background.id]; project.pages[item.id] = item; project.pageOrder.push(item.id); }
    // Deliberately oppose names/creation order, and set rtl. PDF must follow pageOrder.
    project.pageOrder = [project.pageOrder[2], project.pageOrder[0], project.pageOrder[1]]; project.settings.readingDirection = 'rtl';
    const result = await exportPdf(project, new Map(), undefined, { scale: .25 }); if (!result.ok) throw Error(result.problems[0].message);
    return { bytes: [...new Uint8Array(await result.value.arrayBuffer())], pages: project.pageOrder.map((id: string) => ({ width: project.pages[id].width, height: project.pages[id].height, dpi: project.pages[id].dpi, color: project.layers[project.pages[id].roots[0]].fill })) };
  });
  expect(artifact.pages.map((p: { color: string }) => p.color)).toEqual(['#0000FFFF', '#FF0000FF', '#00FF00FF']);
  await mkdir('output/playwright', { recursive: true }); await writeFile('output/playwright/export-mixed-paper.pdf', Buffer.from(artifact.bytes)); await writeFile('output/playwright/export-mixed-paper.json', JSON.stringify(artifact.pages));
});

async function cancelPdf(page: Page, phase: 'prepare' | 'render' | 'encode') {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: /^文字/ }).click();
  await expect(page.getByLabel('文字字号')).toBeVisible();
  await page.evaluate(async (phase) => {
    await document.fonts.ready;
    const gate = new Promise<void>((resolve) => { (window as any).releaseExportGate = resolve; });
    const fontsLoad = document.fonts.load.bind(document.fonts), encode = HTMLCanvasElement.prototype.toBlob, read = Blob.prototype.arrayBuffer;
    (window as any).restoreExportGate = () => { document.fonts.load = fontsLoad; HTMLCanvasElement.prototype.toBlob = encode; Blob.prototype.arrayBuffer = read; (window as any).releaseExportGate(); };
    if (phase === 'prepare') document.fonts.load = async (...args) => { await gate; return fontsLoad(...args); };
    if (phase === 'render') HTMLCanvasElement.prototype.toBlob = function (...args) { void gate.then(() => encode.apply(this, args)); };
    if (phase === 'encode') Blob.prototype.arrayBuffer = async function () { if (this.type === 'image/png') await gate; return read.call(this); };
  }, phase);
  let downloads = 0; page.on('download', () => downloads++);
  await (await menuCommand(page, 'PDF')).click();
  const progress = page.getByRole('status', { name: '导出进度', exact: true });
  await expect(progress).toContainText(({ prepare: '准备字体与图片', render: '绘制页面', encode: '编码文件' })[phase]);
  await page.getByRole('button', { name: '取消导出', exact: true }).click();
  await page.evaluate(() => (window as any).restoreExportGate());
  await expect(progress).toHaveCount(0); await expect((await menuCommand(page, 'PDF'))).toBeEnabled();
  expect(downloads).toBe(0);
  await page.getByRole('button', { name: '编辑文字', exact: true }).click(); await page.getByLabel('编辑文字内容').fill(`取消后继续${phase}`); await page.getByLabel('编辑文字内容').press('Control+Enter');
  await (await menuCommand(page, '撤销')).click(); await expect(page.getByRole('button', { name: '编辑文字', exact: true })).toBeEnabled();
  const download = page.waitForEvent('download'); await (await menuCommand(page, 'PDF')).click(); expect((await download).suggestedFilename()).toMatch(/\.pdf$/); expect(downloads).toBe(1);
}
test('PDF prepare cancellation restores UI, retains editable content and does not download', async ({ page }) => cancelPdf(page, 'prepare'));
test('PDF render cancellation restores UI, retains editable content and does not download', async ({ page }) => cancelPdf(page, 'render'));
test('PDF encode cancellation restores UI, retains editable content and does not download', async ({ page }) => cancelPdf(page, 'encode'));

async function failPng(page: Page, fault: 'context-null' | 'security' | 'encode-null') {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  await page.evaluate((fault) => {
    const context = HTMLCanvasElement.prototype.getContext, encode = HTMLCanvasElement.prototype.toBlob;
    (window as any).faultCanvases = [];
    (window as any).restoreExportFault = () => { HTMLCanvasElement.prototype.getContext = context; HTMLCanvasElement.prototype.toBlob = encode; };
    if (fault === 'context-null') HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: any[]) { if (!this.isConnected) { (window as any).faultCanvases.push(this); return null; } return (context as any).apply(this, args); } as typeof context;
    else HTMLCanvasElement.prototype.toBlob = function (callback) { (window as any).faultCanvases.push(this); if (fault === 'security') throw new DOMException('故障注入：编码安全限制', 'SecurityError'); callback(null); };
  }, fault);
  let downloads = 0; page.on('download', () => downloads++); await (await menuCommand(page, 'PNG')).click();
  await expect(page.getByRole('status', { name: '导出进度', exact: true })).toHaveCount(0);
  await expect(page.locator('.notice-stack')).toContainText(fault === 'context-null' ? '无法创建导出画布' : fault === 'security' ? '编码安全限制' : 'PNG编码失败');
  const canvases = await page.evaluate(() => { const sizes = (window as any).faultCanvases.map((canvas: HTMLCanvasElement) => [canvas.width, canvas.height]); (window as any).restoreExportFault(); return sizes; });
  expect(canvases.length).toBeGreaterThan(0); expect(canvases.every((size: number[]) => size[0] === 0 && size[1] === 0)).toBe(true); expect(downloads).toBe(0);
  await page.getByLabel('对象宽', { exact: true }).fill('200'); await page.getByLabel('对象宽', { exact: true }).press('Enter'); await expect(page.getByLabel('对象宽', { exact: true })).toHaveValue('200');
  const download = page.waitForEvent('download'); await (await menuCommand(page, 'PNG')).click(); expect((await download).suggestedFilename()).toMatch(/\.png$/); expect(downloads).toBe(1);
}
test('PNG context-null fault reports failure, releases offscreen canvas and permits a complete retry', async ({ page }) => failPng(page, 'context-null'));
test('PNG security fault reports failure, releases offscreen canvas and permits a complete retry', async ({ page }) => failPng(page, 'security'));
test('PNG encode-null fault reports failure, releases offscreen canvas and permits a complete retry', async ({ page }) => failPng(page, 'encode-null'));
