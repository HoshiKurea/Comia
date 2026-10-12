import { menuCommand } from './menuHelpers';
import { test, expect, chromium } from '@playwright/test';

test('real Edge local-font enumeration is invoked by a user click and selecting a local family stays undoable', async () => {
  // Edge 148's native Font Access hangs after a prior incognito context closes, even without the app.
  // Keep the actual native permission test in its own process; all product behavior assertions stay intact.
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1440, height: 900 } }), page = await context.newPage();
  await context.grantPermissions(['local-fonts']); await page.goto('/'); await page.locator('.library-item').filter({ hasText: /^文字/ }).click();
  const families = page.getByLabel('文字字体'), before = await families.locator('option').allTextContents(); expect(before).toHaveLength(4);
  await page.bringToFront();
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
  await page.getByRole('button', { name: '读取本机字体列表' }).click(); await expect(page.getByText(/已读取\d+种本机字体/)).toBeVisible(); const options = await families.locator('option').evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value)); expect(options.length).toBeGreaterThan(4);
  const selected = options.find((family) => family === 'Arial') ?? options[4]; await families.selectOption(selected); await expect(families).toHaveValue(selected); await expect(page.getByText('显示替代字体：', { exact: false })).toHaveCount(0);
  await (await menuCommand(page, '撤销')).click(); await expect(families).toHaveValue(before[0]);
  } finally { await browser.close(); }
});

test('denied font access does not remove application fonts or mutate the project', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'queryLocalFonts', { configurable: true, value: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) }));
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: /^文字/ }).click();
  const snapshot = () => page.evaluate(async () => { const source = performance.getEntriesByType('resource').find((entry) => entry.name.includes('/src/state/documentStore.ts'))!.name; const { getDocument } = await import(source); const doc = getDocument(); return { project: doc.project, history: doc.history }; });
  const before = await snapshot(); await page.getByRole('button', { name: '读取本机字体列表' }).click(); await expect(page.getByText(/未获本机字体访问权限/).first()).toBeVisible(); expect(await snapshot()).toEqual(before); await expect(page.getByLabel('文字字体').locator('option')).toHaveCount(4); await expect(page.getByRole('button', { name: '读取本机字体列表' })).toBeEnabled();
});
