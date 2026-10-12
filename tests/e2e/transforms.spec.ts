import { menuCommand, setMenuSnap } from './menuHelpers';
import { test, expect, type Page } from '@playwright/test';
async function observeNativePointer(page:Page){await page.evaluate(()=>{(window as any).__transformPointer={};const root=document.querySelector('.canvas-viewport')!;for(const phase of ['pointerdown','pointermove'])root.addEventListener(phase,event=>{const e=event as PointerEvent;(window as any).__transformPointer[phase]={x:e.clientX,y:e.clientY,trusted:e.isTrusted};},true);});}

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const source = (path: string) => performance.getEntriesByType('resource').find((e) => e.name.includes(`/src/${path}`))?.name ?? `/src/${path}`;
    const { documentStore } = await import(source('state/documentStore.ts')), { sessionStore } = await import(source('state/sessionStore.ts')), { runtimeStore } = await import(source('state/runtimeStore.ts'));
    const state = documentStore.getState(), session = sessionStore.getState();
    return { project: state.project, history: state.history.past.length, selection: session.selection, scope: session.scopeId, viewport: session.viewportByPage[session.activePageId], render: runtimeStore.getState().renderStats, preview: runtimeStore.getState().previewProject };
  });
}
async function resetStats(page: Page) { await page.evaluate(async () => { const url = performance.getEntriesByType('resource').find((e) => e.name.includes('/src/state/runtimeStore.ts'))!.name; (await import(url)).resetRenderStats(); }); }
async function point(page: Page, x: number, y: number) {
  const state = await snapshot(page), rect = await page.locator('.canvas-viewport').boundingBox();
  return { x: rect!.x + state.viewport.pan.x + x * state.viewport.zoom, y: rect!.y + state.viewport.pan.y + y * state.viewport.zoom };
}
async function groupFixture(page: Page) {
  await page.evaluate(async () => {
    const source = (path: string) => performance.getEntriesByType('resource').find((e) => e.name.includes(`/src/${path}`))?.name ?? `/src/${path}`;
    const { createLayer, createProject } = await import(source('domain/factories.ts')), { replaceDocument } = await import(source('history/commandBus.ts')), { sessionStore } = await import(source('state/sessionStore.ts')); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const { multiply, rotationRad, translation } = await import(source('geometry/matrix.ts'));
    const project = createProject({ background: false }), pageId = project.pageOrder[0], group = createLayer('group', pageId), panel = createLayer('panel', pageId), text = createLayer('text', pageId);
    group.children = [panel.id, text.id]; panel.parentId = group.id; text.parentId = group.id;
    group.matrix = multiply(translation(850, 1100), multiply(rotationRad(37 * Math.PI / 180), [1.3, 0, .2, .8, 0, 0]));
    for (const layer of [group, panel, text]) project.layers[layer.id] = layer;
    project.pages[pageId].roots = [...project.pages[pageId].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...([group.id])]; replaceDocument(numberFixture(project)); sessionStore.setState({ activePageId: pageId, selection: [group.id], scopeId: null, snap16: false });
  });
}

test('dimension properties apply quantization, reject empty input, cancel Escape and undo completely', async ({ page }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); await setMenuSnap(page, true);
  const before = await snapshot(page), width = page.getByLabel('对象宽');
  await width.fill('101'); await width.press('Enter'); await expect(width).toHaveValue('96');
  await width.fill('104'); await width.press('Enter'); await expect(width).toHaveValue('112');
  const applied = await snapshot(page); expect(applied.history).toBe(before.history + 2);
  await width.fill('600'); await width.press('Escape'); await expect(width).toHaveValue('112'); expect((await snapshot(page)).history).toBe(applied.history);
  await width.fill(''); await width.press('Enter'); await expect(width).toHaveValue('112'); await expect(page.getByText('宽必须是有效数字', { exact: true })).toBeVisible();
  await page.getByLabel('对象旋转').fill('360'); await page.getByLabel('对象旋转').press('Enter'); await expect(page.getByLabel('对象旋转')).toHaveValue('0');
  await (await menuCommand(page, '撤销')).click(); await expect(width).toHaveValue('96'); await (await menuCommand(page, '撤销')).click(); expect((await snapshot(page)).project).toEqual(before.project);
});

