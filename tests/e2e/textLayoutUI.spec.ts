import { menuCommand } from './menuHelpers';
import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.goto('/');
  await expect((await menuCommand(page, '保存'))).toBeVisible();
  await page.evaluate(async () => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts');
    const { replaceDocument } = await import('/src/' + 'history/commandBus.ts'); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const { setSelection, setViewport } = await import('/src/' + 'state/sessionStore.ts');
    const { awaitFonts } = await import('/src/' + 'text/fonts.ts');
    const project = createProject({ background: false }), id = project.pageOrder[0], text = createLayer('text', id);
    project.pages[id].width = project.pages[id].height = 500;
    text.matrix = [1, 0, 0, 1, 40, 40]; text.box = { x: 0, y: 0, width: 160, height: 360 };
    text.text.content = '漫画测试'.repeat(6); text.text.font.size = 16;
    project.layers[text.id] = text; project.pages[id].roots = [...project.pages[id].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...([text.id])];
    replaceDocument(numberFixture(project)); setViewport(id, { zoom: 1, pan: { x: 0, y: 0 } }); setSelection([text.id], text.id);
    const fonts = await awaitFonts(project); if (!fonts.ok) throw Error(fonts.problems[0].message);
  });
  await expect(page.getByLabel('文字字号')).toHaveValue('16');
}

async function inspect(page: Page) {
  return page.evaluate(async () => {
    // Wait for the actual Konva content layer to paint after the control transaction.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const { getDocument } = await import('/src/' + 'state/documentStore.ts');
    const { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const { compileScene } = await import('/src/' + 'render/compileScene.ts');
    const { awaitFonts, snapshotSceneFonts } = await import('/src/' + 'text/fonts.ts');
    const { exportPng } = await import('/src/' + 'export/exportFiles.ts');
    const doc = getDocument(), pageId = doc.project.pageOrder[0], id = doc.project.pages[pageId].roots[0];
    const layer = doc.project.layers[id]; if (layer.type !== 'text') throw Error('Missing text fixture');
    const fonts = await awaitFonts(doc.project); if (!fonts.ok) throw Error(fonts.problems[0].message);
    const interactive = compileScene(doc.project, pageId, snapshotSceneFonts(doc.project, pageId), { snapshot: false }).text.text.get(id)!;
    const frozen = compileScene(doc.project, pageId, fonts.value).text.text.get(id)!;
    const png = await exportPng(doc.project, pageId, new Map()); if (!png.ok) throw Error(png.problems[0].message);
    const canvas = document.querySelector<HTMLCanvasElement>('.konvajs-content canvas')!;
    const crop = document.createElement('canvas'); crop.width = crop.height = 500; crop.getContext('2d')!.drawImage(canvas, 0, 0);
    const screenPng = await new Promise<Blob>((resolve) => crop.toBlob((blob) => resolve(blob!), 'image/png'));
    const pixels = async (blob: Blob) => { const bitmap = await createImageBitmap(blob); const c = document.createElement('canvas'); c.width = c.height = 500; c.getContext('2d')!.drawImage(bitmap, 0, 0); bitmap.close(); return c.getContext('2d')!.getImageData(0, 0, 500, 500).data; };
    const screen = await pixels(screenPng), exported = await pixels(png.value);
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', exported))].map((n) => n.toString(16).padStart(2, '0')).join('');
    const measure = crop.getContext('2d')!; measure.font = interactive.font;
    return { content: layer.text.content, direction: layer.text.direction, box: layer.box, size: layer.text.font.size, align: layer.text.align,
      history: doc.history.past.length, viewport: sessionStore.getState().viewportByPage[pageId], layout: interactive.layout,
      frozen: frozen.layout, measure: measure.measureText('漫').width, exactScreenExport: screen.every((value, index) => value === exported[index]), digest };
  });
}

test('width, font-size and three align controls reflow Chinese with measured line breaks and exact screen/export pixels', async ({ page }) => {
  await setup(page);
  let previousWidthRows = 0;
  for (const width of [160, 80]) {
    await page.getByLabel('对象宽', { exact: true }).fill(String(width)); await page.getByLabel('对象宽', { exact: true }).press('Enter');
    let previousSizeRows = 0;
    for (const size of [16, 32, 64]) {
      await page.getByLabel('文字字号').fill(String(size)); await page.getByLabel('文字字号').press('Enter');
      for (const align of ['start', 'center', 'end']) {
        await page.getByLabel('文字对齐').selectOption(align);
        const actual = await inspect(page), count = Math.max(1, Math.floor(width / size)), expected: string[] = [];
        for (let i = 0; i < actual.content.length; i += count) expected.push(actual.content.slice(i, i + count));
        expect(actual.measure).toBeCloseTo(size, 5); expect(actual.layout.runs.map((run: { text: string }) => run.text)).toEqual(expected);
        expect(actual.frozen).toEqual(actual.layout); expect(actual.exactScreenExport).toBe(true);
        for (const run of actual.layout.runs) expect(run.origin.x).toBeCloseTo(align === 'start' ? 0 : (width - run.text.length * size) / (align === 'center' ? 2 : 1), 5);
        if (align === 'start') { expect(actual.layout.runs.length).toBeGreaterThanOrEqual(previousSizeRows); previousSizeRows = actual.layout.runs.length; }
      }
    }
    const final = await inspect(page); expect(final.layout.runs.length).toBeGreaterThanOrEqual(previousWidthRows); previousWidthRows = final.layout.runs.length;
  }
  await expect(page.getByText('文字溢出 · 超框内容仍可编辑和保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑文字', exact: true }).click(); await page.getByLabel('编辑文字内容').press('End'); await page.getByLabel('编辑文字内容').pressSequentially('尾');
  await expect(page.getByLabel('编辑文字内容')).toHaveValue('漫画测试'.repeat(6) + '尾');
});

test('vertical direction undo restores exact Chinese horizontal breaks and screen pixels after the size control reflows', async ({ page }) => {
  await setup(page); const before = await inspect(page);
  await page.getByLabel('文字字号').fill('32'); await page.getByLabel('文字字号').press('Enter'); const larger = await inspect(page);
  expect(larger.layout.runs.length).toBeGreaterThan(before.layout.runs.length); expect(larger.exactScreenExport).toBe(true);
  await page.getByLabel('文字方向').selectOption('vertical'); const vertical = await inspect(page);
  expect(vertical.direction).toBe('vertical'); expect(vertical.content).toBe(larger.content); expect(vertical.frozen).toEqual(vertical.layout); expect(vertical.exactScreenExport).toBe(true);
  await (await menuCommand(page, '撤销')).click(); const restored = await inspect(page);
  expect(restored.direction).toBe('horizontal'); expect(restored.layout).toEqual(larger.layout); expect(restored.digest).toBe(larger.digest); expect(restored.exactScreenExport).toBe(true);
  await (await menuCommand(page, '撤销')).click(); const original = await inspect(page);
  expect(original.layout).toEqual(before.layout); expect(original.digest).toBe(before.digest); expect(original.history).toBe(before.history);
});
