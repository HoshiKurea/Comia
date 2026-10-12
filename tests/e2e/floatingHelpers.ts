import type { Page } from '@playwright/test';

/** Move the editor window out of the geometry being exercised, just as a user can. */
export async function parkFloatingControls(page: Page) {
  const panel = page.locator('.floating-edit-panel'); if (!await panel.count()) return;
  const handle = panel.locator('.floating-edit-handle'), h = (await handle.boundingBox())!, box = (await panel.boundingBox())!, canvas = (await page.locator('.canvas-viewport').boundingBox())!;
  const delta = canvas.y + canvas.height - box.height - 16 - box.y;
  await page.mouse.move(h.x + 20, h.y + h.height / 2); await page.mouse.down(); await page.mouse.move(h.x + 20, h.y + h.height / 2 + delta, { steps: 10 }); await page.mouse.up();
}