test('group resize under rotation and shear fixes the opposite page point without changing child geometry or font', async ({ page }) => {
  await page.goto('/'); await groupFixture(page); await page.waitForTimeout(100);
  const before = await snapshot(page), group = before.project.layers[before.selection[0]];
  const world = (x: number, y: number) => ({ x: group.matrix[0] * x + group.matrix[2] * y + group.matrix[4], y: group.matrix[1] * x + group.matrix[3] * y + group.matrix[5] });
  // Fixture text and panel union is 600x400, with origin (0,0).
  const startPage = world(0, 0), fixed = world(600, 400), pointerPage = world(-120, -80), start = await point(page, startPage.x, startPage.y), end = await point(page, pointerPage.x, pointerPage.y);
  await page.mouse.move(start.x, start.y); await page.keyboard.down('Shift'); await page.mouse.down(); await page.waitForTimeout(100); await resetStats(page);
  await page.mouse.move(end.x, end.y, { steps: 20 }); await page.waitForTimeout(100);
  const during = await snapshot(page); expect(during.project).toEqual(before.project); expect(during.render.mainDraws).toBe(0); expect(during.render.gestureDraws).toBeGreaterThan(0);
  const m = during.preview.layers[group.id].matrix;
  expect(m[0] * 600 + m[2] * 400 + m[4]).toBeCloseTo(fixed.x, 6); expect(m[1] * 600 + m[3] * 400 + m[5]).toBeCloseTo(fixed.y, 6);
  await page.mouse.up(); await page.keyboard.up('Shift'); const after = await snapshot(page);
  expect(after.history).toBe(before.history + 1); for (const id of group.children) expect(after.project.layers[id]).toEqual(before.project.layers[id]);
  await page.keyboard.press('Control+z'); expect((await snapshot(page)).project).toEqual(before.project);
});

