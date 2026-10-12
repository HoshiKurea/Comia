import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test('styled vertical punctuation uses verified local glyphs, preserves body font, and matches an independent raster and PNG/PDF', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const source = (path: string) => performance.getEntriesByType('resource').find((item) => item.name.includes(`/src/${path}`))?.name ?? `/src/${path}`;
    const { createLayer, createProject } = await import(source('domain/factories.ts'));
    const { replaceDocument } = await import(source('history/commandBus.ts')); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const { sessionStore } = await import(source('state/sessionStore.ts'));
    const { awaitFonts, fontCss } = await import(source('text/fonts.ts'));
    const { layoutText } = await import(source('text/layout.ts'));
    const { drawPage } = await import(source('render/drawScene.ts'));
    const { exportPng, exportPdf } = await import(source('export/exportFiles.ts'));
    const project = createProject(), id = project.pageOrder[0], layer = createLayer('text', id);
    Object.assign(project.pages[id], { width: 160, height: 500, dpi: 72 });
    layer.box = { x: 0, y: 0, width: 128, height: 480 }; layer.matrix = [1, 0, 0, 1, 10, 10];
    layer.text.content = '、，。：；！？（）《》「」『』A中'; layer.text.direction = 'vertical';
    layer.text.font.family = 'serif'; layer.text.font.size = 32; layer.text.font.bold = layer.text.font.italic = true;
    layer.text.align = 'start'; layer.text.lineHeight = 1.2;
    project.layers[layer.id] = layer; project.pages[id].roots = [...project.pages[id].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...([layer.id])]; replaceDocument(numberFixture(project));
    sessionStore.setState({ selection: [layer.id] });
    const loaded = await awaitFonts(project); if (!loaded.ok) throw new Error(loaded.problems[0].message);
    const makeCanvas = () => { const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 500; return canvas; };
    const screen = makeCanvas(), ctx = screen.getContext('2d')!; drawPage(ctx, project, id, new Map());
    const reference = makeCanvas(), ref = reference.getContext('2d')!;
    ref.fillStyle = '#fff'; ref.fillRect(0, 0, 160, 500); ref.translate(10, 10); ref.beginPath(); ref.rect(0, 0, 128, 480); ref.clip();
    ref.fillStyle = '#000'; ref.textAlign = 'center'; ref.textBaseline = 'middle';
    const expectedGlyphs = Array.from('︑︐︒︓︔︕︖︵︶︽︾﹁﹂﹃﹄A中');
    for (let index = 0; index < expectedGlyphs.length; index++) {
      const column = Math.floor(index / 15), row = index % 15;
      ref.font = index < 15 ? 'italic 700 32px "Noto Sans CJK SC", sans-serif' : 'italic 700 32px serif, sans-serif';
      const x = 112 - column * 38.4, y = (row + .5) * 32;
      ref.save(); ref.translate(x, y); if (index === 15) ref.rotate(Math.PI / 2); ref.fillText(expectedGlyphs[index], 0, 0); ref.restore();
    }
    const pixels = (canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(0, 0, 160, 500).data;
    const mismatch = (first: Uint8ClampedArray, second: Uint8ClampedArray) => first.reduce((sum, value, index) => sum + Number(value !== second[index]), 0);
    const warnings: string[] = [], png = await exportPng(project, id, new Map(), undefined, { onWarning: (value: string) => warnings.push(value) });
    const pdf = await exportPdf(project, new Map()); if (!png.ok || !pdf.ok) throw new Error('export failed');
    const pngCanvas = makeCanvas(), bitmap = await createImageBitmap(png.value); pngCanvas.getContext('2d')!.drawImage(bitmap, 0, 0); bitmap.close();
    ctx.font = fontCss('serif', 32, true, true); const layout = layoutText(layer.text, layer.box, ctx);
    return { referenceMismatch: mismatch(pixels(screen), pixels(reference)), pngMismatch: mismatch(pixels(screen), pixels(pngCanvas)),
      cells: layout.runs.flatMap((run: any) => run.cells).map((cell: any) => ({ glyph: cell.glyph, fontFamily: cell.fontFamily, rotation: cell.rotation })),
      warnings, requested: layer.text.font.family, png: [...new Uint8Array(await png.value.arrayBuffer())], pdf: [...new Uint8Array(await pdf.value.arrayBuffer())] };
  });
  expect(result.referenceMismatch).toBe(0); expect(result.pngMismatch).toBe(0); expect(result.requested).toBe('serif');
  expect(result.cells.slice(0, 15).every((cell: { fontFamily?: string; rotation: number }) => cell.fontFamily === 'Noto Sans CJK SC' && cell.rotation === 0)).toBe(true);
  expect(result.cells[15]).toEqual({ glyph: 'A', rotation: Math.PI / 2 }); expect(result.cells[16]).toEqual({ glyph: '中', rotation: 0 });
  expect(result.warnings).toHaveLength(1); expect(result.warnings[0]).toContain('竖排标点');
  await expect(page.locator('.text-glyph-status')).toContainText('使用本地Noto Sans CJK SC');
  await expect(page.getByLabel('文字字体')).toHaveValue('serif');
  await mkdir('output/playwright', { recursive: true });
  await writeFile('output/playwright/vertical-font.png', Buffer.from(result.png)); await writeFile('output/playwright/vertical-font.pdf', Buffer.from(result.pdf));
});

test('generic vertical text still waits for bundled punctuation and cancellation prevents premature output', async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/fonts/NotoSansCJKsc-Regular.otf', async (route) => { await gate; await route.continue(); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  try {
    await page.evaluate(async () => {
      const source = (path: string) => performance.getEntriesByType('resource').find((item) => item.name.includes(`/src/${path}`))?.name ?? `/src/${path}`;
      const { createLayer, createProject } = await import(source('domain/factories.ts'));
      const { exportPng } = await import(source('export/exportFiles.ts'));
      const project = createProject(), id = project.pageOrder[0], layer = createLayer('text', id);
      layer.text.content = '（A）'; layer.text.direction = 'vertical'; layer.text.font.family = 'serif';
      project.layers[layer.id] = layer; project.pages[id].roots = [...project.pages[id].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...([layer.id])];
      const controller = new AbortController(); document.documentElement.dataset.verticalExport = 'pending';
      document.addEventListener('cancel-vertical-export', () => controller.abort(), { once: true });
      void exportPng(project, id, new Map(), controller.signal).then((result: any) => { document.documentElement.dataset.verticalExport = result.ok ? 'premature-output' : result.problems[0].code; });
    });
    await page.waitForTimeout(500); await expect(page.locator('html')).toHaveAttribute('data-vertical-export', 'pending');
    await page.evaluate(() => document.dispatchEvent(new Event('cancel-vertical-export')));
    await expect(page.locator('html')).toHaveAttribute('data-vertical-export', 'export/cancelled');
  } finally { release(); }
});
