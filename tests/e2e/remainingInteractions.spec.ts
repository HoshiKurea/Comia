import { menuCommand } from './menuHelpers';
import { expect, test } from '@playwright/test';

test('viewport preview exposes page areas that were outside the starting viewport and frees the bitmap', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts');
    const { captureViewport, drawViewportBitmap, releaseViewportBitmap } = await import('/src/' + 'render/viewportBitmap.ts');
    const project = createProject(), pageId = project.pageOrder[0]; Object.assign(project.pages[pageId], { width: 1000, height: 200 });
    const panel = createLayer('panel', pageId); panel.geometry = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }]; panel.matrix = [1, 0, 0, 1, 850, 30]; panel.style.fill = '#FF0000FF'; panel.style.borderWidth = 0; project.layers[panel.id] = panel; project.pages[pageId].roots = [...project.pages[pageId].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...([panel.id])];
    const bitmap = captureViewport(project, pageId, { zoom: 1, pan: { x: 0, y: 0 } }, { x: 200, y: 200 }, new Map());
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 200; const ctx = canvas.getContext('2d')!;
    drawViewportBitmap(ctx, bitmap, { zoom: 1, pan: { x: -800, y: 0 } }); const revealed = [...ctx.getImageData(80, 60, 1, 1).data];
    releaseViewportBitmap(bitmap);
    const huge = captureViewport({ ...project, pages: { [pageId]: { ...project.pages[pageId], width: 16384, height: 16384 } } }, pageId, { zoom: 8, pan: { x: 0, y: 0 } }, { x: 200, y: 200 }, new Map());
    const bytes = huge.canvas.width * huge.canvas.height * 4; releaseViewportBitmap(huge);
    return { revealed, released: [bitmap.canvas.width, bitmap.canvas.height], bytes };
  });
  expect(result.revealed).toEqual([255, 0, 0, 255]); expect(result.released).toEqual([0, 0]); expect(result.bytes).toBeLessThanOrEqual(64 * 1024 * 1024);
});

test('two Edge touch taps edit text once, while dragging and a long interval do not enter text editing', async ({ page, context }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '文字' }).click();
  const point = await page.evaluate(async () => {
    const { getDocument } = await import('/src/' + 'state/documentStore.ts'); const { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const doc = getDocument(), session = sessionStore.getState(), layer = doc.project.layers[session.selection[0]], vp = session.viewportByPage[session.activePageId], rect = document.querySelector('.canvas-viewport')!.getBoundingClientRect();
    return { x: rect.x + vp.pan.x + (layer.matrix[4] + 120) * vp.zoom, y: rect.y + vp.pan.y + (layer.matrix[5] + 60) * vp.zoom };
  });
  const cdp = await context.newCDPSession(page);
  const tap = async () => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  await tap(); await page.waitForTimeout(350); await tap(); await expect(page.getByLabel('编辑文字内容')).toHaveCount(0);
  await page.waitForTimeout(350); await tap(); await tap(); await expect(page.getByLabel('编辑文字内容')).toHaveCount(1);
  await page.keyboard.press('Escape'); await expect(page.getByLabel('编辑文字内容')).toHaveCount(0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + 20, y: point.y, id: 1 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await tap();
  await expect(page.getByLabel('编辑文字内容')).toHaveCount(0); await cdp.detach();
});

test('double-clicking a zero-text bubble drafts a child, Escape discards it, and finishing creates one undoable relation', async ({ page }) => {
  await page.goto('/');
  const point = await page.evaluate(async () => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts'); const { replaceDocument } = await import('/src/' + 'history/commandBus.ts'); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts'); const { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const project = createProject(), id = project.pageOrder[0], bubble = createLayer('bubble', id); Object.assign(project.pages[id], { width: 800, height: 600 }); bubble.matrix = [1, 0, 0, 1, 200, 150]; project.layers[bubble.id] = bubble; project.pages[id].roots = [...project.pages[id].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...([bubble.id])]; replaceDocument(numberFixture(project)); sessionStore.setState({ activePageId: id, viewportByPage: { [id]: { zoom: 1, pan: { x: 20, y: 20 } } } });
    return { x: 380, y: 250 };
  });
  const rect = await page.locator('.canvas-viewport').boundingBox(); const x = rect!.x + point.x, y = rect!.y + point.y;
  await page.mouse.dblclick(x, y); await expect(page.getByLabel('编辑文字内容')).toHaveCount(1);
  await page.getByRole('button', { name: '显示编辑输入', exact: true }).click(); await page.getByLabel('编辑文字内容').fill('取消对白'); await page.keyboard.press('Escape');
  await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
  await page.mouse.dblclick(x, y); await page.getByRole('button', { name: '显示编辑输入', exact: true }).click(); await page.getByLabel('编辑文字内容').fill('新的对白');
  await page.getByLabel('文字字号').fill('40'); await page.getByLabel('文字字号').press('Enter'); await page.getByRole('button', { name: '完成', exact: true }).click();
  const state = () => page.evaluate(async () => { const { getDocument } = await import('/src/' + 'state/documentStore.ts'); const doc = getDocument(); return { past: doc.history.past.length, layers: Object.values(doc.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').map((layer: any) => ({ type: layer.type, children: layer.children, content: layer.text?.content, size: layer.text?.font.size })) }; });
  expect(await state()).toMatchObject({ past: 1, layers: [{ type: 'bubble' }, { type: 'text', content: '新的对白', size: 40 }] });
  await (await menuCommand(page, '撤销')).click(); expect(await state()).toMatchObject({ past: 0, layers: [{ type: 'bubble', children: [] }] });
  await (await menuCommand(page, '重做')).click(); expect((await state()).layers).toHaveLength(2);
});
