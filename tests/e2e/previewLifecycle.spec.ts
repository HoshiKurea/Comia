import { test, expect, type Page } from '@playwright/test';
import type { snapshot as readSnapshot } from '../fixtures/previewHarness';

async function snapshot(page: Page) {
  return page.evaluate(async () => (await import('/tests/fixtures/' + 'previewHarness.tsx')).snapshot() as ReturnType<typeof readSnapshot>);
}

test('actual StrictMode canvas unmount releases active run surfaces and cancels a queued native move before remount', async ({ page }) => {
  await page.goto('/tests/fixtures/preview-harness.html');
  await expect(page.locator('.konvajs-content canvas')).toHaveCount(4);
  await expect(page.locator('.canvas-viewport')).toHaveCSS('height', '600px');
  await page.waitForTimeout(80);
  const initial = await snapshot(page);
  expect(initial.stages).toBe(1); expect(initial.layerCounts).toEqual([4]);
  await page.evaluate(async () => (await import('/tests/fixtures/' + 'previewHarness.tsx')).installAllocationProbe());
  // The green panel is exposed between the lower red and upper blue panel.
  await page.mouse.move(180, 140); await page.mouse.down(); await page.mouse.move(188, 147);
  await expect.poll(async () => (await snapshot(page)).preview !== null).toBe(true);
  const live = await snapshot(page);
  expect(live.active).toBe(true); expect(live.project).toEqual(initial.project); expect(live.history).toEqual(initial.history);
  expect(live.allocations.filter((surface) => surface.width > 0 && surface.height > 0)).toHaveLength(2);
  await page.evaluate(async () => (await import('/tests/fixtures/' + 'previewHarness.tsx')).unmountOnNextNativeMove());
  // This trusted event queues the production rAF, then unmounts in the same
  // dispatch task, before the frame callback can run.
  await page.mouse.move(211, 161);
  await expect(page.locator('.konvajs-content canvas')).toHaveCount(0);
  await page.waitForTimeout(80);
  const removed = await snapshot(page);
  expect(removed.active).toBe(false); expect(removed.preview).toBeNull();
  expect(removed.project).toEqual(initial.project); expect(removed.history).toEqual(initial.history);
  expect(removed.stages).toBe(0);
  expect(removed.allocations.every((surface) => surface.width === 0 && surface.height === 0)).toBe(true);
  await page.mouse.up();
  await page.evaluate(async () => { const fixture = await import('/tests/fixtures/' + 'previewHarness.tsx'); fixture.removeAllocationProbe(); fixture.mount(); });
  await expect(page.locator('.konvajs-content canvas')).toHaveCount(4);
  await page.waitForTimeout(80);
  const remounted = await snapshot(page);
  expect(remounted.stages).toBe(1); expect(remounted.layerCounts).toEqual([4]);
  expect(remounted.active).toBe(false); expect(remounted.preview).toBeNull();
  await page.mouse.move(180, 140); await page.mouse.down(); await page.mouse.move(200, 155); await page.mouse.up();
  await expect.poll(async () => (await snapshot(page)).history.past.length).toBe(initial.history.past.length + 1);
  const committed = await snapshot(page);
  expect(committed.active).toBe(false); expect(committed.preview).toBeNull();
  await page.evaluate(async () => { const { undo } = await import('/src/' + 'history/commandBus.ts'); if (!undo().ok) throw Error('Undo failed'); });
  expect((await snapshot(page)).project).toEqual(initial.project);
});
