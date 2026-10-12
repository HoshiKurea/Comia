import { menuCommand, setMenuSnap } from './menuHelpers';
import { expect, test, type Page } from '@playwright/test';

async function inspect(page: Page) {
  return page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const { getDocument } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts');
    const doc = getDocument(), s = sessionStore.getState(), panel = doc.project.layers[s.selection[0]], vp = s.viewportByPage[s.activePageId], root = document.querySelector('.canvas-viewport')!.getBoundingClientRect();
    return { project: doc.project, history: doc.history, preview: runtimeStore.getState().previewProject, active: runtimeStore.getState().gestureActive, events: (window as any).__pointerConcurrency, pixels: document.querySelector<HTMLCanvasElement>('.konvajs-content canvas')!.toDataURL(), point: { x: root.x + vp.pan.x + (panel.matrix[4] + 300) * vp.zoom, y: root.y + vp.pan.y + (panel.matrix[5] + 200) * vp.zoom } };
  });
}

test('a native concurrent pen cannot replace or commit the mouse preview; native owner capture loss cancels and a fresh owner commits once', async ({ page, context }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); await setMenuSnap(page, false);
  await page.evaluate(() => { (window as any).__pointerConcurrency = []; const root = document.querySelector('.canvas-viewport')!; for (const phase of ['pointerdown', 'pointermove', 'pointerup', 'lostpointercapture']) root.addEventListener(phase, (event) => { const e = event as PointerEvent; (window as any).__pointerConcurrency.push({ phase, id: e.pointerId, kind: e.pointerType, trusted: e.isTrusted }); }, true); });
  const before = await inspect(page), client = await context.newCDPSession(page);
  await page.mouse.move(before.point.x, before.point.y); await page.mouse.down(); await page.mouse.move(before.point.x + 30, before.point.y + 20);
  const mouse = await inspect(page); expect(mouse.active).toBe(true); expect(mouse.preview).not.toBeNull();
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', pointerType: 'pen', x: before.point.x + 30, y: before.point.y + 20, button: 'left', buttons: 1, clickCount: 1, force: .5 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', pointerType: 'pen', x: before.point.x + 50, y: before.point.y + 20, button: 'left', buttons: 1, force: .5 });
  const pen = await inspect(page); expect(pen.events).toContainEqual({ phase: 'pointerdown', id: 2, kind: 'pen', trusted: true }); expect(pen.project).toEqual(before.project); expect(pen.history).toEqual(before.history); expect(pen.preview).toEqual(mouse.preview);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', pointerType: 'pen', x: before.point.x + 50, y: before.point.y + 20, button: 'left', buttons: 0, clickCount: 1 });
  // A foreign pointercancel is a control-routing boundary, deliberately marked
  // synthetic; the pen down/move/up above came from the real browser backend.
  await page.locator('.canvas-viewport').dispatchEvent('pointercancel', { pointerId: 2, pointerType: 'pen', bubbles: true });
  const foreignUp = await inspect(page); expect(foreignUp.project).toEqual(before.project); expect(foreignUp.history).toEqual(before.history); expect(foreignUp.preview).toEqual(mouse.preview); expect(foreignUp.active).toBe(true);
  // CDP mouse and pen share backend button state. Its pen release causes the
  // next native mouse move to report loss of the owning mouse capture. That
  // actual loss must cancel, even though the foreign pen events did not.
  await page.mouse.move(before.point.x + 45, before.point.y + 25); const cancelled = await inspect(page);
  expect(cancelled.events).toContainEqual({ phase: 'lostpointercapture', id: 1, kind: 'mouse', trusted: true });
  expect(cancelled.project).toEqual(before.project); expect(cancelled.history).toEqual(before.history); expect(cancelled.preview).toBeNull(); expect(cancelled.active).toBe(false); expect(cancelled.pixels).toBe(before.pixels);
  await page.mouse.up(); expect((await inspect(page)).history).toEqual(before.history);
  await page.mouse.move(before.point.x, before.point.y); await page.mouse.down(); await page.mouse.move(before.point.x + 45, before.point.y + 25);
  const final = await inspect(page); expect(final.preview).not.toBeNull(); await page.mouse.up(); const committed = await inspect(page);
  expect(committed.project).toEqual(final.preview); expect(committed.history.past.length).toBe(before.history.past.length + 1); expect(committed.active).toBe(false); expect(committed.preview).toBeNull();
  await (await menuCommand(page, '撤销')).click(); const undone = await inspect(page); expect(undone.project).toEqual(before.project); expect(undone.pixels).toBe(before.pixels);
});
