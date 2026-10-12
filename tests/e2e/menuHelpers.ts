import { expect, type Page } from '@playwright/test';
const commands: Record<string, [string, string]> = {
  '保存': ['文件', '保存项目'], '打开': ['文件', '打开项目…'], '保存目录': ['文件', '保存到项目目录…'], '打开目录': ['文件', '打开项目目录…'], 'PNG': ['文件', '导出 PNG'], 'PDF': ['文件', '导出 PDF'],
  '撤销': ['编辑', '撤销'], '↶ 撤销': ['编辑', '撤销'], '重做': ['编辑', '重做'], '↷ 重做': ['编辑', '重做'], '复制': ['编辑', '复制'], '粘贴': ['编辑', '粘贴'], '编组': ['图层', '编组'], '解组': ['图层', '解组'], '适应页面': ['视图', '适应页面'],
};
export async function menuCommand(page: Page, name: string) {
  const [category, label] = commands[name] ?? ['文件', name];
  if (!await page.getByRole('menu', { name: `${category}菜单`, exact: true }).count()) { if (await page.getByRole('menu').count()) await page.keyboard.press('Escape'); await page.getByRole('menubar').getByRole('menuitem', { name: category, exact: true }).click(); }
  return page.getByRole('menuitem', { name: label, exact: true });
}
export async function setMenuTheme(page: Page, theme: string) {
  if (await page.getByRole('menu').count()) await page.keyboard.press('Escape');
  await page.getByRole('menubar').getByRole('menuitem', { name: '视图', exact: true }).click();
  await page.getByRole('menuitem', { name: '界面主题', exact: true }).click();
  await page.getByRole('menuitemradio', { name: ({ system: '跟随系统', light: '浅色', dark: '深色' } as Record<string, string>)[theme], exact: true }).click();
}
export async function setMenuScale(page: Page, scale: string) {
  if (!await page.getByRole('menu', { name: '文件菜单', exact: true }).count()) await page.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: '导出倍率', exact: true }).click();
  await page.getByRole('menuitemradio', { name: `${scale}×`, exact: true }).click();
}
export async function setMenuSnap(page: Page, enabled: boolean) {
  if (!await page.getByRole('menu', { name: '视图菜单', exact: true }).count()) await page.getByRole('menubar').getByRole('menuitem', { name: '视图', exact: true }).click();
  const item = page.getByRole('menuitemcheckbox', { name: '16 倍数尺寸吸附', exact: true });
  if ((await item.getAttribute('aria-checked') === 'true') !== enabled) await item.click(); else await page.keyboard.press('Escape');
}
export async function waitForProjectIO(page: Page) { await expect(page.locator('.project-tabs button:disabled')).toHaveCount(0); }