test('rotation handle snaps absolute angle to 5 degrees, Alt releases snap, and Esc first cancels then exits scope', async ({ page }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  await page.getByLabel('对象旋转').fill('13'); await page.getByLabel('对象旋转').press('Enter');
  const before = await snapshot(page), layer = before.project.layers[before.selection[0]], centerPage = { x: layer.matrix[0] * 300 + layer.matrix[2] * 200 + layer.matrix[4], y: layer.matrix[1] * 300 + layer.matrix[3] * 200 + layer.matrix[5] }, center = await point(page, centerPage.x, centerPage.y);
  const startAngle = 13 * Math.PI / 180 - Math.PI / 2, radius = 200 * before.viewport.zoom + 24;
  const at = (angle: number) => ({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
  await observeNativePointer(page); const start = at(startAngle); await page.mouse.move(start.x, start.y); await page.mouse.down(); const snapped = at(startAngle + 15 * Math.PI / 180); await page.mouse.move(snapped.x, snapped.y, { steps: 12 });
  await expect(page.getByLabel('对象旋转')).toHaveValue('30'); await page.keyboard.down('Alt'); const unsnapped = at(startAngle + 30 * Math.PI / 180); await page.mouse.move(unsnapped.x, unsnapped.y, { steps: 12 }); const input=await page.evaluate(()=>(window as any).__transformPointer);expect(input.pointerdown.trusted&&input.pointermove.trusted).toBe(true);const expected=13+(Math.atan2(input.pointermove.y-center.y,input.pointermove.x-center.x)-Math.atan2(input.pointerdown.y-center.y,input.pointerdown.x-center.x))*180/Math.PI;await expect(page.getByLabel('对象旋转')).toHaveValue(String(Math.round(expected*100)/100));
  await page.mouse.up(); await page.keyboard.up('Alt'); expect((await snapshot(page)).history).toBe(before.history + 1); await page.keyboard.press('Control+z'); expect((await snapshot(page)).project).toEqual(before.project);
  await groupFixture(page); await page.waitForTimeout(100);
  const groupState = await snapshot(page), g = groupState.project.layers[groupState.selection[0]], inside = await point(page, g.matrix[4] + g.matrix[0] * 300 + g.matrix[2] * 200, g.matrix[5] + g.matrix[1] * 300 + g.matrix[3] * 200);
  await page.mouse.dblclick(inside.x, inside.y); expect((await snapshot(page)).scope).toBe(g.id);
  await page.keyboard.press('Escape'); expect((await snapshot(page)).scope).toBeNull();
});

test('move alignment uses screen threshold and Alt, while previews preserve history and main layer', async ({ page }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  const before = await snapshot(page), layer = before.project.layers[before.selection[0]], center = await point(page, layer.matrix[4] + 300, layer.matrix[5] + 200);await observeNativePointer(page);
  await page.mouse.move(center.x, center.y); await page.mouse.down(); await page.mouse.move(center.x + 5, center.y, { steps: 5 }); await page.waitForTimeout(100); await resetStats(page);
  await page.mouse.move(center.x + 8, center.y, { steps: 5 }); await page.waitForTimeout(100);
  const held = await snapshot(page); expect(held.preview.layers[layer.id].matrix[4]).toBeCloseTo(layer.matrix[4], 6); expect(held.history).toBe(before.history); expect(held.render.mainDraws).toBe(0);
  await page.keyboard.down('Alt'); await page.mouse.move(center.x + 8.5, center.y, { steps: 2 }); await page.waitForTimeout(100);
  const input=await page.evaluate(()=>(window as any).__transformPointer);expect(input.pointerdown.trusted&&input.pointermove.trusted).toBe(true);expect((await snapshot(page)).preview.layers[layer.id].matrix[4] - layer.matrix[4]).toBeCloseTo((input.pointermove.x-input.pointerdown.x) / before.viewport.zoom, 6);
  await page.keyboard.press('Escape'); await page.mouse.up(); await page.keyboard.up('Alt'); expect((await snapshot(page)).project).toEqual(before.project);
});

test('wheel pans by default and Ctrl wheel keeps its page anchor with a bitmap-only preview', async ({ page }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  const before = await snapshot(page), rect = await page.locator('.canvas-viewport').boundingBox(), x = rect!.x + rect!.width / 2, y = rect!.y + rect!.height / 2;
  await page.mouse.move(x, y); await page.mouse.wheel(30, 40); await page.waitForTimeout(240);
  const panned = await snapshot(page); expect(panned.viewport.zoom).toBe(before.viewport.zoom); expect(panned.viewport.pan.x).toBeCloseTo(before.viewport.pan.x - 30); expect(panned.viewport.pan.y).toBeCloseTo(before.viewport.pan.y - 40);
  await page.evaluate(() => { (window as any).__wheelEvents=[];document.querySelector('.canvas-viewport')!.addEventListener('wheel', (event) => { const e = event as WheelEvent,r=document.querySelector('.canvas-viewport')!.getBoundingClientRect();(window as any).__wheelEvents.push({x:e.clientX,y:e.clientY,rect:{x:r.x,y:r.y,width:r.width,height:r.height},dpr:devicePixelRatio});(window as any).__wheelPoint = { x: e.clientX, y: e.clientY }; }); });
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.waitForTimeout(40); await resetStats(page); await page.mouse.wheel(0, -100); await page.waitForTimeout(40);
  const during = await snapshot(page); expect(during.render.mainDraws).toBe(0); expect(during.render.gestureDraws).toBeGreaterThan(0); expect(during.viewport).toEqual(panned.viewport);
  await page.keyboard.up('Control'); await page.waitForTimeout(240); const after = await snapshot(page), actual = await page.evaluate(() => (window as any).__wheelPoint), sx = actual.x - rect!.x, sy = actual.y - rect!.y;
  console.log(JSON.stringify({before:before.viewport,panned:panned.viewport,after:after.viewport,rect,events:await page.evaluate(()=>(window as any).__wheelEvents),afterRect:await page.locator('.canvas-viewport').boundingBox()}));
  expect((sx - after.viewport.pan.x) / after.viewport.zoom).toBeCloseTo((sx - panned.viewport.pan.x) / panned.viewport.zoom, 6); expect((sy - after.viewport.pan.y) / after.viewport.zoom).toBeCloseTo((sy - panned.viewport.pan.y) / panned.viewport.zoom, 6);
  expect(after.project).toEqual(before.project); expect(after.history).toBe(before.history); await (await menuCommand(page, '适应页面')).click(); expect((await snapshot(page)).viewport).toEqual(before.viewport);
});

test('two real touch points cancel an object drag and pinch without document history', async ({ page, context }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); const before = await snapshot(page), rect = await page.locator('.canvas-viewport').boundingBox();
  const cx = rect!.x + rect!.width / 2, cy = rect!.y + rect!.height / 2, cdp = await context.newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', gap: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ id: 1, x: cx - gap, y: cy }, { id: 2, x: cx + gap, y: cy }] });
  await send('touchStart', 50); await page.waitForTimeout(100); await resetStats(page); await send('touchMove', 100); await page.waitForTimeout(100);
  const during = await snapshot(page); expect(during.render.mainDraws).toBe(0); expect(during.render.gestureDraws).toBeGreaterThan(0); await send('touchEnd', 100);
  const after = await snapshot(page); expect(after.viewport.zoom).toBeCloseTo(before.viewport.zoom * 2, 6); expect(after.project).toEqual(before.project); expect(after.history).toBe(before.history); await cdp.detach();
});
