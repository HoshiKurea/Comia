import { menuCommand } from './menuHelpers';
import { expect, test, type Page } from '@playwright/test';
import type { DrawingSession } from '../../src/panels/drawingController';
import type { PanelLayer, Project } from '../../src/domain/types';

async function fixture(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '手绘分格', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { createProject } = await import('/src/' + 'domain/factories.ts'), { replaceDocument } = await import('/src/' + 'history/commandBus.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts'); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const project = createProject(), id = project.pageOrder[0]; Object.assign(project.pages[id], { width: 900, height: 700 });
    const result = replaceDocument(numberFixture(project)); if (!result.ok) throw Error(JSON.stringify(result.problems)); sessionStore.setState({ viewportByPage: { [id]: { zoom: 1, pan: { x: 10, y: 10 } } } });
  });
}
async function model(page: Page): Promise<Project> { return page.evaluate(async () => (await import('/src/' + 'state/documentStore.ts')).getProject()); }
async function history(page: Page) { return page.evaluate(async () => (await import('/src/' + 'state/documentStore.ts')).getDocument().history.past.length); }
async function snapshot(page: Page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); return page.locator('.konvajs-content canvas').first().evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()); }
async function roundtrip(page: Page) {
  return page.evaluate(async () => {
    const { getProject } = await import('/src/' + 'state/documentStore.ts'), { encodeProject, decodeProject } = await import('/src/' + 'storage/codec.ts'), { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts');
    const before = structuredClone(getProject()), encoded = await encodeProject(before, runtimeStore.getState().blobs); if (!encoded.ok) throw Error(JSON.stringify(encoded.problems));
    const result = await decodeProject(new File([encoded.value], 'panels.comia')); if (!result.ok) throw Error(JSON.stringify(result.problems)); return { before, after: result.value.project };
  });
}
async function undoRedo(page: Page, before: Project, after: Project) { await (await menuCommand(page, '撤销')).click(); expect(await model(page)).toEqual(before); await (await menuCommand(page, '重做')).click(); expect(await model(page)).toEqual(after); }

test('all ten shape components and twelve layouts deploy at page center with one-step history', async ({ page }) => {
  await fixture(page);
  for (const name of ['矩形分镜', '圆角分镜', '椭圆分镜', '三角分镜', '菱形分镜', '梯形分镜', '平行四边形', '五边形分镜', '六边形分镜', '八边形分镜', '上下二格', '左右二格', '三横条', '三竖条', '四横条', '四格', '六格竖版', '六格横版', '上大下二', '上二下大', '左大右二', '左二右大']) {
    const before = await model(page), count = await history(page);
    await page.locator('.library-item').filter({ hasText: name }).filter({ has: page.locator('span', { hasText: name }) }).first().click(); expect(await history(page)).toBe(count + 1);
    const info = await page.evaluate(async () => { const { getProject } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { worldMatrix, apply } = await import('/src/' + 'geometry/matrix.ts'), { polyBounds } = await import('/src/' + 'geometry/polygon.ts'); const project = getProject() as Project, id = sessionStore.getState().selection[0], layer = project.layers[id]; if (layer.type !== 'panel') throw Error('not a panel'); const points = Object.values(project.layers).filter(l => l.type === 'panel').flatMap(l => l.type === 'panel' ? l.geometry.map(v => apply(worldMatrix(project, l.id), v)) : []); const b = polyBounds(points); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    expect(info.x).toBeCloseTo(450); expect(info.y).toBeCloseTo(350);
    await (await menuCommand(page, '撤销')).click(); expect(await model(page)).toEqual(before);
  }
});

test('real freehand concave frame previews without history or main repaint and supports correction, save and undo', async ({ page }) => {
  await fixture(page); const before = await model(page), viewport = (await page.locator('.canvas-viewport').boundingBox())!;
  await page.getByRole('button', { name: '手绘分格', exact: true }).click(); await expect(page.getByLabel('分格绘制区域')).toBeVisible();
  // Finish fixture font/layout paints before measuring this gesture's redraws.
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  await page.evaluate(async () => (await import('/src/' + 'state/runtimeStore.ts')).resetRenderStats());
  const points = [[150, 140], [390, 140], [390, 390], [320, 390], [320, 230], [230, 230], [230, 390], [150, 390], [150, 140]];
  await page.mouse.move(viewport.x + points[0][0] + 10, viewport.y + points[0][1] + 10); await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(viewport.x + x + 10, viewport.y + y + 10, { steps: 8 }); await page.mouse.up();
  await expect(page.getByRole('button', { name: '闭合并应用' })).toBeEnabled(); expect(await history(page)).toBe(0); expect(await model(page)).toEqual(before);
  expect(await page.evaluate(async () => (await import('/src/' + 'state/runtimeStore.ts')).runtimeStore.getState().renderStats.mainDraws)).toBe(0);
  await page.getByLabel('轮廓修正方式').selectOption('smooth'); await page.getByLabel('轮廓修正方式').selectOption('contour'); await page.getByRole('button', { name: '闭合并应用' }).click();
  const after = await model(page), panel = Object.values(after.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find(l => l.type === 'panel')!; expect(panel.type === 'panel' && panel.geometryMode).toBe('simple'); expect(await history(page)).toBe(1);
  const pixels = await snapshot(page); await undoRedo(page, before, after); expect(await snapshot(page)).toBe(pixels);
  const stored = await roundtrip(page); expect(stored.after).toEqual(stored.before);
});

test('polygon input closes with Enter and vertex insertion/deletion only commits on apply', async ({ page }) => {
  await fixture(page); const before = await model(page), viewport = (await page.locator('.canvas-viewport').boundingBox())!;
  await page.getByRole('button', { name: '多边形分格', exact: true }).click();
  for (const [x, y] of [[150, 140], [390, 140], [390, 390], [150, 390]]) await page.mouse.click(viewport.x + x + 10, viewport.y + y + 10);
  await page.keyboard.press('Enter'); await expect(page.locator('.panel-contour-point')).toHaveCount(4);
  const moveControls = async () => { const h = (await page.getByRole('button', { name: '移动分格修正浮窗' }).boundingBox())!; await page.mouse.move(h.x + 30, h.y + h.height / 2); await page.mouse.down(); await page.mouse.move(h.x + 30, h.y + h.height / 2 + 330, { steps: 12 }); await page.mouse.up(); }; await moveControls();
  await page.mouse.click(viewport.x + 270 + 10, viewport.y + 140 + 10); await expect(page.locator('.panel-contour-point')).toHaveCount(5);
  await page.keyboard.down('Alt'); await page.mouse.click(viewport.x + 270 + 10, viewport.y + 140 + 10); await page.keyboard.up('Alt'); await expect(page.locator('.panel-contour-point')).toHaveCount(4);
  expect(await history(page)).toBe(0); await page.getByRole('button', { name: '闭合并应用' }).click(); const after = await model(page); await undoRedo(page, before, after);
  await page.getByRole('button', { name: '修正分格轮廓' }).click(); await moveControls();
  const vertex=(await page.locator(".panel-contour-point").first().boundingBox())!;await page.mouse.move(vertex.x+vertex.width/2,vertex.y+vertex.height/2);await page.mouse.down();await page.mouse.move(viewport.x+410,viewport.y+310,{steps:1});await page.mouse.up();
  await expect(page.getByRole('region',{name:'分格修正'}).getByRole('alert')).toContainText('自交');await expect(page.getByRole('button',{name:'闭合并应用'})).toBeDisabled();
  expect(await model(page)).toEqual(after);await page.keyboard.press('Escape'); expect(await model(page)).toEqual(after);
});

test('random preview is repeatable, preserves existing content, and applies exact leaf count atomically', async ({ page }) => {
  await fixture(page); await page.getByRole('button', { name: '矩形分镜', exact: true }).click(); const before = await model(page), n = await history(page);
  await page.getByRole('button', { name: '随机分格', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '随机分格', exact: true }); await expect(dialog).toBeVisible();
  await expect(dialog.locator('polygon')).toHaveCount(6); const first = await dialog.locator('svg').innerHTML();
  await dialog.getByRole('button', { name: '换一组' }).click(); await expect.poll(() => dialog.locator('svg').innerHTML()).not.toBe(first);
  await dialog.getByLabel('随机种子').fill('42'); await expect.poll(() => dialog.locator('svg').innerHTML()).toBe(first);
  await page.screenshot({path:`output/audit/panel-tools-random-${test.info().project.name||'edge'}.png`});
  expect(await history(page)).toBe(n); expect(await model(page)).toEqual(before); await dialog.getByRole('button', { name: '应用分格' }).click(); await expect(dialog).toHaveCount(0);
  const after = await model(page); for (const [id, layer] of Object.entries(before.layers)) expect(after.layers[id]).toEqual(layer);
  expect(Object.values(after.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter(l => l.type === 'panel' && l.role === 'leaf')).toHaveLength(7); expect(await history(page)).toBe(n + 1); await undoRedo(page, before, after);
  const stored = await roundtrip(page); expect(stored.after).toEqual(after);
  const originalId=before.pages[before.pageOrder[0]].roots.find((id: string) => before.layers[id].type !== 'pageBackground')!;await page.evaluate(async(id)=>(await import('/src/'+'state/sessionStore.ts')).sessionStore.setState({selection:[id]}),originalId);
  await page.getByRole('button',{name:'随机分格',exact:true}).click();const replacement=page.getByRole('dialog',{name:'随机分格',exact:true});await replacement.getByLabel('分格生成范围').selectOption(originalId);await expect(replacement.locator('polygon')).toHaveCount(6);await replacement.getByRole('button',{name:'应用分格'}).click();
  const replaced=await model(page);expect(Object.values(replaced.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter(l=>l.type==='panel'&&l.role==='leaf')).toHaveLength(12);expect(await history(page)).toBe(n+2);await undoRedo(page,after,replaced);
});

test('equal divisions honor gaps and invalid parameters never modify the document', async ({ page }) => {
  await fixture(page); const before = await model(page); await page.getByRole('button', { name: '行列等分', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '行列等分', exact: true });
  await dialog.getByLabel('分格页边距').fill('-1');await expect(dialog.getByRole('button',{name:'应用分格'})).toBeDisabled();expect(await model(page)).toEqual(before);await dialog.getByLabel('分格页边距').fill('48');
  await dialog.getByLabel('等分行数').fill('8'); await dialog.getByLabel('等分列数').fill('8'); await expect(dialog.getByRole('button', { name: '应用分格' })).toBeDisabled(); expect(await model(page)).toEqual(before);
  await dialog.getByLabel('等分行数').fill('2'); await dialog.getByLabel('等分列数').fill('3'); await expect(dialog.locator('polygon')).toHaveCount(6); await dialog.getByRole('button', { name: '应用分格' }).click();
  const after = await model(page), leaves = Object.values(after.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter(l => l.type === 'panel' && l.role === 'leaf'); expect(leaves).toHaveLength(6); await undoRedo(page, before, after);
});

test('diagonal drag cuts an actual image into frames without changing the pixel mapping', async ({ page }) => {
  await fixture(page); await page.getByRole('button', { name: '矩形分镜', exact: true }).click();
  const id = await page.evaluate(async () => { const { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { decodeImage, placeImage } = await import('/src/' + 'assets/importImage.ts'); const s = sessionStore.getState(), id = s.selection[0]; const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 400; const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ee2244'; ctx.fillRect(0, 0, 300, 400); ctx.fillStyle = '#1166bb'; ctx.fillRect(300, 0, 300, 400); const blob = await new Promise<Blob>(resolve => canvas.toBlob(v => resolve(v!), 'image/png')); canvas.width = canvas.height = 0; const decoded = await decodeImage(new File([blob], 'cut.png', { type: 'image/png' }), new AbortController().signal); if (!decoded.ok) throw Error('decode failed'); const placed = placeImage(decoded.value, s.activePageId, { x: 0, y: 0 }, id); if (!placed.ok) throw Error(JSON.stringify(placed.problems)); sessionStore.setState({ selection: [id] }); return id; });
  const before = await model(page), viewport = (await page.locator('.canvas-viewport').boundingBox())!;
  await page.getByRole('button', { name: '直线切割工具' }).click(); await page.getByLabel('直线切割间隙').fill('0');
  await page.mouse.move(viewport.x + 170, viewport.y + 160); await page.mouse.down(); await page.mouse.move(viewport.x + 750, viewport.y + 560, { steps: 20 }); await page.mouse.up();
  await expect.poll(async () => (await model(page)).layers[id]).toBeUndefined();
  expect(Object.values((await model(page)).layers).filter(l => l.type === 'panel' && l.role === 'leaf' && l.parentId === null)).toHaveLength(2);
  const after = await model(page); expect(Object.values(after.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter(l => l.type === 'image')).toHaveLength(2);
  const mappings = await page.evaluate(async ({ before, after, id }) => {
    const { resolveCrop } = await import('/src/' + 'images/crop.ts'); const source = Object.values(before.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find(l => l.type === 'image')!;
    if (source.type !== 'image' || !source.crop || before.layers[id].type !== 'panel') throw Error('image missing');
    const expected = resolveCrop(before.layers[id].geometry, { x: source.width, y: source.height }, source.crop);
    const actual = Object.values(after.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter(l => l.type === 'image').map(l => { if (l.type !== 'image' || !l.crop || !l.parentId || after.layers[l.parentId].type !== 'panel') throw Error('missing owner'); return resolveCrop((after.layers[l.parentId] as typeof before.layers[typeof id] & { geometry: {x:number;y:number}[] }).geometry, { x: l.width, y: l.height }, l.crop); });
    return { expected, actual };
  }, { before, after, id });
  for (const mapping of mappings.actual) for (const key of ['scale', 'tx', 'ty'] as const) expect(mapping[key]).toBeCloseTo(mappings.expected[key], 10); await undoRedo(page, before, after); const stored = await roundtrip(page); expect(stored.after).toEqual(after);
  const legacyResult=await page.evaluate(async(before)=>{
    const {encodeProject,decodeProject}=await import('/src/'+'storage/codec.ts'),{installLoadedProject}=await import('/src/'+'storage/fileSave.ts'),{runtimeStore}=await import('/src/'+'state/runtimeStore.ts'),{exportPng}=await import('/src/'+'export/exportFiles.ts');
    const original=await exportPng(before,before.pageOrder[0],runtimeStore.getState().images);if(!original.ok)throw Error('original PNG');const legacy=structuredClone(before);legacy.schemaVersion=1;delete legacy.nextPanelNumber;for(const l of Object.values(legacy.layers) as any[])if(l.type==='panel')delete l.editorNumber;for(const paper of Object.values(legacy.pages) as any[]){const bg=paper.roots.map((id:string)=>legacy.layers[id]).find((l:any)=>l.type==='pageBackground');paper.background=bg?.fill??'#FFFFFFFF';if(bg){paper.roots=paper.roots.filter((id:string)=>id!==bg.id);delete legacy.layers[bg.id];}}delete legacy.libraryAssetIds;const encoded=await encodeProject(legacy,runtimeStore.getState().blobs);if(!encoded.ok)throw Error(JSON.stringify(encoded));const decoded=await decodeProject(new File([encoded.value],'legacy.comia'));if(!decoded.ok)throw Error(JSON.stringify(decoded));const loaded=await installLoadedProject(decoded.value.project,decoded.value.blobs);if(!loaded.ok)throw Error(JSON.stringify(loaded));const rendered=await exportPng(loaded.value,loaded.value.pageOrder[0],runtimeStore.getState().images);if(!rendered.ok)throw Error('migrated PNG');return{version:loaded.value.schemaVersion,modes:Object.values(loaded.value.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter((l:any)=>l.type==='panel').map((l:any)=>l.geometryMode),equal:JSON.stringify([...new Uint8Array(await original.value.arrayBuffer())])===JSON.stringify([...new Uint8Array(await rendered.value.arrayBuffer())])};
  },before);expect(legacyResult).toEqual({version:9,modes:['convex'],equal:true});
});


test('concave cut retains three real pieces and cancelling an open polygon or pointer never writes history', async ({ page }) => {
  await fixture(page); await page.evaluate(async () => {
    const { createLayer } = await import('/src/' + 'domain/factories.ts'), { execute } = await import('/src/' + 'history/commandBus.ts'), { getProject } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const p = getProject(), pageId = p.pageOrder[0], layer = createLayer('panel', pageId); layer.geometryMode = 'simple'; layer.matrix = [1,0,0,1,150,120];
    layer.geometry = [{x:0,y:0},{x:240,y:0},{x:240,y:250},{x:170,y:250},{x:170,y:90},{x:80,y:90},{x:80,y:250},{x:0,y:250}];
    const r = execute({label:'test frame',context:{pageId,selection:[]}, mutate(draft: Project){draft.layers[layer.id]=layer;draft.pages[pageId].roots.push(layer.id);}}); if(!r.ok)throw Error(JSON.stringify(r)); sessionStore.setState({selection:[layer.id]}); return layer.id;
  });
  const before = await model(page), viewport = (await page.locator('.canvas-viewport').boundingBox())!;
  await page.getByRole('button', { name: '直线切割工具' }).click(); await page.getByLabel('直线切割间隙').fill('0');
  await page.mouse.move(viewport.x + 120, viewport.y + 280); await page.mouse.down(); await page.mouse.move(viewport.x + 420, viewport.y + 280, {steps:16}); await page.mouse.up();
  const after=await model(page); expect(Object.values(after.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter(l=>l.type==='panel'&&l.role==='leaf'&&l.parentId===null)).toHaveLength(3); await undoRedo(page,before,after);
  const n=await history(page); await page.getByRole('button',{name:'多边形分格',exact:true}).click();
  for(const [x,y] of [[500,150],[600,150],[600,260]])await page.mouse.click(viewport.x+x,viewport.y+y);
  await page.keyboard.press('Backspace'); await page.keyboard.press('Escape'); expect(await history(page)).toBe(n);expect(await model(page)).toEqual(after);
  await page.getByRole('button',{name:'手绘分格',exact:true}).click();await page.mouse.move(viewport.x+500,viewport.y+150);await page.mouse.down();await page.mouse.move(viewport.x+620,viewport.y+250,{steps:8});
  await page.getByLabel('分格绘制区域').dispatchEvent('pointercancel',{pointerId:1,pointerType:'mouse'});await page.mouse.up();await expect(page.getByLabel('分格绘制区域')).toHaveCount(0);expect(await history(page)).toBe(n);expect(await model(page)).toEqual(after);
});

test('existing concave image contour preserves real preview order, clipping, PNG and PDF plus one-step edits', async ({ page }) => {
  await fixture(page);
  const ids=await page.evaluate(async()=>{
    const {createLayer}=await import('/src/'+'domain/factories.ts'),{getProject}=await import('/src/'+'state/documentStore.ts'),{replaceDocument}=await import('/src/'+'history/commandBus.ts'),{sessionStore}=await import('/src/'+'state/sessionStore.ts'),{decodeImage,placeImage}=await import('/src/'+'assets/importImage.ts');
    const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const p=structuredClone(getProject()),pageId=p.pageOrder[0],outer=createLayer('panel',pageId),inner=createLayer('panel',pageId),upper=createLayer('panel',pageId);
    for (const id of p.pages[pageId].roots) { const background = p.layers[id]; if (background.type === 'pageBackground') background.fill = '#FFFFFF00'; }
    Object.assign(p.pages[pageId],{width:500,height:450});
    outer.geometry=[{x:0,y:0},{x:260,y:0},{x:260,y:280},{x:0,y:280}];outer.matrix=[1,0,0,1,100,100];outer.role='split';outer.children=[inner.id];outer.style.borderWidth=0;outer.style.fill='#FFFFFF00';
    inner.parentId=outer.id;inner.geometryMode='simple';inner.geometry=[{x:0,y:0},{x:240,y:0},{x:240,y:250},{x:170,y:250},{x:170,y:90},{x:80,y:90},{x:80,y:250},{x:0,y:250}];inner.style.borderWidth=0;inner.style.fill='#FFFFFF00';
    upper.geometry=[{x:0,y:0},{x:60,y:0},{x:60,y:70},{x:0,y:70}];upper.matrix=[1,0,0,1,110,160];upper.style.borderWidth=0;upper.style.fill='#0000FFFF';
    for(const l of[outer,inner,upper])p.layers[l.id]=l;p.pages[pageId].roots = [...p.pages[pageId].roots.filter((id: string) => p.layers[id]?.type === 'pageBackground'), ...([outer.id,upper.id])];const result=replaceDocument(numberFixture(p));if(!result.ok)throw Error(JSON.stringify(result));
    const canvas=document.createElement('canvas');canvas.width=canvas.height=600;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#ff000080';ctx.fillRect(0,0,600,600);const blob=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!),'image/png'));canvas.width=canvas.height=0;
    const decoded=await decodeImage(new File([blob],'contour.png',{type:'image/png'}),new AbortController().signal);if(!decoded.ok)throw Error('decode');const placed=placeImage(decoded.value,pageId,{x:0,y:0},inner.id);if(!placed.ok)throw Error(JSON.stringify(placed));
    sessionStore.setState({selection:[inner.id],scopeId:outer.id,viewportByPage:{[pageId]:{zoom:1,pan:{x:10,y:10}}}});return {inner:inner.id,outer:outer.id};
  });
  const before=await model(page),n=await history(page);await page.getByRole('button',{name:'修正分格轮廓'}).click();await expect(page.locator('.panel-contour-point')).toHaveCount(8);
  const viewport=(await page.locator('.canvas-viewport').boundingBox())!;await page.evaluate(async()=>(await import('/src/'+'state/runtimeStore.ts')).resetRenderStats());
  // Move the rightmost lower corner inward. It stays in its ancestor and original image coverage.
  await page.mouse.move(viewport.x+350,viewport.y+360);await page.mouse.down();await page.mouse.move(viewport.x+325,viewport.y+355,{steps:12});await page.mouse.up();
  expect(await model(page)).toEqual(before);expect(await history(page)).toBe(n);
  const result=await page.evaluate(async({inner})=>{
    const {currentDrawing}=await import('/src/'+'panels/drawingController.ts'),{runtimeStore}=await import('/src/'+'state/runtimeStore.ts'),{drawPage,hitLayer}=await import('/src/'+'render/drawScene.ts'),{exportPng,exportPdf}=await import('/src/'+'export/exportFiles.ts'),{resolveCrop}=await import('/src/'+'images/crop.ts');
    const active=currentDrawing() as DrawingSession;const p=active.preview,pageId=p.pageOrder[0],images=runtimeStore.getState().images;const canvas=document.createElement('canvas');canvas.width=500;canvas.height=450;drawPage(canvas.getContext('2d')!,p,pageId,images);const ctx=canvas.getContext('2d')!;const sample=(x:number,y:number)=>[...ctx.getImageData(x,y,1,1).data];
    const reference=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!),'image/png'));const png=await exportPng(p,pageId,images);if(!png.ok)throw Error(JSON.stringify(png));
    const pixels=async(blob:Blob)=>{const b=await createImageBitmap(blob),c=document.createElement('canvas');c.width=b.width;c.height=b.height;c.getContext('2d')!.drawImage(b,0,0);b.close();const result=[...c.getContext('2d')!.getImageData(0,0,c.width,c.height).data];c.width=c.height=0;return result;};
    const pdf=await exportPdf(p,images);if(!pdf.ok)throw Error(JSON.stringify(pdf));
    const image=Object.values(p.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find(l=>l.type==='image')!;if(image.type!=='image'||!image.crop||p.layers[inner].type!=='panel')throw Error('image');const oldImage=active.base.layers[image.id];if(oldImage.type!=='image'||!oldImage.crop||active.base.layers[inner].type!=='panel')throw Error('old image');
    const mapping=resolveCrop((p.layers[inner] as typeof active.base.layers[typeof inner]&{geometry:{x:number;y:number}[]}).geometry,{x:image.width,y:image.height},image.crop),original=resolveCrop((active.base.layers[inner] as typeof p.layers[typeof inner]&{geometry:{x:number;y:number}[]}).geometry,{x:image.width,y:image.height},oldImage.crop);
    const gesture=document.querySelectorAll<HTMLCanvasElement>(".konvajs-content canvas")[1], ratio=gesture.width/gesture.clientWidth;const gestureSample=(x:number,y:number)=>[...gesture.getContext("2d")!.getImageData(Math.round((x+10)*ratio),Math.round((y+10)*ratio),1,1).data];
    const gestureReference=document.createElement('canvas');gestureReference.width=gesture.width;gestureReference.height=gesture.height;const ref=gestureReference.getContext('2d')!;ref.scale(ratio,ratio);ref.translate(10,10);drawPage(ref,p,pageId,images);
    const actual=gesture.getContext('2d')!.getImageData(0,0,gesture.width,gesture.height).data,expected=ref.getImageData(0,0,gesture.width,gesture.height).data;
    const gestureEqual=actual.every((value,index)=>value===expected[index]);gestureReference.width=gestureReference.height=0;
    const hitProject=structuredClone(p);hitProject.pages[pageId].roots = [...hitProject.pages[pageId].roots.filter((id: string) => hitProject.layers[id]?.type === 'pageBackground'), ...([inner])];hitProject.layers[inner].parentId=null;hitProject.layers[inner].matrix=[1,0,0,1,100,100];
    const r={preview:structuredClone(p),gestureEqual,gestureUpper:gestureSample(130,180),gestureNotch:gestureSample(220,300),pngEqual:JSON.stringify(await pixels(reference))===JSON.stringify(await pixels(png.value)),notch:sample(220,300),upper:sample(130,180),inside:sample(300,300),outside:sample(390,300),hitNotch:hitLayer(hitProject,pageId,{x:220,y:300}),hitInside:hitLayer(hitProject,pageId,{x:300,y:300}),mapping,original,stats:runtimeStore.getState().renderStats,pdf:[...new Uint8Array(await pdf.value.arrayBuffer())]};canvas.width=canvas.height=0;return r;
  },ids);
  expect(result.gestureEqual).toBe(true);expect(result.gestureUpper).toEqual([0,0,255,255]);expect(result.gestureNotch).toEqual([0,0,0,0]);expect(result.pngEqual).toBe(true);expect(result.notch).toEqual([0,0,0,0]);expect(result.outside).toEqual([0,0,0,0]);expect(result.upper).toEqual([0,0,255,255]);expect(result.inside).toEqual([255,0,0,128]);expect(result.hitNotch).toBeNull();expect(result.hitInside).toBe(ids.inner);expect(result.stats.mainDraws).toBe(0);
  for(const key of ['scale','tx','ty']as const)expect(result.mapping[key]).toBeCloseTo(result.original[key],10);
  const {mkdir,writeFile}=await import('node:fs/promises');await mkdir('output/audit/panel-extension-pdf',{recursive:true});await writeFile(`output/audit/panel-extension-pdf/${test.info().project.name||'edge'}.pdf`,Buffer.from(result.pdf));
  await page.getByRole('button',{name:'闭合并应用'}).click();const after=await model(page);expect(after).toEqual(result.preview);expect(await history(page)).toBe(n+1);await undoRedo(page,before,after);const stored=await roundtrip(page);expect(stored.after).toEqual(after);
});


test('random frames independently move, resize and change stroke, with atomic generation and full undo/redo', async ({page})=>{
  await fixture(page);const empty=await model(page);await page.getByRole('button',{name:'随机分格',exact:true}).click();const dialog=page.getByRole('dialog',{name:'随机分格',exact:true});await dialog.getByLabel('随机布局风格').selectOption('regular');await dialog.getByRole('button',{name:'应用分格'}).click();
  const generated=await model(page),ids=generated.pages[generated.pageOrder[0]].roots.filter((id: string) => generated.layers[id].type !== 'pageBackground');expect(ids).toHaveLength(6);expect(Object.entries(generated.layers).filter(([, layer]) => (layer as { type: string }).type !== 'pageBackground').map(([id]) => id)).toHaveLength(6);for(const id of ids){expect(generated.layers[id].parentId).toBeNull();expect((generated.layers[id] as PanelLayer).randomSeed).toBe(42);}expect(await history(page)).toBe(1);
  const point=await page.evaluate(async(id)=>{const {getProject}=await import('/src/'+'state/documentStore.ts'),{sessionStore}=await import('/src/'+'state/sessionStore.ts');const p=getProject(),l=p.layers[id],vp=sessionStore.getState().viewportByPage[p.pageOrder[0]],r=document.querySelector('.canvas-viewport')!.getBoundingClientRect();return{x:r.x+vp.pan.x+l.geometry.reduce((n:number,v:{x:number})=>n+v.x,0)/l.geometry.length*vp.zoom,y:r.y+vp.pan.y+l.geometry.reduce((n:number,v:{y:number})=>n+v.y,0)/l.geometry.length*vp.zoom};},ids[0]);
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+24,point.y+18,{steps:12});await page.mouse.up();
  await expect(page.getByLabel('对象X',{exact:true})).toBeEnabled();const moved=await model(page);expect(moved.layers[ids[0]].matrix).not.toEqual(generated.layers[ids[0]].matrix);for(const id of ids.slice(1))expect(moved.layers[id]).toEqual(generated.layers[id]);
  const width=page.getByLabel('对象宽',{exact:true});await width.fill(String(Number(await width.inputValue())+30));await width.press('Enter');
  const stroke=page.getByLabel('对象边框',{exact:true});await stroke.fill('12');await stroke.press('Enter');const edited=await model(page);expect(edited.layers[ids[0]]).not.toEqual(moved.layers[ids[0]]);for(const id of ids.slice(1))expect(edited.layers[id]).toEqual(generated.layers[id]);expect(await history(page)).toBe(4);
  const file=await roundtrip(page);expect(file.after).toEqual(edited);for(let i=0;i<3;i++)await (await menuCommand(page, '撤销')).click();expect(await model(page)).toEqual(generated);await (await menuCommand(page, '撤销')).click();expect(await model(page)).toEqual(empty);for(let i=0;i<4;i++)await (await menuCommand(page, '重做')).click();expect(await model(page)).toEqual(edited);
});

test('an existing split layout can become independent frames without moving their page geometry',async({page})=>{
  await fixture(page);await page.evaluate(async()=>{const{createObjectDraft}=await import('/src/'+'app/actions.ts'),{execute}=await import('/src/'+'history/commandBus.ts'),{sessionStore}=await import('/src/'+'state/sessionStore.ts');const pageId=sessionStore.getState().activePageId,result=createObjectDraft('layout:grid-2x2',pageId);if(!result.ok)throw Error('legacy fixture');const {layer,descendants}=result.value;const made=execute({label:'既有旧版分格',context:{pageId,selection:[]},afterSelection:[layer.id],mutate(d: Project){d.layers[layer.id]=layer;for(const child of descendants)d.layers[child.id]=child;d.pages[pageId].roots.push(layer.id);}});if(!made.ok)throw Error(JSON.stringify(made));});const before=await model(page),n=await history(page);
  const positions=await page.evaluate(async()=>{const{getProject}=await import('/src/'+'state/documentStore.ts'),{worldMatrix}=await import('/src/'+'geometry/matrix.ts');const p=getProject();return Object.fromEntries(Object.values(p.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter((l:any)=>l.type==='panel'&&l.role==='leaf').map((l:any)=>[l.id,worldMatrix(p,l.id)]));});
  await page.getByRole('button',{name:'拆为独立分镜'}).click();const after=await model(page);expect(after.pages[after.pageOrder[0]].roots.filter((id: string) => after.layers[id].type !== 'pageBackground')).toHaveLength(4);expect(Object.entries(after.layers).filter(([, layer]) => (layer as { type: string }).type !== 'pageBackground').map(([id]) => id)).toHaveLength(4);for(const[id,matrix]of Object.entries(positions)){expect(after.layers[id].parentId).toBeNull();expect(after.layers[id].matrix).toEqual(matrix);}
  await expect(page.getByLabel('对象X',{exact:true})).toBeEnabled();expect(await history(page)).toBe(n+1);await undoRedo(page,before,after);
});
