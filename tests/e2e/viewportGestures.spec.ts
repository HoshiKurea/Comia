import { menuCommand } from './menuHelpers';
import { expect, test, type Page } from '@playwright/test';
import type { DocumentStoreState } from '../../src/state/documentStore';

async function fixture(page: Page) {
  await page.goto('/');
  await expect.poll(() => page.evaluate(async () => {
    const { getProject } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    return Boolean(getProject().pages[sessionStore.getState().activePageId]);
  })).toBe(true);
  await page.evaluate(async () => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts'), { replaceDocument } = await import('/src/' + 'history/commandBus.ts'); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { awaitFonts } = await import('/src/' + 'text/fonts.ts');
    const project = createProject({ background: false }), pageId = project.pageOrder[0], text = createLayer('text', pageId);
    Object.assign(project.pages[pageId], { width: 600, height: 400 });
    text.matrix = [1, 0, 0, 1, 80, 80]; text.box = { x: 0, y: 0, width: 400, height: 260 };
    text.text.content = '漫画缩放清晰度测试'.repeat(4); text.text.font.size = 24;
    project.layers[text.id] = text; project.pages[pageId].roots = [...project.pages[pageId].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...([text.id])];
    const ready = await awaitFonts(project); if (!ready.ok) throw Error(JSON.stringify(ready.problems));
    const result = replaceDocument(numberFixture(project)); if (!result.ok) throw Error(JSON.stringify(result.problems));
    sessionStore.setState({ activePageId: pageId, scopeId: null, selection: [], toolMode: 'select', viewportByPage: { [pageId]: { zoom: .25, pan: { x: 80, y: 80 } } } });
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}
async function state(page: Page) {
  return page.evaluate(async () => {
    const { getDocument } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts');
    const doc = getDocument() as DocumentStoreState, session = sessionStore.getState();
    return { project: doc.project, history: doc.history, viewport: session.viewportByPage[session.activePageId], preview: runtimeStore.getState().previewProject, active: runtimeStore.getState().gestureActive };
  });
}

test('wheel bitmap preview enlarges low-resolution text, then restores exact vector pixels without reflow or thumbnail repaint', async ({ page }, info) => {
  await fixture(page); const before = await state(page);
  const actual = await page.evaluate(async () => {
    const { getProject } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const { resetRenderStats, runtimeStore } = await import('/src/' + 'state/runtimeStore.ts'), { compileScene } = await import('/src/' + 'render/compileScene.ts');
    const { snapshotSceneFonts } = await import('/src/' + 'text/fonts.ts'), { drawPage } = await import('/src/' + 'render/drawScene.ts');
    const session = sessionStore.getState(), project = getProject(), id = session.activePageId, original = session.viewportByPage[id];
    const root = document.querySelector<HTMLElement>('.canvas-viewport')!, rect = root.getBoundingClientRect(), at = { x: 110, y: 110 };
    const canvases = document.querySelectorAll<HTMLCanvasElement>('.konvajs-content canvas'), main = canvases[0], gesture = canvases[1];
    const thumb = document.querySelector<HTMLCanvasElement>('.layer-thumbnail')!, paints = thumb.dataset.paintCount, thumbnail = thumb.toDataURL();
    const textId = project.pages[id].roots[0], layout = compileScene(project, id, snapshotSceneFonts(project, id), { snapshot: false }).text.text.get(textId)!.layout;
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    // Dispatch eight cancelable browser wheel events in one task, then repeat per frame.
    // Each burst multiplies zoom by sqrt(2); four bursts turn 25% into 100%.
    const wheel = () => root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, clientX: rect.x + at.x, clientY: rect.y + at.y, deltaY: -Math.log(Math.sqrt(2)) * 1000 / 8 }));
    wheel(); await frame(); resetRenderStats();
    // The first event is part of the first burst; seven more complete it.
    for (let n = 0; n < 7; n++) wheel(); await frame();
    for (let burst = 0; burst < 3; burst++) { for (let n = 0; n < 8; n++) wheel(); await frame(); }
    const during = { stats: { ...runtimeStore.getState().renderStats }, viewport: sessionStore.getState().viewportByPage[id], paints: thumb.dataset.paintCount, thumbnail: thumb.toDataURL(), mainVisible: main.style.display, gestureVisible: gesture.style.display };
    const preview = gesture.getContext('2d')!.getImageData(0, 0, gesture.width, gesture.height).data;
    const reference = document.createElement('canvas'); reference.width = main.width; reference.height = main.height;
    const target = { zoom: 1, pan: { x: at.x - (at.x - original.pan.x) / original.zoom, y: at.y - (at.y - original.pan.y) / original.zoom } };
    const ctx = reference.getContext('2d')!; ctx.scale(window.devicePixelRatio, window.devicePixelRatio); ctx.translate(target.pan.x, target.pan.y); ctx.scale(target.zoom, target.zoom); drawPage(ctx, project, id, new Map());
    const expected = ctx.getImageData(0, 0, reference.width, reference.height).data;
    const previewDiff = preview.reduce((count, value, index) => count + Number(value !== expected[index]), 0);
    await new Promise((resolve) => setTimeout(resolve, 200)); await frame();
    const final = main.getContext('2d')!.getImageData(0, 0, main.width, main.height).data;
    const finalDiff = final.reduce((count, value, index) => count + Number(value !== expected[index]), 0);
    const afterLayout = compileScene(getProject(), id, snapshotSceneFonts(project, id), { snapshot: false }).text.text.get(textId)!.layout;
    const result = { during, previewDiff, finalDiff, layout, afterLayout, target, original, paints, thumbnail, finalViewport: sessionStore.getState().viewportByPage[id], finalStats: runtimeStore.getState().renderStats, mainVisible: main.style.display, gestureVisible: gesture.style.display, active: runtimeStore.getState().gestureActive };
    reference.width = reference.height = 0; return result;
  });
  expect(actual.during.viewport).toEqual(before.viewport); expect(actual.during.stats.mainDraws).toBe(0);
  expect(actual.during.stats.gestureDraws).toBeGreaterThan(0); expect(actual.during.stats.gestureDraws).toBeLessThanOrEqual(8);
  expect(actual.during.mainVisible).toBe('none'); expect(actual.during.gestureVisible).not.toBe('none');
  expect(actual.during.paints).toBe(actual.paints); expect(actual.during.thumbnail).toBe(actual.thumbnail);
  expect(actual.previewDiff).toBeGreaterThan(100); expect(actual.finalDiff).toBe(0); expect(actual.afterLayout).toEqual(actual.layout);
  expect(actual.finalViewport.zoom).toBeCloseTo(1, 10); expect(actual.finalViewport.pan.x).toBeCloseTo(actual.target.pan.x, 8); expect(actual.finalViewport.pan.y).toBeCloseTo(actual.target.pan.y, 8);
  expect(actual.mainVisible).not.toBe('none'); expect(actual.gestureVisible).toBe('none'); expect(actual.active).toBe(false); expect(actual.finalStats.mainDraws).toBeGreaterThan(0);
  const after = await state(page); expect(after.project).toEqual(before.project); expect(after.history).toEqual(before.history);
  await info.attach('preview-and-final-pixels', { body: JSON.stringify(actual), contentType: 'application/json' });
});

