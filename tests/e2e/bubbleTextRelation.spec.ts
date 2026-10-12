import { menuCommand } from './menuHelpers';
import { expect, test, type Page } from '@playwright/test';
import type { DocumentStoreState } from '../../src/state/documentStore';

async function fixture(page: Page) {
  await page.goto('/');
  await expect.poll(() => page.evaluate(async () => {
    const { getProject } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    return Boolean(getProject().pages[sessionStore.getState().activePageId]);
  })).toBe(true);
  return page.evaluate(async () => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts'), { replaceDocument } = await import('/src/' + 'history/commandBus.ts'); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { buildBubble } = await import('/src/' + 'bubbles/geometry.ts'), { awaitFonts } = await import('/src/' + 'text/fonts.ts');
    const project = createProject(), pageId = project.pageOrder[0], bubble = createLayer('bubble', pageId, '验收气泡'), text = createLayer('text', pageId, '验收对白');
    Object.assign(project.pages[pageId], { width: 800, height: 600 });
    bubble.matrix = [1, 0, 0, 1, 200, 160]; bubble.shape = 'roundRect'; bubble.width = 300; bubble.height = 180; 
    const geometry = buildBubble(bubble.shape, bubble.width, bubble.height, bubble.style, null); if (!geometry.ok) throw Error(JSON.stringify(geometry.problems));
    text.parentId = bubble.id; text.box = geometry.value.textBox; text.bubbleFrame={mode:'manual',manualSize:{width:text.box.width,height:text.box.height},placement:'center'}; text.text.font.size = 28; text.text.align = 'center'; text.text.content = '这是一段用于气泡关联验收的中文对白。'.repeat(2);
    bubble.children = [text.id]; project.layers[bubble.id] = bubble; project.layers[text.id] = text; project.pages[pageId].roots = [...project.pages[pageId].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...([bubble.id])];
    const ready = await awaitFonts(project); if (!ready.ok) throw Error(JSON.stringify(ready.problems));
    const result = replaceDocument(numberFixture(project)); if (!result.ok) throw Error(JSON.stringify(result.problems));
    sessionStore.setState({ activePageId: pageId, selection: [bubble.id], scopeId: null, toolMode: 'select', snap16: false, expanded: [bubble.id], viewportByPage: { [pageId]: { zoom: 1, pan: { x: 20, y: 20 } } } });
    return { bubble: bubble.id, text: text.id };
  });
}
async function inspect(page: Page) {
  return page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const { getDocument } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const { compileScene } = await import('/src/' + 'render/compileScene.ts'), { snapshotSceneFonts } = await import('/src/' + 'text/fonts.ts');
    const { drawPage } = await import('/src/' + 'render/drawScene.ts'), { buildBubble } = await import('/src/' + 'bubbles/geometry.ts');
    const doc = getDocument() as DocumentStoreState, session = sessionStore.getState(), pageId = session.activePageId;
    const bubble = Object.values(doc.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((layer) => layer.type === 'bubble')!; if (bubble.type !== 'bubble') throw Error('Missing bubble');
    const text = doc.project.layers[bubble.children[0]]; if (text.type !== 'text') throw Error('Missing main text');
    const layout = compileScene(doc.project, pageId, snapshotSceneFonts(doc.project, pageId), { snapshot: false }).text.text.get(text.id)?.layout ?? null;
    const main = document.querySelector<HTMLCanvasElement>('.konvajs-content canvas')!;
    const pixels = main.getContext('2d')!.getImageData(0, 0, main.width, main.height).data;
    const reference = document.createElement('canvas'); reference.width = main.width; reference.height = main.height;
    const ctx = reference.getContext('2d')!, vp = session.viewportByPage[pageId]; ctx.scale(window.devicePixelRatio, window.devicePixelRatio); ctx.translate(vp.pan.x, vp.pan.y); ctx.scale(vp.zoom, vp.zoom);
    const bodyOnly = structuredClone(doc.project); bodyOnly.layers[text.id].visible = false; drawPage(ctx, bodyOnly, pageId, new Map());
    const body = ctx.getImageData(0, 0, reference.width, reference.height).data;
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map((value) => value.toString(16).padStart(2, '0')).join('');
    const bodyDiff = pixels.reduce((count, value, index) => count + Number(value !== body[index]), 0);
    reference.width = reference.height = 0;
    return { project: doc.project, history: doc.history, bubble, text, layout, digest, bodyDiff, geometry: buildBubble(bubble.shape, bubble.width, bubble.height, bubble.style, bubble.tail) };
  });
}

test('narrowing a bubble preserves its manual dialogue frame and clips overflow without changing font and one undo restores all layout and pixels', async ({ page }) => {
  await fixture(page); const before = await inspect(page);
  await page.getByLabel('对象宽', { exact: true }).fill('160'); await page.getByLabel('对象宽', { exact: true }).press('Enter');
  const after = await inspect(page); expect(after.bubble.width).toBe(160); expect(after.text.text).toEqual(before.text.text); expect(after.text.matrix).toEqual(before.text.matrix);
  expect(after.layout?.runs.length).toBe(before.layout!.runs.length); expect(after.text.bubbleFrame).toEqual(before.text.bubbleFrame);expect(after.text.box.width).toBeCloseTo(before.text.box.width,6);expect(after.layout?.safeClipBox!.width).toBeLessThan(before.layout!.safeClipBox!.width);expect(after.layout?.overflow).toBe(true);
  expect(after.history.past.length).toBe(before.history.past.length + 1);
  await (await menuCommand(page, '撤销')).click(); const undone = await inspect(page);
  expect(undone.project).toEqual(before.project); expect(undone.layout).toEqual(before.layout); expect(undone.digest).toBe(before.digest);
  await (await menuCommand(page, '重做')).click(); const redone = await inspect(page); expect(redone.project).toEqual(after.project); expect(redone.layout).toEqual(after.layout); expect(redone.digest).toBe(after.digest);
});

