import { expect, test, type Page } from '@playwright/test';
import { menuCommand, waitForProjectIO } from './menuHelpers';
import type { RecoveryCandidate } from '../../src/storage/recovery';

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

test('native directory and recovery restore numbered partial breakout with unchanged original blobs', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { panelBindingScene } = await import('/tests/fixtures/' + 'panelBindingScene.ts');
    const { getDocument } = await import('/src/' + 'state/documentStore.ts'), { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts');
    const { setBreakoutRegion } = await import('/src/' + 'images/breakoutCommands.ts'), { saveDirectory, loadDirectory } = await import('/src/' + 'storage/directorySave.ts');
    const { flushRecovery, listRecoveries, restoreRecovery, getRecoveryBinding } = await import('/src/' + 'storage/recovery.ts');
    const f = await panelBindingScene(), changed = setBreakoutRegion(f.imageId, { shape: 'ellipse', geometry: [{ x: 0, y: 0 }, { x: 140, y: 0 }, { x: 140, y: 120 }, { x: 0, y: 120 }], matrix: [1, 0, 0, 1, 20, 0] });
    if (!changed.ok) throw Error(JSON.stringify(changed));
    const d = getDocument(), original = structuredClone(d.project), blobs = runtimeStore.getState().blobs;
    const root = await navigator.storage.getDirectory(), dir = await root.getDirectoryHandle('numbered-breakout', { create: true });
    const saved = await saveDirectory(dir, { project: d.project, stateId: d.history.stateId, blobs }, null); if (!saved.ok) throw Error(JSON.stringify(saved));
    const loaded = await loadDirectory(dir); if (!loaded.ok || loaded.value.kind !== 'loaded') throw Error(JSON.stringify(loaded));
    const hashes = []; for (const [hash, blob] of loaded.value.blobs) hashes.push({ expected: hash, actual: [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(v => v.toString(16).padStart(2, '0')).join('') });
    if (!await flushRecovery()) throw Error('recovery write'); const rows = await listRecoveries(); if (!rows.ok) throw Error(JSON.stringify(rows));
    const owner = getRecoveryBinding().owner;
    const key = rows.value.find((row: RecoveryCandidate) => row.key.startsWith(original.id + ':') && (!owner || row.key.endsWith(':' + owner)))?.key; if (!key) throw Error('recovery missing');
    const restored = await restoreRecovery(key); if (!restored.ok) throw Error(JSON.stringify(restored));
    return { original, directory: loaded.value.project, recovery: getDocument().project, hashes, bitmap: runtimeStore.getState().images.get(original.assets[original.layers[f.imageId].type === 'image' ? original.layers[f.imageId].assetId : ''].renderHash)?.width };
  });
  expect(result.directory).toEqual(result.original); expect(result.recovery).toEqual(result.original); expect(result.original.schemaVersion).toBe(8);
  expect(result.hashes.length).toBeGreaterThan(0); result.hashes.forEach(row => expect(row.actual).toBe(row.expected)); expect(result.bitmap).toBe(320);
});


test('native OPFS directory generations stay bound to their own comics across tab switches', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory(), w = window as any; w.__dirs = [await root.getDirectoryHandle('comic-a', { create: true }), await root.getDirectoryHandle('comic-b', { create: true })]; w.__dirPicks = 0;
    w.showDirectoryPicker = async () => w.__dirs[w.__dirPicks++];
  });
  await createComic(page, '目录 A'); const a = (await document(page)).project.id;
  await (await menuCommand(page, '保存目录')).click(); await waitForProjectIO(page); await createComic(page, '目录 B'); const b = (await document(page)).project.id;
  await (await menuCommand(page, '保存目录')).click(); await waitForProjectIO(page); await page.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab', { name: /目录 A/ }).click(); await waitForProjectIO(page); await (await menuCommand(page, '保存目录')).click(); await waitForProjectIO(page);
  const result = await page.evaluate(async () => { const { loadDirectory } = await import('/src/' + 'storage/directorySave.ts'); const w = window as any, projects = []; for (const dir of w.__dirs) { const loaded = await loadDirectory(dir); if (!loaded.ok || loaded.value.kind !== 'loaded') throw Error(JSON.stringify(loaded)); projects.push(loaded.value.project.id); } return { picks: w.__dirPicks, projects }; });
  expect(result).toEqual({ picks: 2, projects: [a, b] });
});

test('native OPFS verified save cleans only its restored comic recovery slot', async ({ page, context }) => {
  await page.goto('/'); await createComic(page, '恢复漫画 A');
  await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); const a = await document(page);
  await createComic(page, '恢复漫画 B');
  await page.locator('.library-item').filter({ hasText: '椭圆分镜' }).click(); const b = await document(page);
  expect(await page.evaluate(async () => (await import('/src/' + 'storage/recovery.ts')).flushRecovery())).toBe(true);
  const records = await drafts(page);
  expect(records.filter(row => [a.project.id, b.project.id].some(id => row.key.startsWith(id + ':')))).toHaveLength(2);

  // Fresh native documents simulate restart discovery; no recovery database methods are replaced.
  const freshA = await context.newPage(), freshB = await context.newPage();
  for (const [fresh, before, name] of [[freshA, a, '恢复漫画 A'], [freshB, b, '恢复漫画 B']] as const) {
    await fresh.goto('/'); const dialog = fresh.getByRole('dialog', { name: '发现本机恢复草稿', exact: true });
    await dialog.locator('.recovery-row').filter({ hasText: name }).getByRole('button', { name: '恢复', exact: true }).click();
    await expect(dialog).toHaveCount(0); await waitForProjectIO(fresh);
    const restored = await document(fresh); expect(restored.project).toEqual(before.project);
    expect(restored.savedStateId).toBeNull(); expect(restored.history.past).toHaveLength(0);
    await expect(fresh.getByRole('tablist', { name: '漫画项目', exact: true }).getByRole('tab')).toHaveCount(2);
  }
  await freshA.evaluate(async () => {
    const root = await navigator.storage.getDirectory(), file = await root.getFileHandle('recovered-a.json', { create: true });
    (window as any).showSaveFilePicker = async () => file;
  });
  await (await menuCommand(freshA, '保存')).click(); await waitForProjectIO(freshA);
  expect(await freshA.evaluate(async () => {
    const root = await navigator.storage.getDirectory(); return JSON.parse(await (await (await root.getFileHandle('recovered-a.json')).getFile()).text()).project;
  })).toEqual(a.project);
  await expect.poll(async () => (await drafts(freshA)).filter(row => row.key.startsWith(a.project.id + ':')).length).toBe(0);
  expect((await drafts(freshA)).some(row => row.key.startsWith(b.project.id + ':'))).toBe(true);
  expect((await document(freshB)).project).toEqual(b.project);
  await freshA.close(); await freshB.close();
});
