import { expect, test, type Page } from '@playwright/test';
import type { PanelLayer, Project } from '../../src/domain/types';
import { menuCommand } from './menuHelpers';

async function fixture(page: Page) {
  await page.goto('/'); await expect(page.locator('.canvas-viewport')).toBeVisible();
  await page.evaluate(async () => {
    const { createProject } = await import('/src/' + 'domain/factories.ts'), { replaceDocument } = await import('/src/' + 'history/commandBus.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const p = createProject(), id = p.pageOrder[0]; Object.assign(p.pages[id], { width: 900, height: 700 });
    const r = replaceDocument(p); if (!r.ok) throw Error(JSON.stringify(r)); sessionStore.setState({ activePageId: id, selection: [], scopeId: null, snap16: false, viewportByPage: { [id]: { zoom: 1, pan: { x: 10, y: 10 } } } });
    await document.fonts.ready;
  });
}
async function state(page: Page): Promise<{ project: Project; history: number }> { return page.evaluate(async () => { const { getDocument } = await import('/src/' + 'state/documentStore.ts'); return { project: getDocument().project, history: getDocument().history.past.length }; }); }
const panels = (p: Project) => Object.values(p.layers).filter((l): l is PanelLayer => l.type === 'panel');
async function dragWindow(page: Page, title: string) {
  const dialog = page.getByRole('dialog', { name: `${title}操作`, exact: true }), handle = dialog.getByRole('button', { name: `移动${title}浮窗`, exact: true });
  await expect(dialog).toBeVisible(); expect(await dialog.getAttribute('aria-modal')).toBeNull();
  const before = await state(page), initial = (await dialog.boundingBox())!, canvas = (await page.locator('.canvas-viewport').boundingBox())!, box = (await handle.boundingBox())!;
  expect(initial.y).toBeLessThan(canvas.y + canvas.height / 3);
  await page.evaluate(async () => { await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))); (await import('/src/' + 'state/runtimeStore.ts')).resetRenderStats(); });
  await page.mouse.move(box.x + 22, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x - 180, box.y + 210, { steps: 20 }); await page.mouse.up();
  const moved = (await dialog.boundingBox())!; expect(moved.y).toBeGreaterThan(initial.y + 50); expect(moved.x).toBeGreaterThanOrEqual(canvas.x); expect(moved.y + moved.height).toBeLessThanOrEqual(canvas.y + canvas.height + 1);
  expect(await state(page)).toEqual(before); expect(await page.evaluate(async () => (await import('/src/' + 'state/runtimeStore.ts')).runtimeStore.getState().renderStats.mainDraws)).toBe(0);
  return dialog;
}

