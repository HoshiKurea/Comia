import { expect, test, type Page } from '@playwright/test';
import type { DocumentStoreState } from '../../src/state/documentStore';

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const { getDocument } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts');
    const doc = getDocument() as DocumentStoreState, session = sessionStore.getState();
    return { project: doc.project, history: doc.history, viewport: session.viewportByPage[session.activePageId], render: runtimeStore.getState().renderStats, active: runtimeStore.getState().gestureActive };
  });
}

test('native CDP pinch ignores a two-pixel start and then keeps the moving midpoint page anchor without history', async ({ page, context }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  await page.evaluate(async () => {
    const { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const id = sessionStore.getState().activePageId; sessionStore.setState({ selection: [], viewportByPage: { [id]: { zoom: 1, pan: { x: 20, y: 30 } } } });
  });
  const before = await snapshot(page), rect = (await page.locator('.canvas-viewport').boundingBox())!, initialMidpoint = { x: 250, y: 220 };
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.drawImage;
    (window as any).__viewTransforms = [];
    CanvasRenderingContext2D.prototype.drawImage = function(image: CanvasImageSource, ...coordinates: number[]) {
      if (this.canvas === document.querySelectorAll('.konvajs-content canvas')[1] && image instanceof HTMLCanvasElement) {
        const m = this.getTransform(); (window as any).__viewTransforms.push([m.a, m.b, m.c, m.d, m.e, m.f]);
      }
      return Reflect.apply(original, this, [image, ...coordinates]);
    };
  });
  const cdp = await context.newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', halfDistance: number, move = { x: 0, y: 0 }) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [
    { id: 1, x: rect.x + initialMidpoint.x + move.x - halfDistance, y: rect.y + initialMidpoint.y + move.y },
    { id: 2, x: rect.x + initialMidpoint.x + move.x + halfDistance, y: rect.y + initialMidpoint.y + move.y },
  ] });
  try {
    await send('touchStart', 1);
    // Chromium sends pointermove once per changed touch. Move only the left
    // contact to establish an exact 4px baseline, rather than assuming that
    // simultaneous CDP contacts arrive as one atomic pointer event.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
      { id: 1, x: rect.x + initialMidpoint.x - 3, y: rect.y + initialMidpoint.y },
      { id: 2, x: rect.x + initialMidpoint.x + 1, y: rect.y + initialMidpoint.y },
    ] });
    await page.evaluate(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); const { resetRenderStats } = await import('/src/' + 'state/runtimeStore.ts'); resetRenderStats(); });
    // Crossing four CSS pixels establishes the start distance; it must not zoom yet.
    const unchanged = await snapshot(page); expect(unchanged.viewport).toEqual(before.viewport); expect(unchanged.project).toEqual(before.project);
    const thresholdTransform = await page.evaluate(() => (window as any).__viewTransforms.at(-1));
    expect(thresholdTransform).toEqual([1, 0, 0, 1, 20, 30]);
    await send('touchMove', 4, { x: 49, y: 35 });
    await expect.poll(async () => (await snapshot(page)).render.gestureDraws).toBeGreaterThan(0);
    const during = await snapshot(page); expect(during.render.mainDraws).toBe(0); expect(during.viewport).toEqual(before.viewport); expect(during.history).toEqual(before.history);
    await send('touchEnd', 4); await expect.poll(async () => (await snapshot(page)).active).toBe(false);
    const after = await snapshot(page); expect(after.viewport.zoom).toBeCloseTo(2, 6);
    expect((initialMidpoint.x + 49 - after.viewport.pan.x) / after.viewport.zoom).toBeCloseTo((initialMidpoint.x - 1 - before.viewport.pan.x) / before.viewport.zoom, 6);
    expect((initialMidpoint.y + 35 - after.viewport.pan.y) / after.viewport.zoom).toBeCloseTo((initialMidpoint.y - before.viewport.pan.y) / before.viewport.zoom, 6);
    expect(after.project).toEqual(before.project); expect(after.history).toEqual(before.history);
  } finally { await cdp.detach(); }
});
