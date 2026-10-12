import { menuCommand } from './menuHelpers';
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function state(page: Page) {
  return page.evaluate(async () => {
    const source = (path: string) => performance.getEntriesByType('resource').find((entry) => entry.name.includes(`/src/${path}`))?.name ?? `/src/${path}`;
    const { currentTextEdit } = await import(source('text/editController.ts'));
    const { documentStore } = await import(source('state/documentStore.ts'));
    const { sessionStore } = await import(source('state/sessionStore.ts'));
    const doc = documentStore.getState(), session = sessionStore.getState();
    const layer = Object.values(doc.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((item: any) => item.type === 'text') as any;
    const edit = currentTextEdit();
    return { content: layer?.text.content, text: layer?.text, history: doc.history.past.length, pageId: session.activePageId, edit: edit && { draft: edit.draft, start: edit.selectionStart, end: edit.selectionEnd, composing: edit.composing } };
  });
}
async function createText(page: Page) {
  await page.goto('/');
  await page.locator('.library-item').filter({ hasText: /^文字/ }).click();
  await page.getByRole('button', { name: '编辑文字', exact: true }).click();
  await expect(page.getByLabel('编辑文字内容')).toBeFocused();
}

test('both desktop text entry paths keep native focus and plain Enter in the draft', async ({ page }) => {
  await createText(page);
  const input = page.getByLabel('编辑文字内容');
  for (const entry of ['inspector', 'canvas']) {
    if (entry === 'canvas') {
      await input.press('Escape');
      const point = await page.evaluate(async () => {
        const { getDocument } = await import('/src/' + 'state/documentStore.ts') as typeof import('../../src/state/documentStore');
        const { sessionStore } = await import('/src/' + 'state/sessionStore.ts') as typeof import('../../src/state/sessionStore');
        const { screenMatrix, apply } = await import('/src/' + 'geometry/matrix.ts') as typeof import('../../src/geometry/matrix');
        const doc = getDocument(), layer = Object.values(doc.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((item) => item.type === 'text')!;
        const viewport = sessionStore.getState().viewportByPage[layer.pageId];
        const box = document.querySelector('.canvas-viewport')!.getBoundingClientRect();
        const position = apply(screenMatrix(doc.project, layer.id, viewport), { x: 20, y: 20 });
        return { x: box.x + position.x, y: box.y + position.y };
      });
      await page.mouse.dblclick(point.x, point.y);
    }
    await expect(input).toBeFocused();
    const before = await state(page);
    await page.getByRole('button', { name: '显示编辑输入', exact: true }).click();
    await expect(input).toHaveClass(/visible-input/); await expect(input).toBeFocused();
    await page.keyboard.press('Control+a'); await page.keyboard.type('nihao');
    await page.keyboard.press('Enter');
    await expect(input).toBeFocused(); await expect(input).toHaveValue('nihao\n');
    expect((await state(page)).history).toBe(before.history);
    expect((await state(page)).content).toBe(before.content);
    await page.getByRole('button', { name: '隐藏编辑输入', exact: true }).click();
    await expect(input).toBeFocused();
  }
});

test('starting text in the narrow inspector hands focus to the canvas textarea after closing the drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 }); await page.goto('/');
  await page.getByRole('button', { name: '组件 / 页面', exact: true }).click();
  await page.locator('.library-item').filter({ hasText: /^文字/ }).click();
  await page.getByRole('button', { name: '属性 / 图层', exact: true }).click();
  await page.getByRole('button', { name: '编辑文字', exact: true }).click();
  const input = page.getByLabel('编辑文字内容');
  await expect(page.getByRole('dialog', { name: '属性与图层' })).toHaveCount(0);
  await expect(input).toBeFocused();
  const before = await state(page);
  await page.keyboard.press('Control+a'); await page.keyboard.type('nihao'); await page.keyboard.press('Enter');
  await expect(input).toBeFocused(); await expect(input).toHaveValue('nihao\n');
  expect((await state(page)).history).toBe(before.history);
  await input.press('Escape'); expect((await state(page)).content).toBe(before.content);
});

test('canvas draft updates live without main redraw and content/styles commit and undo together', async ({ page }) => {
  await createText(page);
  const initial = await state(page), input = page.getByLabel('编辑文字内容');
  await page.waitForTimeout(200);
  await page.evaluate(async () => { const { resetRenderStats } = await import('/src/' + 'state/runtimeStore.ts'); resetRenderStats(); });
  await input.fill('你好👩‍🚀\n第二段\n第三段\n第四段\n第五段\n第六段\n第七段\n第八段\n第九段\n第十段');
  await page.getByRole('button', { name: '加粗', exact: true }).click();
  await page.getByLabel('文字方向').selectOption('vertical');
  await expect(page.getByLabel('文字字距')).toBeDisabled();
  const draft = await state(page);
  expect(draft.content).toBe(initial.content); expect(draft.history).toBe(initial.history);
  expect(draft.edit!.draft.font.bold).toBe(true); expect(draft.edit!.draft.direction).toBe('vertical');
  await page.waitForTimeout(150);
  const stats = await page.evaluate(async () => { const { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts'); return runtimeStore.getState().renderStats; });
  expect(stats.mainDraws).toBe(0); expect(stats.gestureDraws).toBeGreaterThan(0);
  await page.screenshot({ path: 'output/playwright/text-edit-vertical.png' });
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(input).toHaveCount(0); expect((await state(page)).history).toBe(initial.history + 1);
  await (await menuCommand(page, '撤销')).click();
  expect((await state(page)).text).toEqual(initial.text);
  await (await menuCommand(page, '重做')).click();
  expect((await state(page)).text.direction).toBe('vertical'); expect((await state(page)).content).toContain('第十段');
});

test('composition blocks Enter completion, canvas shortcuts and page switch until the candidate finishes', async ({ page }) => {
  await createText(page);
  const input = page.getByLabel('编辑文字内容');
  await input.evaluate((node) => node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' })));
  expect((await state(page)).edit?.composing).toBe(true);
  await input.evaluate((node) => { const input = node as HTMLTextAreaElement; input.value = 'nihao'; input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing: true, data: 'nihao' })); });
  await input.press('Control+Enter'); await expect(input).toBeVisible();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByText('请先完成输入法候选，再完成编辑或切换页面', { exact: true })).toBeVisible();
  expect((await state(page)).history).toBe(1);
  await input.fill('你好');
  await input.evaluate((node) => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你好' })));
  await input.press('Control+Enter'); await expect(input).toHaveCount(0);
  expect((await state(page)).content).toBe('你好'); expect((await state(page)).history).toBe(2);
});

test('Escape cancels draft font and text and native undo/delete stay within textarea', async ({ page, browserName }) => {
  await createText(page); const initial = await state(page), input = page.getByLabel('编辑文字内容');
  await input.fill('A😀'); await input.press('End'); await input.press('Backspace');
  await expect(input).toHaveValue('A'); expect((await state(page)).history).toBe(initial.history);
  await input.press('b'); await expect(input).toHaveValue('Ab'); await input.press('Control+z');
  // Firefox keeps insertion/deletion separate; Chromium/WebKit group this adjacent pair.
  if (browserName === 'firefox') { await expect(input).toHaveValue('A'); expect((await state(page)).history).toBe(initial.history); await input.press('Control+z'); }
  await expect(input).toHaveValue('A😀'); expect((await state(page)).history).toBe(initial.history);
  await page.getByLabel('文字颜色').fill('#ff0000');
  expect((await state(page)).edit!.draft.font.color).toBe('#ff0000FF');
  await page.getByRole('button', { name: '加粗', exact: true }).click();
  await input.focus(); await input.press('Escape'); await expect(input).toHaveCount(0);
  expect((await state(page)).text).toEqual(initial.text); expect((await state(page)).history).toBe(initial.history);
});

test('overflow preserves content in saved file and saving commits the active draft first', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await createText(page); const input = page.getByLabel('编辑文字内容'), long = '漫'.repeat(300) + '\n尾部保留 ';
  await input.fill(long);
  await expect(page.getByText('文字溢出 · 超框内容仍可编辑和保存', { exact: true })).toBeVisible();
  await page.getByLabel('文字字号').fill('0'); await page.getByLabel('文字字号').press('Tab');
  await expect(page.getByText('字号1～512、行高1～3、字距-0.2～2倍字号', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download'); await (await menuCommand(page, '保存')).click();
  const artifact = await download, data = JSON.parse(await readFile((await artifact.path())!, 'utf8'));
  const layer = Object.values(data.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((item: any) => item.type === 'text') as any;
  expect(layer.text.content).toBe(long); expect(layer.text.font.size).toBe(32);
  await expect(input).toHaveCount(0); expect((await state(page)).history).toBe(2);
});

test('switching pages commits text once and export snapshots include the draft', async ({ page }) => {
  await createText(page); const input = page.getByLabel('编辑文字内容');
  await input.fill('切页保留');
  await page.getByRole('tab', { name: '页面', exact: true }).click();
  await expect(input).toBeVisible(); await expect(input).toHaveValue('切页保留');
  await page.getByRole('button', { name: '+ 新建漫画页' }).click();
  await expect(input).toHaveCount(0); expect((await state(page)).content).toBe('切页保留');
  await page.locator('.page-item').first().getByRole('button').first().click();
  await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').first().click();
  await page.getByRole('button', { name: '编辑文字', exact: true }).click();
  await input.fill('导出时完成');
  const download = page.waitForEvent('download'); await (await menuCommand(page, 'PNG')).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/); await expect(input).toHaveCount(0);
  expect((await state(page)).content).toBe('导出时完成');
});

test('rotated scaled group glyph clicking and dragging use UTF16 boundaries from shared layout', async ({ page }) => {
  await page.goto('/');
  const fixture = await page.evaluate(async () => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts');
    const { replaceDocument } = await import('/src/' + 'history/commandBus.ts'); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const { beginTextEdit } = await import('/src/' + 'text/editController.ts');
    const { setViewport } = await import('/src/' + 'state/sessionStore.ts') as typeof import('../../src/state/sessionStore');
    const { multiply, rotationRad, scaling, translation, apply, screenMatrix } = await import('/src/' + 'geometry/matrix.ts') as typeof import('../../src/geometry/matrix');
    const { fontCss, awaitFonts } = await import('/src/' + 'text/fonts.ts');
    const { layoutText } = await import('/src/' + 'text/layout.ts');
    const project = createProject(), id = project.pageOrder[0]; project.pages[id].width = project.pages[id].height = 512;
    const group = createLayer('group', id), text = createLayer('text', id); text.parentId = group.id;
    group.matrix = multiply(translation(110, 110), multiply(rotationRad(.35), scaling(1.4, .8))); group.children = [text.id];
    text.text.content = 'A👩‍🚀好'; text.box = { x: 0, y: 0, width: 240, height: 120 };
    project.layers[group.id] = group; project.layers[text.id] = text; project.pages[id].roots = [...project.pages[id].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...([group.id])];
    replaceDocument(numberFixture(project)); const vp = { zoom: 1, pan: { x: 50, y: 30 } }; setViewport(id, vp);
    await awaitFonts(project); beginTextEdit(text.id);
    const ctx = document.createElement('canvas').getContext('2d')!; ctx.font = fontCss(text.text.font.family, 32);
    const cells = layoutText(text.text, text.box, ctx).runs[0].cells, m = screenMatrix(project, text.id, vp);
    return { first: apply(m, { x: cells[0].box.x + .2, y: 15 }), last: apply(m, { x: cells[1].box.x + cells[1].box.width - .2, y: 15 }) };
  });
  await expect(page.getByLabel('编辑文字内容')).toBeFocused();
  const box = await page.locator('.canvas-viewport').boundingBox();
  await page.mouse.move(box!.x + fixture.first.x, box!.y + fixture.first.y); await page.mouse.down();
  await page.mouse.move(box!.x + fixture.last.x, box!.y + fixture.last.y, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await state(page)).edit?.start).toBe(0);
  await expect.poll(async () => (await state(page)).edit?.end).toBe(6);
  await page.getByLabel('编辑文字内容').press('Backspace');
  await expect(page.getByLabel('编辑文字内容')).toHaveValue('好');
  await page.getByLabel('编辑文字内容').press('Escape'); expect((await state(page)).content).toBe('A👩‍🚀好');
});
