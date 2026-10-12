import { expect, test, type Page } from '@playwright/test';
import { menuCommand, waitForProjectIO } from './menuHelpers';
import type { RecoveryCandidate } from '../../src/storage/recovery';
import { readFile } from 'node:fs/promises';

async function document(page: Page) {
  return page.evaluate(async () => (await import('/src/' + 'state/documentStore.ts')).getDocument());
}
async function createComic(page: Page, name: string) {
  await (await menuCommand(page, '新建项目…')).click();
  const dialog = page.getByRole('dialog', { name: '新建项目', exact: true });
  await dialog.getByLabel('新项目名称', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
async function drafts(page: Page): Promise<RecoveryCandidate[]> {
  return page.evaluate(async () => {
    const { listRecoveries } = await import('/src/' + 'storage/recovery.ts');
    const result = await listRecoveries(); if (!result.ok) throw Error(JSON.stringify(result)); return result.value;
  });
}

test('two comics recover independently and confirming a saved download closes only its own recovery slot', async ({ page, context }) => {
  await page.goto('/'); await createComic(page, '恢复漫画 A');
  await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); const a = await document(page);
  await createComic(page, '恢复漫画 B');
  await page.locator('.library-item').filter({ hasText: '椭圆分镜' }).click(); const b = await document(page);
  expect(await page.evaluate(async () => (await import('/src/' + 'storage/recovery.ts')).flushRecovery())).toBe(true);
  const records = await drafts(page);
  expect(records.filter(row => [a.project.id, b.project.id].some(id => row.key.startsWith(id + ':')))).toHaveLength(2);

  // Fresh native documents simulate restart discovery; no recovery database methods are replaced.
  const freshA = await context.newPage(), freshB = await context.newPage();
  await freshA.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }));
  for (const [fresh, before, name] of [[freshA, a, '恢复漫画 A'], [freshB, b, '恢复漫画 B']] as const) {
    await fresh.goto('/'); const dialog = fresh.getByRole('dialog', { name: '发现本机恢复草稿', exact: true });
    await dialog.locator('.recovery-row').filter({ hasText: name }).getByRole('button', { name: '恢复', exact: true }).click();
    await expect(dialog).toHaveCount(0); await waitForProjectIO(fresh);
    const restored = await document(fresh); expect(restored.project).toEqual(before.project);
    expect(restored.savedStateId).toBeNull(); expect(restored.history.past).toHaveLength(0);
    await expect(fresh.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab')).toHaveCount(2);
  }
  await (await menuCommand(freshA, '关闭当前项目')).click();
  const close = freshA.getByRole('dialog', { name: '关闭项目', exact: true }), saved = freshA.waitForEvent('download');
  await close.getByRole('button', { name: '先保存再关闭', exact: true }).click();
  expect(JSON.parse(await readFile((await (await saved).path())!, 'utf8')).project).toEqual(a.project);
  await expect(close).toBeVisible(); await expect(freshA.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab')).toHaveCount(2);
  await close.getByRole('button', { name: '确认文件已保存并关闭', exact: true }).click();
  await expect(close).toHaveCount(0); await waitForProjectIO(freshA);
  await expect.poll(async () => (await drafts(freshA)).filter(row => row.key.startsWith(a.project.id + ':')).length).toBe(0);
  expect((await drafts(freshA)).some(row => row.key.startsWith(b.project.id + ':'))).toBe(true);
  expect((await document(freshB)).project).toEqual(b.project);
  await freshA.close(); await freshB.close();
});
