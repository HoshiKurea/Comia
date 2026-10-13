import { expect, test, type Page } from '@playwright/test';
import type { DecorationLayer, PanelLayer, Project, SpeedBrushSpec } from '../../src/domain/types';
import { menuCommand } from './menuHelpers';
import { parkFloatingControls } from './floatingHelpers';

async function fixture(page: Page) {
  await page.goto('/'); await expect(page.locator('.canvas-viewport')).toBeVisible();
  await page.evaluate(async () => {
    const { createProject } = await import('/src/' + 'domain/factories.ts'), { replaceDocument } = await import('/src/' + 'history/commandBus.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const p = createProject(), id = p.pageOrder[0]; Object.assign(p.pages[id], { width: 900, height: 700 });
    const r = replaceDocument(p); if (!r.ok) throw Error(JSON.stringify(r)); sessionStore.setState({ selection: [], scopeId: null, snap16: false, spacePan: false, viewportByPage: { [id]: { zoom: 1, pan: { x: 10, y: 10 } } } }); await document.fonts.ready;
  });
}
async function state(page: Page) { return page.evaluate(async () => {
  const { getDocument } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
  return { project: getDocument().project as Project, history: getDocument().history.past.length, selection: sessionStore.getState().selection };
}); }
const frames = (p: Project) => Object.values(p.layers).filter((l): l is PanelLayer => l.type === 'panel');
const brushes = (p: Project) => Object.values(p.layers).filter((l): l is DecorationLayer => l.type === 'decoration' && l.spec.kind === 'speed-brush');
async function activate(page: Page) { await page.getByRole('button', { name: '速度线笔刷', exact: true }).click(); await parkFloatingControls(page); }
async function start(page: Page, x = 170, y = 190) { const b = (await page.locator('.canvas-viewport').boundingBox())!; await page.mouse.move(b.x + x + 10, b.y + y + 10); await page.mouse.down(); return b; }
async function stroke(page: Page, curved = false) {
  const b = await start(page);
  for (let i = 1; i <= 24; i++) await page.mouse.move(b.x + 180 + i * 10, b.y + 200 + (curved ? 55 * Math.sin(i / 10) : i));
  await page.mouse.up();
}
test('creates RTL batch numbers and names, selects the top right frame, preserves old numbers and permits explicit LTR', async ({ page }) => {
  await fixture(page); await page.getByRole('button', { name: '四格', exact: true }).click();
  let s = await state(page), batch = frames(s.project); expect(batch.map(p => p.editorNumber)).toEqual([2, 1, 4, 3]); expect(batch.map(p => p.name)).toEqual(['分镜 2','分镜 1','分镜 4','分镜 3']); expect(s.selection).toEqual([batch[1].id]);
  const existing = batch.map(p => ({ id: p.id, n: p.editorNumber })); await page.getByRole('tab', { name: '页面', exact: true }).click(); await page.getByLabel('阅读方向', { exact: true }).selectOption('ltr');
  await page.getByRole('tab', { name: '组件库', exact: true }).click(); await page.getByRole('button', { name: '四格', exact: true }).click(); s = await state(page);
  expect(frames(s.project).slice(4).map(p => p.editorNumber)).toEqual([5,6,7,8]); for (const p of existing) expect((s.project.layers[p.id] as PanelLayer).editorNumber).toBe(p.n);
  await (await menuCommand(page, '撤销')).click(); expect(frames((await state(page)).project)).toHaveLength(4); await (await menuCommand(page, '重做')).click(); expect(await state(page)).toEqual(s);
});
test('merges the categories and enables a brush without placing an object, then creates one independent reversible stroke', async ({ page }) => {
  await fixture(page); const before = await state(page); await expect(page.getByRole('region', { name: '声效字', exact: true })).toHaveCount(0);
  const category = page.getByRole('region', { name: '文字与装饰', exact: true }); await expect(category.locator('.library-tile')).toHaveCount(8);
  await activate(page); expect(await state(page)).toEqual(before); await expect(page.getByRole('button', { name: '速度线笔刷', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await stroke(page, true); const after = await state(page), list = brushes(after.project); expect(list).toHaveLength(1); expect(list[0].parentId).toBeNull(); expect(list[0].spec.kind).toBe('speed-brush'); expect(after.history).toBe(1); expect(after.selection).toEqual([list[0].id]);
  const spec = list[0].spec as SpeedBrushSpec; expect(spec.centerline).toHaveLength(2);
  const a = spec.centerline[0], z = spec.centerline[1], dx = (z.x-a.x)*spec.width, dy = (z.y-a.y)*spec.height, length = Math.hypot(dx,dy);
  for (const ring of spec.ribbons) {
    const centers = ring.slice(0,ring.length/2).map((p,i) => ({x:(p.x+ring[ring.length-1-i].x)*spec.width/2,y:(p.y+ring[ring.length-1-i].y)*spec.height/2}));
    for (const p of centers) expect(Math.abs((dx*(p.y-centers[0].y)-dy*(p.x-centers[0].x))/length)).toBeLessThan(1e-8);
  }
  await page.getByRole('button', { name: '返回选择', exact: true }).click(); await (await menuCommand(page, '撤销')).click(); expect(await state(page)).toEqual(before); await (await menuCommand(page, '重做')).click(); expect(await state(page)).toEqual(after);
  await page.screenshot({ path: `output/playwright/rtl-brush-${test.info().project.name || 'edge'}.png` });
});
test('does not write previews into history, cancels Escape and pointer cancellation, rejects short strokes and freezes options', async ({ page }) => {
  await fixture(page); await activate(page); const before = await state(page), b = await start(page);
  await page.mouse.move(b.x + 330, b.y + 230, { steps: 15 }); expect(await state(page)).toEqual(before);
  await page.keyboard.press('Escape'); await page.mouse.up(); expect(await state(page)).toEqual(before);
  const c = await start(page); await page.mouse.move(c.x + 350, c.y + 250); await page.locator('.speed-brush-surface').dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse' }); await page.mouse.up(); expect(await state(page)).toEqual(before);
  await start(page); await page.mouse.up(); expect(await state(page)).toEqual(before);
  await stroke(page); const first = brushes((await state(page)).project)[0]; const density = page.getByLabel('笔刷密度', { exact: true }); await density.fill('12'); await density.press('Enter'); await stroke(page, true); const list = brushes((await state(page)).project);
  expect(list).toHaveLength(2); expect((first.spec as { options: { density: number } }).options.density).toBe(8); expect((list[1].spec as { options: { density: number } }).options.density).toBe(12);
});
test('keeps group painter order in preview and final pixels while allowing a rotated group brush to remain independently editable', async ({ page }) => {
  await fixture(page);
  const ids = await page.evaluate(async () => {
    const { createLayer } = await import('/src/' + 'domain/factories.ts'), { getProject } = await import('/src/' + 'state/documentStore.ts'), { execute } = await import('/src/' + 'history/commandBus.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const p = getProject(), pid = p.pageOrder[0], group = createLayer('group', pid), top = createLayer('panel', pid); if (group.type !== 'group' || top.type !== 'panel') throw Error('types');
    group.matrix = [1.1, .2, -.1, .9, 20, 40]; top.geometry = [{ x: 260, y: 140 }, { x: 350, y: 140 }, { x: 350, y: 270 }, { x: 260, y: 270 }]; top.style.fill = '#1267C5FF'; top.style.borderWidth = 0;
    const r = execute({ label: '画序夹具', context: { pageId: pid, selection: [] }, mutate(d: Project) { d.layers[group.id] = group; d.layers[top.id] = top; d.pages[pid].roots.push(group.id, top.id); } }); if (!r.ok) throw Error(JSON.stringify(r)); sessionStore.setState({ scopeId: group.id }); return { group: group.id, top: top.id };
  });
  await activate(page); const b = await start(page); await page.mouse.move(b.x + 420, b.y + 210, { steps: 24 });
  await page.evaluate(async () => { await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))); });
  const preview = await page.evaluate(() => {
    const canvas = document.querySelectorAll<HTMLCanvasElement>('.konvajs-content canvas')[1], dpr = canvas.width / canvas.getBoundingClientRect().width;
    return Array.from(canvas.getContext('2d')!.getImageData(Math.round(310 * dpr), Math.round(210 * dpr), 1, 1).data);
  }); expect(preview).toEqual([18,103,197,255]);
  await page.mouse.up(); await page.getByRole('button', { name: '返回选择', exact: true }).click(); const after = await state(page), brush = brushes(after.project)[0]; expect(brush.parentId).toBe(ids.group);
  const result = await page.evaluate(async ({ id }) => {
    const { getProject } = await import('/src/' + 'state/documentStore.ts'), { exportPng } = await import('/src/' + 'export/exportFiles.ts'), { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts'), { apply, worldMatrix } = await import('/src/' + 'geometry/matrix.ts');
    const p = getProject(), layer = p.layers[id] as DecorationLayer; if (layer.spec.kind !== 'speed-brush') throw Error('brush');
    const q = layer.spec.centerline[0], point = apply(worldMatrix(p,id), { x: q.x * layer.spec.width, y: q.y * layer.spec.height });
    const png = await exportPng(p, p.pageOrder[0], runtimeStore.getState().images); if (!png.ok) throw Error('PNG'); const bitmap = await createImageBitmap(png.value), c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height; const ctx = c.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); const pixel = Array.from(ctx.getImageData(300,200,1,1).data); bitmap.close(); c.width = c.height = 0; return { point, pixel };
  }, { id: brush.id }); expect(result.point.x).toBeCloseTo(170); expect(result.point.y).toBeCloseTo(190); expect(result.pixel).toEqual(preview);
});
test('saves and opens actual brush vectors, preserves repeated PNG output, and emits a PDF with ink', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await fixture(page); await activate(page); await stroke(page, true); await page.getByRole('button', { name: '返回选择', exact: true }).click(); const before = await state(page);
  const saved = page.waitForEvent('download'); await (await menuCommand(page, '保存')).click(); const file = await saved, path = await file.path(); if (!path) throw Error('download');
  const png1 = page.waitForEvent('download'); await (await menuCommand(page, 'PNG')).click(); const image1 = await png1;
  await page.getByLabel('打开项目文件', { exact: true }).setInputFiles(path); await expect.poll(async () => brushes((await state(page)).project).length).toBe(1);
  expect((await state(page)).project).toEqual(before.project);
  const png2 = page.waitForEvent('download'); await (await menuCommand(page, 'PNG')).click(); const image2 = await png2;
  const { readFile } = await import('node:fs/promises'); expect(await readFile((await image1.path())!)).toEqual(await readFile((await image2.path())!));
  const stem = `output/playwright/rtl-brush-${test.info().project.name || 'edge'}`;
  await image2.saveAs(`${stem}.png`);
  const pdfDownload = page.waitForEvent('download'); await (await menuCommand(page, 'PDF')).click(); const pdf = await pdfDownload; await pdf.saveAs(`${stem}.pdf`); expect((await readFile((await pdf.path())!)).byteLength).toBeGreaterThan(1000);
});
test('opens a format6 comic in RTL without changing existing frame numbers or the stored source file', async ({ page }) => {
  await fixture(page); await page.getByRole('button', { name: '四格', exact: true }).click();
  const old = (await state(page)).project; old.schemaVersion = 6; old.settings.readingDirection = 'ltr';
  const bytes = JSON.stringify({ format: 'Comia', version: 1, project: old, blobs: [] });
  await page.getByLabel('打开项目文件', { exact: true }).setInputFiles({ name: 'old.Comia.json', mimeType: 'application/json', buffer: Buffer.from(bytes) });
  await expect.poll(async () => (await state(page)).project.schemaVersion).toBe(8); const loaded = (await state(page)).project;
  expect(loaded.settings.readingDirection).toBe('rtl'); expect(loaded.layers).toEqual(old.layers); expect(JSON.parse(bytes).project.schemaVersion).toBe(6);
  await page.getByRole('button', { name: '四格', exact: true }).click(); expect(frames((await state(page)).project).slice(4).map(p => p.editorNumber)).toEqual([6,5,8,7]);
});
test('allows keyboard brush activation and editing a completed stroke without regenerating its ribbons', async ({ page }) => {
  await fixture(page); const tool = page.getByRole('button', { name: '速度线笔刷', exact: true }); await tool.focus(); await page.keyboard.press('Enter');
  await expect(tool).toHaveAttribute('aria-pressed','true'); expect(brushes((await state(page)).project)).toHaveLength(0); await parkFloatingControls(page); await stroke(page);
  await page.getByRole('button', { name: '返回选择', exact: true }).click(); const before = await state(page), b = brushes(before.project)[0];
  const width = page.getByLabel('对象宽', { exact: true }); await width.fill(String(b.spec.width * 1.25)); await width.press('Tab');
  const color = page.getByLabel('颜色', { exact: true }); await color.fill('#cc2200'); const after = await state(page), changed = after.project.layers[b.id] as DecorationLayer;
  expect(changed.spec.width).toBeCloseTo(b.spec.width * 1.25); expect('color' in changed.spec?changed.spec.color:undefined).toBe('#cc2200FF');
  expect((changed.spec as { ribbons: unknown }).ribbons).toEqual((b.spec as { ribbons: unknown }).ribbons);
  await (await menuCommand(page,'复制')).click(); await (await menuCommand(page,'粘贴')).click(); const copy = brushes((await state(page)).project); expect(copy).toHaveLength(2); expect(copy[1].spec).toEqual(changed.spec);
});
test('draws legacy rectangular speed objects with their original algorithm after format6 migration', async ({ page }) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    const { createLayer } = await import('/src/' + 'domain/factories.ts'), { getProject } = await import('/src/' + 'state/documentStore.ts'), { migrateProject } = await import('/src/' + 'storage/migrateProject.ts'), { exportPng } = await import('/src/' + 'export/exportFiles.ts'), { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts');
    const p = structuredClone(getProject()), pid = p.pageOrder[0], old = createLayer('decoration',pid); old.matrix = [1,0,0,1,100,100]; if (old.type !== 'decoration' || old.spec.kind !== 'speed') throw Error('legacy'); old.spec.seed = 42; old.spec.angleDeg = 35; p.layers[old.id] = old; p.pages[pid].roots.push(old.id); p.schemaVersion = 6; p.settings.readingDirection = 'ltr';
    const migrated = migrateProject(p); if (!migrated.ok) throw Error('migrate'); const a = await exportPng(p,pid,runtimeStore.getState().images), b = await exportPng(migrated.value,pid,runtimeStore.getState().images); if (!a.ok || !b.ok) throw Error('PNG');
    return { a: Array.from(new Uint8Array(await a.value.arrayBuffer())), b: Array.from(new Uint8Array(await b.value.arrayBuffer())), spec: (migrated.value.layers[old.id] as DecorationLayer).spec, original: old.spec };
  }); expect(result.a).toEqual(result.b); expect(result.spec).toEqual(result.original);
});
test('clips the actual brush preview to the paper boundary while retaining the full editable stroke', async ({ page }) => {
  await fixture(page); await page.evaluate(async () => {
    const { getProject } = await import('/src/'+'state/documentStore.ts'), { execute } = await import('/src/'+'history/commandBus.ts'); const p = getProject();
    const r = execute({label:'窄纸张',context:{pageId:p.pageOrder[0],selection:[]},mutate(d:Project){d.pages[p.pageOrder[0]].width=600;}}); if(!r.ok)throw Error(JSON.stringify(r));
  });
  await activate(page); const b=(await page.locator('.canvas-viewport').boundingBox())!; await page.mouse.move(b.x+410,b.y+210); await page.mouse.down(); await page.mouse.move(b.x+760,b.y+210,{steps:30});
  await page.evaluate(async()=>{await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));});
  const counts=await page.evaluate(()=>{
    const c=document.querySelectorAll<HTMLCanvasElement>('.konvajs-content canvas')[1], ratio=c.width/c.getBoundingClientRect().width,ctx=c.getContext('2d')!;
    const scan=(x:number,w:number,mode:'ink'|'alpha')=>{const rgba=ctx.getImageData(Math.round(x*ratio),Math.round(120*ratio),Math.round(w*ratio),Math.round(150*ratio)).data;let n=0;for(let i=0;i<rgba.length;i+=4)if(mode==='alpha'?rgba[i+3]>0:Math.max(rgba[i],rgba[i+1],rgba[i+2])<50&&rgba[i+3]>128)n++;return n;};return{inside:scan(420,170,'ink'),outside:scan(640,150,'alpha')};
  }); expect(counts.inside).toBeGreaterThan(100); expect(counts.outside).toBe(0); await page.mouse.up(); const s=await state(page), brush=brushes(s.project)[0];expect(brush.matrix[4]+brush.spec.width).toBeGreaterThan(700);expect(brush.spec.kind).toBe('speed-brush');
});
test('cancels an uncommitted brush when the viewport resizes so its frozen client coordinates cannot drift', async ({ page }) => {
  await fixture(page); await activate(page); const before = await state(page), b = await start(page);
  await page.mouse.move(b.x+360,b.y+220,{steps:12}); await page.setViewportSize({width:900,height:760});
  await expect.poll(()=>page.evaluate(async()=>Boolean((await import('/src/'+'library/speedBrushController.ts')).currentSpeedStroke()))).toBe(false);
  await page.mouse.up();expect(await state(page)).toEqual(before);await expect(page.getByRole('button',{name:'速度线笔刷',exact:true})).toHaveAttribute('aria-pressed','true');
});
test('hides previously selected tail handles so they cannot intercept the brush pointer', async ({ page }) => {
  await fixture(page);await page.getByRole('button',{name:'短直尾',exact:true}).click();const before=await state(page);
  const handle=(await page.locator('.manga-geometry-overlay [role=button]').last().boundingBox())!;expect(handle).not.toBeNull();
  await activate(page);await expect(page.locator('.manga-geometry-overlay')).toHaveCount(0);
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+120,handle.y+35,{steps:16});await page.mouse.up();
  const after=await state(page);expect(brushes(after.project)).toHaveLength(1);expect(after.project.layers[before.selection[0]]).toEqual(before.project.layers[before.selection[0]]);expect(after.history).toBe(before.history+1);
});
