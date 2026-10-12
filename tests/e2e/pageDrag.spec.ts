import { menuCommand } from './menuHelpers';
import { test, expect, type Page } from '@playwright/test';

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const source = (path: string) => performance.getEntriesByType('resource').find((item) => item.name.includes(`/src/${path}`))?.name ?? `/src/${path}`;
    const { getDocument } = await import(source('state/documentStore.ts'));
    const { sessionStore } = await import(source('state/sessionStore.ts'));
    const doc = getDocument(); return { project: doc.project, stateId: doc.history.stateId, history: doc.history.past.length, active: sessionStore.getState().activePageId };
  });
}
async function prepare(page: Page) {
  await page.goto('/'); await page.getByRole('tab', { name: '页面', exact: true }).click();
  await page.getByRole('button', { name: '+ 新建漫画页' }).click(); await page.getByRole('button', { name: '+ 新建漫画页' }).click();
  await page.evaluate(async () => { const { resolveFont } = await import('/src/' + 'text/fonts.ts'); await resolveFont('Noto Sans CJK SC'); });
  await page.waitForTimeout(200);
}
async function start(page: Page) {
  const source = page.locator('.page-item').last(); await source.scrollIntoViewIfNeeded(); const rect = (await source.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + 35); await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 8, rect.y + 35, { steps: 4 });
  await expect(page.locator('.page-drag-preview')).toBeVisible(); return rect;
}

test('page pointer preview stays out of history and canvas; captured source survives scrolling and one undo restores order', async ({ page }) => {
  await prepare(page); const before = await snapshot(page);
  await page.evaluate(async () => { const { resetRenderStats } = await import('/src/' + 'state/runtimeStore.ts'); resetRenderStats(); });
  await start(page);
  await page.locator('.page-item').first().scrollIntoViewIfNeeded(); const target = (await page.locator('.page-item').first().boundingBox())!;
  await page.mouse.move(target.x + target.width / 2, target.y + 80, { steps: 20 });
  await expect(page.locator('.page-item').first()).toHaveClass(/drop-before/);
  expect(await snapshot(page)).toEqual(before);
  const draws = await page.evaluate(async () => { const { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts'); return runtimeStore.getState().renderStats.mainDraws; });
  expect(draws).toBe(0);
  await page.mouse.up(); await expect(page.locator('.page-drag-preview')).toHaveCount(0);
  const after = await snapshot(page); expect(after.project.pageOrder).toEqual([before.project.pageOrder[2], ...before.project.pageOrder.slice(0, 2)]);
  expect(after.history).toBe(before.history + 1); expect(after.active).toBe(before.active);
  await (await menuCommand(page, '撤销')).click(); expect((await snapshot(page)).project.pageOrder).toEqual(before.project.pageOrder);
  await (await menuCommand(page, '重做')).click(); expect((await snapshot(page)).project.pageOrder).toEqual(after.project.pageOrder);
});

test('Escape, pointer cancellation, lost capture and outside release discard the page preview without changing project or history', async ({ page }) => {
  await prepare(page); const before = await snapshot(page);
  for (const action of ['escape', 'cancel', 'lost', 'outside']) {
    await start(page);
    if (action === 'escape') await page.keyboard.press('Escape');
    else if (action === 'outside') await page.mouse.move(800, 300);
    else await page.locator('.page-item').last().dispatchEvent(action === 'cancel' ? 'pointercancel' : 'lostpointercapture', { pointerId: 1 });
    await page.mouse.up(); await expect(page.locator('.page-drag-preview')).toHaveCount(0);
    expect(await snapshot(page)).toEqual(before); await expect(page.locator('.drop-before')).toHaveCount(0);
  }
});

test('a page click and keyboard activation still switch pages without a reorder transaction', async ({ page }) => {
  await prepare(page); const before = await snapshot(page);
  const first = page.locator('.page-item').first().getByRole('button').first(); await first.click();
  expect((await snapshot(page)).active).toBe(before.project.pageOrder[0]);
  const second = page.locator('.page-item').nth(1).getByRole('button').first(); await second.focus(); await second.press('Enter');
  const after = await snapshot(page); expect(after.active).toBe(before.project.pageOrder[1]);
  expect(after.stateId).toBe(before.stateId); expect(after.project).toEqual(before.project); expect(after.history).toBe(before.history);
});

test('replacing the document during page drag removes its ghost and cannot reorder the new project on release', async ({ page }) => {
  await prepare(page); await start(page);
  await page.evaluate(async () => {
    const source = (path: string) => performance.getEntriesByType('resource').find((item) => item.name.includes(`/src/${path}`))?.name ?? `/src/${path}`;
    const { createProject } = await import(source('domain/factories.ts'));
    const { replaceDocument } = await import(source('history/commandBus.ts')); replaceDocument(createProject({ background: false }));
  });
  await expect(page.locator('.page-drag-preview')).toHaveCount(0); const replacement = await snapshot(page);
  await page.mouse.up(); expect(await snapshot(page)).toEqual(replacement); expect(replacement.history).toBe(0);
});