test('zoom clamps at both limits, outside wheel remains unhandled, and Fit centers desktop and a 48px viewport', async ({ page }) => {
  await fixture(page); const before = await state(page);
  for (const [delta, zoom] of [[-10000, 8], [10000, .05]]) {
    const values = await page.evaluate(async (delta) => {
      const { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
      const root = document.querySelector<HTMLElement>('.canvas-viewport')!, rect = root.getBoundingClientRect(), session = sessionStore.getState(), start = session.viewportByPage[session.activePageId];
      root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: delta, clientX: rect.x + 200, clientY: rect.y + 150 }));
      await new Promise((resolve) => setTimeout(resolve, 220));
      const next = sessionStore.getState().viewportByPage[session.activePageId]; return { start, next };
    }, delta);
    expect(values.next.zoom).toBe(zoom);
    expect((200 - values.next.pan.x) / zoom).toBeCloseTo((200 - values.start.pan.x) / values.start.zoom, 6);
    expect((150 - values.next.pan.y) / zoom).toBeCloseTo((150 - values.start.pan.y) / values.start.zoom, 6);
  }
  const outsideBefore = await state(page);
  expect(await (await menuCommand(page, '保存')).evaluate((button) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 }); button.dispatchEvent(event); return event.defaultPrevented;
  })).toBe(false);
  expect((await state(page)).viewport).toEqual(outsideBefore.viewport);
  for (const narrow of [false, true]) {
    if (narrow) { await page.locator('.canvas-viewport').evaluate((root) => { (root as HTMLElement).style.width = '48px'; (root as HTMLElement).style.height = '48px'; }); await expect.poll(() => page.locator('.konvajs-content').evaluate((node) => (node as HTMLElement).clientWidth)).toBe(48); }
    await (await menuCommand(page, '适应页面')).click();
    const rect = (await page.locator('.canvas-viewport').boundingBox())!, next = (await state(page)).viewport;
    const zoom = Math.max(.05, Math.min(8, Math.min(Math.max(1, rect.width - 64) / 600, Math.max(1, rect.height - 64) / 400)));
    expect(next.zoom).toBeCloseTo(zoom, 10); expect(next.pan.x).toBeCloseTo((rect.width - 600 * zoom) / 2, 6); expect(next.pan.y).toBeCloseTo((rect.height - 400 * zoom) / 2, 6);
    if (!narrow) { expect(next.pan.x).toBeGreaterThanOrEqual(32 - 1e-9); expect(next.pan.y).toBeGreaterThanOrEqual(32 - 1e-9); }
  }
  const after = await state(page); expect(after.project).toEqual(before.project); expect(after.history).toEqual(before.history);
});

test('starting a view wheel during a real object drag discards its preview and late pointerup cannot commit it', async ({ page }) => {
  await fixture(page);
  await page.evaluate(async () => { const { sessionStore } = await import('/src/' + 'state/sessionStore.ts'); const id = sessionStore.getState().activePageId; sessionStore.setState({ viewportByPage: { [id]: { zoom: 1, pan: { x: 20, y: 20 } } } }); });
  await page.locator('.canvas-viewport').focus(); const before = await state(page), rect = (await page.locator('.canvas-viewport').boundingBox())!;
  await page.keyboard.down('Alt'); await page.mouse.move(rect.x + 230, rect.y + 180); await page.mouse.down(); await page.mouse.move(rect.x + 283, rect.y + 211, { steps: 8 });
  await expect.poll(async () => (await state(page)).preview).not.toBeNull();
  await page.mouse.wheel(25, 40); await page.mouse.up(); await page.keyboard.up('Alt'); await expect.poll(async () => (await state(page)).active).toBe(false);
  const after = await state(page); expect(after.preview).toBeNull(); expect(after.project).toEqual(before.project); expect(after.history).toEqual(before.history);
  expect(after.viewport.zoom).toBe(1); expect(after.viewport.pan).toEqual({ x: -5, y: -20 });
});