test('hiding only the main text leaves exact body pixels and showing it then double-clicking preserves the original dialogue', async ({ page }) => {
  await fixture(page); const before = await inspect(page), row = page.locator('.layer-row:not([data-layer-type="pageBackground"])').filter({ has: page.getByRole('button', { name: '验收对白', exact: true }) });
  expect(before.bodyDiff).toBeGreaterThan(0);
  await row.getByRole('button', { name: '隐藏', exact: true }).click(); const hidden = await inspect(page);
  expect(hidden.bodyDiff).toBe(0); expect(hidden.layout).toBeNull(); expect(hidden.bubble).toEqual(before.bubble); expect(hidden.text.visible).toBe(false); expect(hidden.text.text).toEqual(before.text.text);
  expect(hidden.geometry).toEqual(before.geometry); expect(hidden.project.pages).toEqual(before.project.pages);
  await row.getByRole('button', { name: '显示', exact: true }).click(); const shown = await inspect(page); expect(shown.digest).toBe(before.digest); expect(shown.text.text).toEqual(before.text.text);
  const rect = (await page.locator('.canvas-viewport').boundingBox())!;
  await page.mouse.dblclick(rect.x + 370, rect.y + 270); await expect(page.getByLabel('编辑文字内容')).toHaveValue(before.text.text.content);
  await page.getByRole('button', { name: '显示编辑输入', exact: true }).click(); await page.getByLabel('编辑文字内容').fill('临时修改'); await page.keyboard.press('Escape');
  const cancelled = await inspect(page); expect(cancelled.project).toEqual(shown.project); expect(cancelled.history).toEqual(shown.history); expect(cancelled.digest).toBe(shown.digest);
});

test('changing bubble shape updates the safe box and undo restores the original box, line breaks and exact scene', async ({ page }) => {
  await fixture(page); const before = await inspect(page);
  await page.locator('.bubble-select select').selectOption('cloud'); const changed = await inspect(page);
  const halfW = 300 / 2 * (.92 / 1.08) / Math.SQRT2 - 12, halfH = 180 / 2 * (.92 / 1.08) / Math.SQRT2 - 12;
  expect(changed.bubble.shape).toBe('cloud'); expect(changed.geometry.ok && changed.geometry.value.textBox.x).toBeCloseTo(150 - halfW, 6); expect(changed.geometry.ok && changed.geometry.value.textBox.y).toBeCloseTo(90 - halfH, 6);
  expect(changed.geometry.ok && changed.geometry.value.textBox.width).toBeCloseTo(2 * halfW, 6); expect(changed.geometry.ok && changed.geometry.value.textBox.height).toBeCloseTo(2 * halfH, 6); expect(changed.text.text).toEqual(before.text.text);expect(changed.text.bubbleFrame).toEqual(before.text.bubbleFrame);
  expect(changed.history.past.length).toBe(before.history.past.length + 1); expect(changed.layout).not.toEqual(before.layout);
  await (await menuCommand(page, '撤销')).click(); const undone = await inspect(page); expect(undone.project).toEqual(before.project); expect(undone.layout).toEqual(before.layout); expect(undone.digest).toBe(before.digest);
  await (await menuCommand(page, '重做')).click(); const redone = await inspect(page); expect(redone.project).toEqual(changed.project); expect(redone.layout).toEqual(changed.layout); expect(redone.digest).toBe(changed.digest);
});

test('a locked main text rejects parent resize, shape and safe-box radius changes atomically while its own transform controls stay disabled', async ({ page }) => {
  await fixture(page); const row = page.locator('.layer-row:not([data-layer-type="pageBackground"])').filter({ has: page.getByRole('button', { name: '验收对白', exact: true }) });
  await row.locator('button[aria-label="锁定"]:not(.layer-row[data-layer-type="pageBackground"] button)').click(); const locked = await inspect(page);
  for (const operation of ['width', 'shape', 'radius']) {
    if (operation === 'shape') await page.locator('.bubble-select select').selectOption('cloud');
    else { const input = page.getByLabel(operation === 'width' ? '对象宽' : '对象圆角', { exact: true }); await input.fill(operation === 'width' ? '160' : '60'); await input.press('Enter'); }
    await expect(page.locator('.notice.error').last()).toContainText('锁定');
    const after = await inspect(page); expect(after.project).toEqual(locked.project); expect(after.history).toEqual(locked.history); expect(after.digest).toBe(locked.digest);
  }
  await row.getByRole('button', { name: '验收对白', exact: true }).click(); await expect(page.getByLabel('对象X', { exact: true })).toBeDisabled(); await expect(page.getByLabel('对象宽', { exact: true })).toBeDisabled();
  await row.getByRole('button', { name: '解锁', exact: true }).click();
  await expect(page.getByLabel('对象X', { exact: true })).toBeDisabled(); await expect(page.getByLabel('对象宽', { exact: true })).toBeDisabled(); await expect(page.getByLabel('文字字号')).toBeEnabled();
});
