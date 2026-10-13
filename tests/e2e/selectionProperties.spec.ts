import { expect, test } from '@playwright/test';
import { initHandBubble, handState, scenePixel } from './handBubbleHelpers';
import { menuCommand } from './menuHelpers';
import type { Project } from '../../src/domain/types';
test('all bubble colour properties accept picker and RGBA edits without disabling subsequent controls', async ({ page }) => {
  await initHandBubble(page);
  const id = await page.evaluate(async () => {
    const p = (await import('/src/' + 'state/documentStore.ts')).getProject(), b = (await import('/src/' + 'domain/factories.ts')).createLayer('bubble', p.pageOrder[0]);
    b.matrix = [1, 0, 0, 1, 40, 40]; if (b.type !== 'bubble') throw Error('type'); b.width = 160; b.height = 120;
    const r = (await import('/src/' + 'history/commandBus.ts')).execute({ label: 'test bubble', context: { pageId: b.pageId, selection: [] }, mutate(d: Project) { d.layers[b.id] = b; d.pages[b.pageId].roots.push(b.id); } }); if (!r.ok) throw Error(JSON.stringify(r));
    (await import('/src/' + 'state/sessionStore.ts')).setSelection([b.id]); return b.id;
  });
  await page.getByLabel('气泡填充色', { exact: true }).fill('#00ff00');
  await expect.poll(async () => (await handState(page)).project.layers[id]).toMatchObject({ style: { fill: '#00FF00FF' } });
  expect(await scenePixel(page, 120, 100)).toEqual([0, 255, 0, 255]);
  await page.getByText('气泡内外描边',{exact:true}).click();
  await page.getByLabel('启用气泡外描边').check();
  const rgba = page.getByLabel('气泡外描边RGBA', { exact: true }); await expect(rgba).toBeEnabled();
  await rgba.fill('#FF0000FF'); await rgba.press('Enter');
  await page.getByLabel('气泡外描边宽度', { exact: true }).fill('12'); await page.getByLabel('气泡外描边宽度', { exact: true }).press('Enter');
  await expect.poll(async () => (await handState(page)).project.layers[id]).toMatchObject({ style: { outerStroke: { enabled: true, color: '#FF0000FF', width: 12 } } });
  await page.getByLabel('气泡边框色', { exact: true }).fill('#0000ff');
  await page.getByLabel('启用气泡内描边').check(); await page.getByLabel('气泡内描边', { exact: true }).fill('#ffff00');
  await page.getByLabel('气泡内描边宽度', { exact: true }).fill('6'); await page.getByLabel('气泡内描边宽度', { exact: true }).press('Enter');
  await expect.poll(async () => (await handState(page)).project.layers[id]).toMatchObject({ style: { borderColor: '#0000FFFF', innerStroke: { enabled: true, color: '#FFFF00FF', width: 6 } } });
  const fillAlpha = page.getByLabel('气泡填充色透明度 %', { exact: true }); await fillAlpha.fill('50'); await fillAlpha.press('Enter');
  const hex = page.getByLabel('气泡填充色RGBA', { exact: true }); await hex.fill('#22AA33'); await hex.press('Enter');
  await expect.poll(async () => (await handState(page)).project.layers[id]).toMatchObject({ style: { fill: '#22AA3380' } });
  const accepted = await handState(page); await hex.fill('wrong'); await hex.press('Enter'); await expect(hex).toHaveValue('#22AA3380'); expect((await handState(page)).past).toBe(accepted.past);
  await hex.fill('#11223344'); await hex.press('Escape'); await expect(hex).toHaveValue('#22AA3380'); expect((await handState(page)).project).toEqual(accepted.project);
  await (await menuCommand(page, '撤销')).click(); await expect.poll(async () => (await handState(page)).project.layers[id]).toMatchObject({ style: { fill: '#00FF0080' } });
  await (await menuCommand(page, '重做')).click(); expect((await handState(page)).project).toEqual(accepted.project);
});
test('mixed bubble and material share resize and rotation handles, preserve private preview and undo as a batch', async ({ page }) => {
  await initHandBubble(page);
  const ids = await page.evaluate(async () => {
    const p = structuredClone((await import('/src/' + 'state/documentStore.ts')).getProject()), pid = p.pageOrder[0], { createLayer } = await import('/src/' + 'domain/factories.ts');
    const c = document.createElement('canvas'); c.width = c.height = 80; const ctx = c.getContext('2d')!; ctx.fillStyle = '#2299CC'; ctx.fillRect(0, 0, 80, 80);
    const blob = await new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/png')), decoded = await (await import('/src/' + 'assets/importImage.ts')).decodeImage(new File([blob], 'blue.png', { type: 'image/png' }), new AbortController().signal); if (!decoded.ok) throw Error(JSON.stringify(decoded));
    const a = decoded.value, b = createLayer('bubble', pid), im = createLayer('image', pid); if (b.type !== 'bubble' || im.type !== 'image') throw Error('type');
    b.width = 160; b.height = 120; b.matrix = [1, 0, 0, 1, 40, 40]; im.width = im.height = 80; im.matrix = [1, 0, 0, 1, 240, 40]; im.assetId = a.meta.id;
    p.assets[a.meta.id] = a.meta; p.layers[b.id] = b; p.layers[im.id] = im; p.pages[pid].roots.push(b.id, im.id);
    const r = (await import('/src/' + 'history/commandBus.ts')).replaceDocument(p); if (!r.ok) throw Error(JSON.stringify(r));
    (await import('/src/' + 'storage/blobRepository.ts')).replaceRuntimeResources(new Map([[a.meta.originalHash, a.original], [a.meta.renderHash, a.render]]), new Map([[a.meta.renderHash, a.bitmap]]));
    (await import('/src/' + 'state/sessionStore.ts')).setSelection([b.id, im.id]); return [b.id, im.id];
  });
  async function bounds() { return page.evaluate(async ids => { const p = (await import('/src/' + 'state/documentStore.ts')).getProject(), s = (await import('/src/' + 'state/sessionStore.ts')).sessionStore.getState(), v = s.viewportByPage[s.activePageId], r = document.querySelector('.canvas-viewport')!.getBoundingClientRect(), b = (await import('/src/' + 'interaction/selectionTransform.ts')).selectionTransformBounds(p, ids)!; return { ...b, v, left: r.left, top: r.top }; }, ids); }
  let q = await bounds(); const before = await handState(page);
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const point = (x: number, y: number) => ({ x: q.left + q.v.pan.x + x * q.v.zoom, y: q.top + q.v.pan.y + y * q.v.zoom });
  let start = point(q.x + q.width, q.y + q.height), end = point(q.x + q.width * 1.5, q.y + q.height * 1.5);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.keyboard.down('Shift'); await page.mouse.move(start.x + (end.x-start.x)*.1, start.y + (end.y-start.y)*.1);
  await expect.poll(() => page.evaluate(async () => !!(await import('/src/' + 'state/runtimeStore.ts')).runtimeStore.getState().previewProject)).toBe(true);
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  await page.evaluate(async () => (await import('/src/' + 'state/runtimeStore.ts')).resetRenderStats());
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await expect.poll(async () => page.evaluate(async () => !!(await import('/src/' + 'state/runtimeStore.ts')).runtimeStore.getState().previewProject)).toBe(true);
  const preview = await page.evaluate(async ids => { const r = (await import('/src/' + 'state/runtimeStore.ts')).runtimeStore.getState(); return { matrices: ids.map(id => r.previewProject!.layers[id].matrix), mainDraws: r.renderStats.mainDraws }; }, ids);
  for (const m of preview.matrices) expect(m[0]).toBeCloseTo(1.5); expect(preview.mainDraws).toBe(0);
  expect((await handState(page)).project).toEqual(before.project); expect((await handState(page)).past).toBe(before.past);
  await page.mouse.up(); await page.keyboard.up('Shift'); const scaled = await handState(page);
  expect(scaled.past).toBe(before.past + 1); for (const id of ids) expect(scaled.project.layers[id].matrix[0]).toBeCloseTo(1.5);
  expect(scaled.project.pages[scaled.project.pageOrder[0]].roots).toEqual(before.project.pages[before.project.pageOrder[0]].roots);
  await (await menuCommand(page, '撤销')).click(); expect((await handState(page)).project).toEqual(before.project); await (await menuCommand(page, '重做')).click(); expect((await handState(page)).project).toEqual(scaled.project);
  q = await bounds(); const cx = q.x + q.width / 2, cy = q.y + q.height / 2, radius = q.height / 2 + 24 / q.v.zoom; start = point(cx, cy - radius); end = point(cx + radius, cy);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.keyboard.down('Alt'); await page.mouse.move(end.x, end.y, { steps: 12 }); await page.mouse.up(); await page.keyboard.up('Alt');
  const rotated = await handState(page); expect(rotated.past).toBe(scaled.past + 1); for (const id of ids) { expect(rotated.project.layers[id].matrix[0]).toBeCloseTo(0); expect(rotated.project.layers[id].matrix[1]).toBeCloseTo(1.5); }
  q = await bounds(); start = point(q.x + q.width, q.y + q.height); end = point(q.x + q.width + 20, q.y + q.height + 20); await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y); await page.keyboard.press('Escape'); await page.mouse.up(); expect((await handState(page)).project).toEqual(rotated.project);
  await page.screenshot({ path: `output/hand-bubble/mixed-transform-dpr${q.v.zoom === 1 ? await page.evaluate(() => devicePixelRatio) : 0}.png` });
  await page.keyboard.press('Delete'); const deleted = await handState(page); for (const id of ids) expect(deleted.project.layers[id]).toBeUndefined(); expect(deleted.past).toBe(rotated.past + 1); await (await menuCommand(page, '撤销')).click(); expect((await handState(page)).project).toEqual(rotated.project);
});
test('shortcut reference scrolls inside its dock without scrolling the document or zooming the canvas', async ({ page }) => {
  await initHandBubble(page);
  await page.evaluate(async () => {
    const p = (await import('/src/' + 'state/documentStore.ts')).getProject(), b = (await import('/src/' + 'domain/factories.ts')).createLayer('panel', p.pageOrder[0]);
    const r = (await import('/src/' + 'history/commandBus.ts')).execute({ label: 'test panel', context: { pageId: b.pageId, selection: [] }, mutate(d: Project) { d.layers[b.id] = b; d.pages[b.pageId].roots.push(b.id); } }); if (!r.ok) throw Error(JSON.stringify(r)); (await import('/src/' + 'state/sessionStore.ts')).setSelection([b.id]);
  });
  const panel = page.getByRole('region', { name: '快捷键参考', exact: true });
  await expect(panel).toBeVisible(); const before = await panel.evaluate(n => ({ scroll: n.scrollTop, height: n.clientHeight, content: n.scrollHeight })); expect(before.content).toBeGreaterThan(before.height);
  const box = (await panel.boundingBox())!; await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, 450);
  await expect.poll(() => panel.evaluate(n => n.scrollTop)).toBeGreaterThan(0); expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const viewport = await page.evaluate(async () => { const s = (await import('/src/' + 'state/sessionStore.ts')).sessionStore.getState(); return s.viewportByPage[s.activePageId]; }); expect(viewport.zoom).toBe(1);
  await page.mouse.wheel(0, -450); await expect.poll(() => panel.evaluate(n => n.scrollTop)).toBe(0);
});
test('property tabs and collapsible sections preserve controls, rename and quick actions use document history', async ({ page }) => {
  await initHandBubble(page);
  const id = await page.evaluate(async () => {
    const p = (await import('/src/' + 'state/documentStore.ts')).getProject(), panel = (await import('/src/' + 'domain/factories.ts')).createLayer('panel', p.pageOrder[0]);
    const r = (await import('/src/' + 'history/commandBus.ts')).execute({ label: 'test panel', context: { pageId: panel.pageId, selection: [] }, mutate(d: Project) { d.layers[panel.id] = panel; d.pages[panel.pageId].roots.push(panel.id); } }); if (!r.ok) throw Error(JSON.stringify(r));
    (await import('/src/' + 'state/sessionStore.ts')).setSelection([panel.id]); return panel.id;
  });
  const tabs = page.getByRole('tablist', { name: '属性类别' }); await expect(tabs.getByRole('tab')).toHaveCount(3);
  await page.getByRole('button', { name: '重命名图层', exact: true }).click(); await page.getByLabel('图层名称', { exact: true }).fill('封面分镜'); await page.getByLabel('图层名称', { exact: true }).press('Enter');
  await expect.poll(async () => (await handState(page)).project.layers[id].name).toBe('封面分镜');
  const transform = page.locator('.inspector-section').filter({ has: page.locator('summary').getByText('变换', { exact: true }) });
  const beforeNavigation = await handState(page); await transform.locator(':scope > summary').click(); await expect(page.getByLabel('对象X', { exact: true })).toBeHidden(); await transform.locator(':scope > summary').click();
  await tabs.getByRole('tab', { name: '效果', exact: true }).click(); await expect(page.getByLabel('对象X', { exact: true })).toBeHidden(); await expect(page.getByLabel('填充色RGBA', { exact: true })).toBeVisible();
  await tabs.getByRole('tab', { name: '调整', exact: true }).click(); await expect(page.getByRole('button', { name: '编辑顶点与边', exact: true })).toBeVisible();
  await tabs.getByRole('tab', { name: '调整', exact: true }).press('Home'); await expect(tabs.getByRole('tab', { name: '图层属性', exact: true })).toHaveAttribute('aria-selected', 'true'); expect((await handState(page)).past).toBe(beforeNavigation.past);
  await page.getByLabel('对象X', { exact: true }).fill('249.49'); await page.getByLabel('对象X', { exact: true }).press('Enter'); await expect.poll(async () => (await handState(page)).project.layers[id].matrix[4]).toBe(249.49);
  const beforeCopy = await handState(page); await page.getByRole('button', { name: '复制图层', exact: true }).click(); const copied = await handState(page), copy = copied.selection[0]; expect(copy).not.toBe(id); expect(copied.past).toBe(beforeCopy.past + 1);
  await page.getByRole('button', { name: '删除图层', exact: true }).click(); expect((await handState(page)).project.layers[copy]).toBeUndefined(); await (await menuCommand(page, '撤销')).click(); expect((await handState(page)).project).toEqual(copied.project); await (await menuCommand(page, '撤销')).click(); expect((await handState(page)).project).toEqual(beforeCopy.project);
  await page.getByRole('button',{name:'属性面板菜单',exact:true}).click();
  await page.getByRole('button', { name: '展开属性面板', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '属性展开窗', exact: true }); await expect(dialog).toBeVisible(); await expect(dialog.getByLabel('对象X', { exact: true })).toHaveValue('249.49');
  expect(await dialog.locator('.inspector-modern').evaluate(n => n.scrollWidth <= n.clientWidth)).toBe(true);
  await dialog.screenshot({ path: `output/hand-bubble/inspector-dpr${await page.evaluate(() => devicePixelRatio)}.png` });
  await page.getByRole('button', { name: '收回属性展开窗', exact: true }).click(); await expect(dialog).not.toBeVisible(); await expect(page.getByLabel('对象X', { exact: true })).toHaveValue('249.49');
});
