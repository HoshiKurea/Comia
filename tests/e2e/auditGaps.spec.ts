import { menuCommand, waitForProjectIO } from './menuHelpers';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test('rounded empty corners select the visible layer behind them, including inside a transformed group', async ({ page }) => {
  await page.goto('/');
  const checks = await page.evaluate(async () => {
    const source = (path: string) => performance.getEntriesByType('resource').find((entry) => entry.name.includes(`/src/${path}`))?.name ?? `/src/${path}`;
    const { createLayer, createProject } = await import(source('domain/factories.ts')), { hitLayer, pointInsidePanelClips } = await import(source('render/drawScene.ts'));
    const { apply, multiply, rotationRad, translation } = await import(source('geometry/matrix.ts'));
    const project = createProject(), pageId = project.pageOrder[0], group = createLayer('group', pageId), below = createLayer('panel', pageId), top = createLayer('panel', pageId);
    group.matrix = multiply(translation(200, 200), rotationRad(.6)); group.children = [below.id, top.id];
    for (const panel of [below, top]) { panel.parentId = group.id; panel.geometry = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]; project.layers[panel.id] = panel; }
    top.style.borderRadius = 40; top.style.fill = '#FFFFFF00'; project.layers[group.id] = group; project.pages[pageId].roots = [...project.pages[pageId].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...([group.id])];
    const corner = apply(group.matrix, { x: 1, y: 1 }), center = apply(group.matrix, { x: 50, y: 50 });
    return { corner: hitLayer(project, pageId, corner, group.id) === below.id, center: hitLayer(project, pageId, center, group.id) === top.id,
      cropCorner: pointInsidePanelClips(project, top.id, corner), cropCenter: pointInsidePanelClips(project, top.id, center) };
  });
  expect(checks).toEqual({ corner: true, center: true, cropCorner: false, cropCenter: true });
});
test('Escape cancels sound effect input with no transaction, while subsequent blur saves once', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button',{name:'音效字',exact:true}).click();
  await page.getByRole('button',{name:'编辑文字',exact:true}).click();const input=page.getByLabel('编辑文字内容');await input.fill('取消草稿');await input.press('Escape');
  const content=()=>page.evaluate(async()=>{const p=(await import('/src/'+'state/documentStore.ts')).getProject();return Object.values(p.layers).find((l:any)=>l.type==='text'&&l.role==='sfx') as any;});expect((await content()).text.content).toBe('砰！');
  await (await menuCommand(page,'撤销')).click();await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(0);
  await (await menuCommand(page,'重做')).click();await page.getByRole('button',{name:'编辑文字',exact:true}).click();await input.fill('轰！');await page.locator('.canvas-toolbar').click();
  expect((await content()).text.content).toBe('轰！');await (await menuCommand(page,'撤销')).click();expect((await content()).text.content).toBe('砰！');await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1);
});
test('1px text saves, reopens and can be exported; invalid zero size preserves the applied value', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '文字' }).first().click();
  const size = page.getByLabel('文字字号'); await size.fill('1'); await size.press('Enter'); await expect(size).toHaveValue('1');
  await size.fill('0'); await size.press('Enter'); await expect(size).toHaveValue('1');
  const saved = page.waitForEvent('download'); await (await menuCommand(page, '保存')).click(); const path = await (await saved).path(); expect(path).not.toBeNull();
  await page.locator('input[type=file][accept=".json,.Comia.json"]').setInputFiles(path!);
  await waitForProjectIO(page);
  await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').first().click(); await expect(size).toHaveValue('1');
  const exported = page.waitForEvent('download'); await (await menuCommand(page, 'PNG')).click(); expect((await exported).suggestedFilename()).toMatch(/\.png$/);
});

test('empty independent text remains selectable after save and reopen while PNG contains exactly the empty paper pixels', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined })); await page.goto('/');
  const png = async () => { const pending = page.waitForEvent('download'); await (await menuCommand(page, 'PNG')).click(); return readFile((await (await pending).path())!); };
  const blank = await png(); await page.locator('.library-item').filter({ hasText: /^文字/ }).click();
  await page.getByRole('button', { name: '编辑文字', exact: true }).click(); await page.getByLabel('编辑文字内容').fill(''); await page.getByLabel('编辑文字内容').press('Control+Enter');
  const saved = page.waitForEvent('download'); await (await menuCommand(page, '保存')).click(); const file = (await (await saved).path())!;
  const data = JSON.parse(await readFile(file, 'utf8')); expect(Object.values(data.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground')).toEqual([expect.objectContaining({ type: 'text', text: expect.objectContaining({ content: '' }) })]);
  await page.locator('input[type=file][accept=".json,.Comia.json"]').setInputFiles(file); await waitForProjectIO(page);
  await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').click(); await expect(page.getByRole('button', { name: '编辑文字', exact: true })).toBeEnabled(); expect(await png()).toEqual(blank);
});
