import { menuCommand } from './menuHelpers';
import { test, expect } from '@playwright/test';
const read = async (page: import('@playwright/test').Page) => page.evaluate(async () => { const source = (path: string) => performance.getEntriesByType('resource').find((entry) => entry.name.includes(`/src/${path}`))?.name ?? `/src/${path}`; const { getDocument } = await import(source('state/documentStore.ts')), { runtimeStore } = await import(source('state/runtimeStore.ts')); const doc = getDocument(); return { project: doc.project, past: doc.history.past.length, stats: runtimeStore.getState().renderStats }; });
test('ratio and gap input preview only in the overlay; one cut creates the requested geometry and undo restores it', async ({ page }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); const before = await read(page);
  await page.getByLabel('切割比例').fill('0.3'); await page.getByLabel('切割间隙').fill('0'); await page.waitForTimeout(120); const preview = await read(page);
  expect(preview.project).toEqual(before.project); expect(preview.past).toBe(before.past); expect(preview.stats.mainDraws).toBe(before.stats.mainDraws); expect(preview.stats.overlayDraws).toBeGreaterThan(before.stats.overlayDraws);
  await page.getByRole('button', { name: '垂直切割', exact: true }).click(); const after = await read(page); expect(after.past).toBe(before.past + 1);
  const panels = Object.values(after.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground') as any[], children = panels.filter((layer) => layer.type === 'panel' && layer.parentId === null && layer.role === 'leaf'); expect(children).toHaveLength(2); expect(Math.max(...children[0].geometry.map((point: any) => point.x))).toBeCloseTo(180, 6);
  await (await menuCommand(page, '撤销')).click(); expect((await read(page)).project).toEqual(before.project);
});
test('invalid cut input reports why and preserves the original tree; Escape clears the preview', async ({ page }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); const before = await read(page);
  await page.getByLabel('切割比例').fill('0.01'); await page.getByLabel('切割间隙').fill('256'); await page.getByRole('button', { name: '水平切割', exact: true }).click(); await expect(page.locator('.inspector-edit').getByRole('alert')).toContainText('切割后两块'); await expect(page.locator('.notice.error').last()).toContainText('切割后两块'); expect((await read(page)).project).toEqual(before.project); expect((await read(page)).past).toBe(before.past);
  await page.getByLabel('切割比例').fill('0.5'); await page.getByLabel('切割间隙').fill('0'); await page.keyboard.press('Escape');
  expect(await page.evaluate(async () => { const path = performance.getEntriesByType('resource').find((entry) => entry.name.includes('/src/panels/cutPanel.ts'))!.name; return (await import(path)).cutPreviewStore.getState().active; })).toBeNull();
});