test('eight-cell grid and presets create only independently editable panels with atomic undo', async ({ page }) => {
  await fixture(page); const before = await state(page); await page.getByRole('button', { name: '行列等分', exact: true }).click(); const settings = page.getByRole('dialog', { name: '行列等分', exact: true });
  await settings.getByLabel('等分行数').fill('2'); await settings.getByLabel('等分列数').fill('4'); await expect(settings.locator('polygon')).toHaveCount(8); await settings.getByRole('button', { name: '应用分格' }).click();
  const after = await state(page), frames = panels(after.project); expect(frames).toHaveLength(8); expect(frames.every(p => p.role === 'leaf' && p.parentId === null)).toBe(true); expect(frames.map(p => p.editorNumber)).toEqual([4, 3, 2, 1, 8, 7, 6, 5]);
  await expect(page.locator('.layer-row[data-layer-type=panel]')).toHaveCount(8); expect(after.history).toBe(before.history + 1);
  await page.locator(`.layer-row[data-layer-id="${frames[3].id}"] .layer-name`).click(); await page.getByLabel('对象边框', { exact: true }).fill('13'); await page.getByLabel('对象边框', { exact: true }).press('Enter');
  const edited = await state(page); expect((edited.project.layers[frames[3].id] as PanelLayer).style.borderWidth).toBe(13); for (const p of frames.filter(p => p.id !== frames[3].id)) expect(edited.project.layers[p.id]).toEqual(p);
  await (await menuCommand(page, '撤销')).click(); expect(await state(page)).toEqual(after); await (await menuCommand(page, '撤销')).click(); expect(await state(page)).toEqual(before);
  await page.getByRole('button', { name: '六格横版', exact: true }).click(); expect(panels((await state(page)).project)).toHaveLength(6); expect(panels((await state(page)).project).every(p => p.parentId === null && p.role === 'leaf')).toBe(true);
});
test('creation reuses only a deleted tail, retains middle gaps and obeys restored history', async ({ page }) => {
  await fixture(page); for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '矩形分镜', exact: true }).click(); const first = panels((await state(page)).project);
  const remove = async (ids: string[]) => { await page.evaluate(async ids => (await import('/src/' + 'state/sessionStore.ts')).sessionStore.setState({ selection: ids }), ids); await page.keyboard.press('Delete'); };
  await remove([first[1].id]); await page.getByRole('button', { name: '矩形分镜', exact: true }).click(); expect(panels((await state(page)).project).map(p => p.editorNumber)).toEqual([1, 3, 4, 5]);
  await (await menuCommand(page, '撤销')).click(); await remove([first[2].id, first[3].id]); await page.getByRole('button', { name: '矩形分镜', exact: true }).click(); expect(panels((await state(page)).project).map(p => p.editorNumber)).toEqual([1, 2]);
  await (await menuCommand(page, '撤销')).click(); await (await menuCommand(page, '撤销')).click(); await page.getByRole('button', { name: '矩形分镜', exact: true }).click(); expect(panels((await state(page)).project).map(p => p.editorNumber)).toEqual([1, 3, 4, 5]);
  await remove(panels((await state(page)).project).map(p => p.id)); await page.getByRole('button', { name: '矩形分镜', exact: true }).click(); expect(panels((await state(page)).project).map(p => p.editorNumber)).toEqual([1]);
});
test('visible layer names start at one, reuse a deleted tail and preserve custom names through Delete and undo', async ({ page }) => {
  await fixture(page);
  const names = page.locator('.layer-row[data-layer-type=panel] .layer-name');
  await page.getByRole('button', { name: '上下二格', exact: true }).click();
  expect((await names.allTextContents()).sort()).toEqual(['分镜 1','分镜 2']);
  await page.getByRole('button', { name: '矩形分镜', exact: true }).click(); expect((await names.allTextContents()).sort()).toEqual(['分镜 1','分镜 2','分镜 3']);
  await page.locator('.layer-row[data-layer-type=panel] .layer-name').filter({ hasText: /^分镜 3$/ }).click(); await page.keyboard.press('Delete');
  await page.getByRole('button', { name: '矩形分镜', exact: true }).click(); expect((await names.allTextContents()).sort()).toEqual(['分镜 1','分镜 2','分镜 3']);
  const before = await state(page); await (await menuCommand(page, '撤销')).click(); expect((await names.allTextContents()).sort()).toEqual(['分镜 1','分镜 2']); await (await menuCommand(page, '重做')).click(); expect(await state(page)).toEqual(before);
  const first = names.filter({ hasText: /^分镜 1$/ }); await first.dblclick(); const rename = page.getByLabel('图层名称', { exact: true }); await rename.fill('自定义画面'); await rename.press('Enter');
  await names.filter({ hasText: /^分镜 3$/ }).click(); await page.keyboard.press('Delete'); await page.getByRole('button', { name: '矩形分镜', exact: true }).click();
  expect((await names.allTextContents()).sort()).toEqual(['分镜 2','分镜 3','自定义画面']);
  const current = await state(page); for (const p of panels(current.project).filter(p => p.name !== '自定义画面')) expect(p.name).toBe(`分镜 ${p.editorNumber}`);
});

test('old numeric custom names remain while new names follow the actual live next number', async ({ page }) => {
  await fixture(page); for (let i = 0; i < 2; i++) await page.getByRole('button', { name: '矩形分镜', exact: true }).click();
  await page.evaluate(async () => {
    const { getProject } = await import('/src/' + 'state/documentStore.ts'), { execute } = await import('/src/' + 'history/commandBus.ts'); const p = getProject() as Project;
    const frames = Object.values(p.layers).filter((l): l is PanelLayer => l.type === 'panel');
    const r = execute({ label: '既有偏移名称', context: { pageId: p.pageOrder[0], selection: [] }, mutate(d: Project) { d.schemaVersion=8; frames.forEach((f, i) => { d.layers[f.id].name = `分镜 ${i + 2}`; }); } }); if (!r.ok) throw Error(JSON.stringify(r));
  });
  const names = page.locator('.layer-row[data-layer-type=panel] .layer-name'); expect((await names.allTextContents()).sort()).toEqual(['分镜 2','分镜 3']);
  await names.filter({ hasText: /^分镜 3$/ }).click(); await page.keyboard.press('Delete'); await page.getByRole('button', { name: '矩形分镜', exact: true }).click();
  expect((await names.allTextContents()).sort()).toEqual(['分镜 2','分镜 2']); expect(panels((await state(page)).project).map(p => p.editorNumber)).toEqual([1,2]);
});

