import { expect, test, type Page } from '@playwright/test';

async function inspect(page: Page) {
  return page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const { getDocument } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts');
    const doc = getDocument(), session = sessionStore.getState(), runtime = runtimeStore.getState(), panel = doc.project.layers[session.selection[0]], vp = session.viewportByPage[session.activePageId], root = document.querySelector('.canvas-viewport')!.getBoundingClientRect();
    return { project: doc.project, history: doc.history, preview: runtime.previewProject, active: runtime.gestureActive, pixels: document.querySelector<HTMLCanvasElement>('.konvajs-content canvas')!.toDataURL(), center: { x: root.x + vp.pan.x + (panel.matrix[4] + 300) * vp.zoom, y: root.y + vp.pan.y + (panel.matrix[5] + 200) * vp.zoom } };
  });
}

// This native-focus protocol is deliberately registered only in the Edge
// suite. Firefox/WebKit headless bringToFront did not produce a blur, so their
// native focus behavior remains unverified, not replaced by a synthetic event.
test('a trusted Edge window blur from a real peer tab cancels the ordinary drag and a late pointer release cannot commit it', async ({ page, context }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  const client = await context.newCDPSession(page);
  // Disable Playwright's forced focus before starting, so the browser reports
  // actual tab focus and emits a trusted Window event on peer activation.
  await client.send('Emulation.setFocusEmulationEnabled', { enabled: false }); await page.bringToFront(); await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
  await page.evaluate(() => { (window as any).__nativeBlurs = []; window.addEventListener('blur', (event) => (window as any).__nativeBlurs.push(event.isTrusted)); });
  const before = await inspect(page); await page.mouse.move(before.center.x, before.center.y); await page.mouse.down(); await page.mouse.move(before.center.x + 30, before.center.y + 20, { steps: 4 });
  const moving = await inspect(page); expect(moving.active).toBe(true); expect(moving.preview).not.toBeNull(); expect(moving.project).toEqual(before.project); expect(moving.history).toEqual(before.history);
  const peer = await context.newPage(); await peer.goto('about:blank'); await peer.bringToFront();
  await expect.poll(() => page.evaluate(() => (window as any).__nativeBlurs)).toEqual([true]); expect(await page.evaluate(() => document.hasFocus())).toBe(false);
  await page.bringToFront(); await page.mouse.up(); const cancelled = await inspect(page);
  expect(cancelled.project).toEqual(before.project); expect(cancelled.history).toEqual(before.history); expect(cancelled.preview).toBeNull(); expect(cancelled.active).toBe(false); expect(cancelled.pixels).toBe(before.pixels); await peer.close();
});