test('drawing floating controls move independently, retain review gestures and cancel without history', async ({ page }) => {
  await fixture(page); const before = await state(page); await page.getByRole('button', { name: '多边形分格', exact: true }).click(); const dialog = await dragWindow(page, '分格修正');
  // Move controls below the vertices before drawing; the canvas remains interactive.
  const canvas = (await page.locator('.canvas-viewport').boundingBox())!;
  for (const [x, y] of [[60, 110], [200, 110], [200, 190], [60, 190]]) await page.mouse.click(canvas.x + x, canvas.y + y);
  await page.keyboard.press('Enter'); await expect(page.locator('.panel-contour-point')).toHaveCount(4); await expect(dialog.getByRole('button', { name: '闭合并应用' })).toBeEnabled();
  await dialog.getByRole('button', { name: '取消分格' }).click(); await expect(dialog).toHaveCount(0); expect(await state(page)).toEqual(before);
});
test('text floating controls keep textarea focus and composition behavior, then commit once', async ({ page }) => {
  await fixture(page); await page.getByRole('button', { name: '文字', exact: true }).click(); await page.getByRole('button', { name: '编辑文字', exact: true }).click();
  const input = page.getByLabel('编辑文字内容'); await expect(input).toBeFocused(); const before = await state(page), dialog = await dragWindow(page, '编辑文字');
  await expect(input).toBeFocused(); await dialog.getByRole('button', { name: '显示编辑输入' }).click(); await input.fill('你好'); await input.dispatchEvent('compositionstart'); await input.press('Enter'); await expect(dialog).toBeVisible(); await input.dispatchEvent('compositionend');
  await input.press('Control+Enter'); await expect(dialog).toHaveCount(0); expect((await state(page)).history).toBe(before.history + 1);
});
for (const mode of ['crop', 'mask', 'breakout'] as const) test(`${mode} controls float, preserve draft on window movement and commit or cancel through the original session`, async ({ page }) => {
  await fixture(page); await page.getByRole('button', { name: '矩形分镜', exact: true }).click();
  const ids = await page.evaluate(async () => {
    const { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { decodeImage, placeImage } = await import('/src/' + 'assets/importImage.ts'); const s = sessionStore.getState();
    const c = document.createElement('canvas'); c.width = 600; c.height = 400; c.getContext('2d')!.fillRect(0, 0, 600, 400); const blob = await new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/png')); const decoded = await decodeImage(new File([blob], 'float.png', { type: 'image/png' }), new AbortController().signal); if (!decoded.ok) throw Error('decode');
    const panelId = s.selection[0], made = placeImage(decoded.value, s.activePageId, { x: 0, y: 0 }, panelId); if (!made.ok) throw Error(JSON.stringify(made)); return { panelId, imageId: made.value };
  });
  const before = await state(page);
  const begin = () => page.evaluate(async ({ mode, ids }) => {
    const result = mode === 'crop' ? (await import('/src/' + 'images/cropController.ts')).beginCropEdit(ids.panelId) : mode === 'mask' ? (await import('/src/' + 'images/maskController.ts')).beginMaskEdit(ids.imageId) : (await import('/src/' + 'images/breakoutController.ts')).beginBreakoutEdit(ids.imageId);
    if (!result.ok) throw Error(JSON.stringify(result));
  }, { mode, ids });
  await begin(); const title = mode === 'crop' ? '图片裁剪' : mode === 'mask' ? '编辑图片与遮罩' : '局部破格区域', dialog = await dragWindow(page, title);
  await dialog.getByRole('button', { name: mode === 'crop' ? '取消' : mode === 'mask' ? '取消遮罩编辑' : '取消局部破格', exact: true }).click(); expect(await state(page)).toEqual(before);
  await begin(); const reopened = page.getByRole('dialog', { name: `${title}操作`, exact: true });
  if (mode === 'crop') { const input = reopened.getByLabel('裁剪缩放倍数'); await input.fill('2'); await input.press('Tab'); }
  await reopened.getByRole('button', { name: mode === 'crop' ? '完成裁剪' : mode === 'mask' ? '完成遮罩' : '完成局部破格', exact: true }).click(); await expect(reopened).toHaveCount(0); expect((await state(page)).history).toBe(before.history + 1);
});
for (const kind of ['shape', 'tail'] as const) test(`${kind} manga controls float and keep one-step preview commits`, async ({ page }) => {
  await fixture(page); await page.getByRole('button', { name: kind === 'shape' ? '柔和手绘气泡' : '短直尾', exact: true }).click();
  await page.evaluate(async kind => { const { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { beginMangaEdit } = await import('/src/' + 'bubbles/mangaEditController.ts'); const r = beginMangaEdit(sessionStore.getState().selection[0], kind); if (!r.ok) throw Error(JSON.stringify(r)); }, kind);
  const before = await state(page), dialog = await dragWindow(page, kind === 'shape' ? '气泡轮廓' : '气泡尾巴');
  await dialog.getByRole('button', { name: '取消漫画组件编辑' }).click(); expect(await state(page)).toEqual(before);
});
test('floating controls remain reachable after narrowing the viewport and support precise keyboard movement', async ({ page }) => {
  await fixture(page); await page.getByRole('button', { name: '多边形分格', exact: true }).click(); const dialog = await dragWindow(page, '分格修正'); await page.setViewportSize({ width: 560, height: 640 });
  await page.evaluate(async()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())))); await page.screenshot({path:'output/playwright/panel-floating-narrow.png'});
  await expect.poll(async () => { const canvas = (await page.locator('.canvas-viewport').boundingBox())!, box = (await dialog.boundingBox())!; return box.x >= canvas.x && box.x + box.width <= canvas.x + canvas.width + 1 && box.y + box.height <= canvas.y + canvas.height + 1; }).toBe(true);
  const handle = dialog.getByRole('button', { name: '移动分格修正浮窗' }); await handle.focus(); const before = (await dialog.boundingBox())!; await handle.press('Shift+ArrowUp'); expect((await dialog.boundingBox())!.y).toBeCloseTo(before.y - 1); await dialog.getByRole('button', { name: '取消分格' }).click(); await expect(dialog).toHaveCount(0);
});
