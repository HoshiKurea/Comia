import { menuCommand } from './menuHelpers';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// CDP acts on this test's private browser context. No user tab is crashed,
// and no IndexedDB/Storage method is replaced to manufacture a quota error.
async function fixture(page: Page) {
  await page.goto('/'); await expect(page.locator('.library-item').first()).toBeVisible();
  return page.evaluate(async () => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts'), { replaceDocument } = await import('/src/' + 'history/commandBus.ts'); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { decodeImage, placeImage } = await import('/src/' + 'assets/importImage.ts');
    const project = createProject(), pageId = project.pageOrder[0], panel = createLayer('panel', pageId);
    Object.assign(project.pages[pageId], { width: 800, height: 600 }); panel.geometry = [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 160 }, { x: 0, y: 160 }]; panel.matrix = [1, 0, 0, 1, 100, 100];
    project.layers[panel.id] = panel; project.pages[pageId].roots = [...project.pages[pageId].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...([panel.id])]; const replaced = replaceDocument(numberFixture(project)); if (!replaced.ok) throw Error(JSON.stringify(replaced));
    sessionStore.setState({ activePageId: pageId, viewportByPage: { [pageId]: { zoom: 1, pan: { x: 16, y: 16 } } }, selection: [panel.id] });
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32; const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 32, 32); ctx.fillStyle = '#0066ff'; ctx.fillRect(0, 0, 16, 16);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png')); canvas.width = canvas.height = 0;
    const decoded = await decodeImage(new File([blob], '恢复图片.png', { type: 'image/png' }), new AbortController().signal); if (!decoded.ok) throw Error(JSON.stringify(decoded));
    const placed = placeImage(decoded.value, pageId, { x: 0, y: 0 }, panel.id); if (!placed.ok) throw Error(JSON.stringify(placed));
    return { panel: panel.id, image: placed.value, pageId };
  });
}
async function inspect(page: Page) {
  return page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const { getDocument } = await import('/src/' + 'state/documentStore.ts'), { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts');
    const doc = getDocument(), runtime = runtimeStore.getState();
    return { project: doc.project, history: doc.history, saved: doc.savedStateId, pixels: document.querySelector<HTMLCanvasElement>('.konvajs-content canvas')!.toDataURL(), blobs: [...runtime.blobs.keys()].sort(), images: [...runtime.images.keys()].sort(), sizes: [...runtime.images.values()].map((bitmap) => ({ width: bitmap.width, height: bitmap.height })) };
  });
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('comia-recovery-v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      const rows: any[] = await new Promise((resolve, reject) => { const tx = db.transaction('drafts'), r = tx.objectStore('drafts').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      return Promise.all(rows.map(async (row) => ({ key: row.key, project: row.project, stateId: row.stateId, createdAt: row.createdAt, blobs: await Promise.all(row.blobs.map(async (entry: any) => ({ hash: entry.hash, bytes: entry.blob.size, actualHash: [...new Uint8Array(await crypto.subtle.digest('SHA-256', await entry.blob.arrayBuffer()))].map((n) => n.toString(16).padStart(2, '0')).join('') }))) })));
    } finally { db.close(); }
  });
}
async function completedDraft(page: Page, stateId: string) {
  await expect.poll(async () => (await records(page)).map((row) => row.stateId), { timeout: 10000 }).toEqual([stateId]);
  return records(page);
}

test('a native renderer crash preserves the completed image draft and a fresh page restores its entire project and actual pixels', async ({ page, context }) => {
  const ids = await fixture(page), before = await inspect(page), draft = await completedDraft(page, before.history.stateId);
  expect(draft[0].project).toEqual(before.project); expect(draft[0].blobs.length).toBeGreaterThan(0);
  for (const blob of draft[0].blobs) expect(blob.actualHash).toBe(blob.hash);
  const client = await context.newCDPSession(page), crashed = page.waitForEvent('crash');
  void client.send('Page.crash').catch(() => {}); await crashed;
  const fresh = await context.newPage(); await fresh.goto('/');
  const dialog = fresh.getByRole('dialog', { name: '发现本机恢复草稿' }); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '恢复', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await fresh.evaluate(async (pageId) => { const { sessionStore } = await import('/src/' + 'state/sessionStore.ts'); sessionStore.setState({ viewportByPage: { [pageId]: { zoom: 1, pan: { x: 16, y: 16 } } } }); }, ids.pageId);
  const restored = await inspect(fresh); expect(restored.project).toEqual(before.project); expect(restored.blobs).toEqual(before.blobs); expect(restored.images).toEqual(before.images); expect(restored.sizes).toEqual(before.sizes); expect(restored.pixels).toBe(before.pixels);
  expect(restored.saved).toBeNull(); expect(restored.history.past).toHaveLength(0); await fresh.close();
});

test('native quota exhaustion leaves the previous draft intact while image editing and a real manual project download still work', async ({ page, context }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }));
  const ids = await fixture(page), before = await inspect(page), oldDraft = await completedDraft(page, before.history.stateId);
  const client = await context.newCDPSession(page), origin = new URL(page.url()).origin;
  const initial = await client.send('Storage.getUsageAndQuota', { origin });
  await client.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: initial.usage + 4096 });
  const limited = await client.send('Storage.getUsageAndQuota', { origin });
  console.log(JSON.stringify({ initial, limited })); expect(limited.overrideActive).toBe(true); expect(limited.quota).toBe(initial.usage + 4096);
  try {
    // Chromium caches an earlier free-space allotment for 30s. Let that real
    // cache expire before testing the newly imposed quota, without replacing
    // any platform method. This is setup time, not an application timing limit.
    // https://raw.githubusercontent.com/chromium/chromium/main/content/browser/indexed_db/instance/bucket_context.h
    await page.waitForTimeout(31000);
    const nativeError = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('comia-recovery-v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      try { return await new Promise<string>((resolve) => { const tx = db.transaction('drafts', 'readwrite'); tx.onabort = () => resolve(tx.error?.name ?? 'no native transaction error'); tx.oncomplete = () => resolve('unexpected complete'); tx.objectStore('drafts').put({ key: '__quota_probe__', blob: new Blob([new Uint8Array(4 * 1024 * 1024)]) }); }); }
      finally { db.close(); }
    });
    expect(nativeError).toBe('QuotaExceededError'); expect(await records(page)).toEqual(oldDraft);
    await page.evaluate(async ({ panel, pageId }) => {
      const { decodeImage, placeImage } = await import('/src/' + 'assets/importImage.ts');
      const c = document.createElement('canvas'); c.width = c.height = 512; const ctx = c.getContext('2d')!, data = ctx.createImageData(512, 512); let seed = 42;
      for (let i = 0; i < data.data.length; i += 4) { for (let j = 0; j < 3; j++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data.data[i + j] = seed >>> 24; } data.data[i + 3] = 255; }
      ctx.putImageData(data, 0, 0); const blob = await new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), 'image/png')); c.width = c.height = 0;
      const decoded = await decodeImage(new File([blob], '配额后仍可导入.png', { type: 'image/png' }), new AbortController().signal); if (!decoded.ok) throw Error(JSON.stringify(decoded));
      const placed = placeImage(decoded.value, pageId, { x: 0, y: 0 }, panel); if (!placed.ok) throw Error(JSON.stringify(placed));
    }, ids);
    const edited = await inspect(page); expect(edited.history.past.length).toBe(before.history.past.length + 1); expect(Object.entries(edited.project.layers).filter(([, layer]) => (layer as { type: string }).type !== 'pageBackground').map(([id]) => id)).toHaveLength(3); expect(edited.pixels).not.toBe(before.pixels);
    await expect(page.getByText('自动恢复不可用，请导出项目文件', { exact: true })).toBeVisible({ timeout: 10000 });
    expect(await records(page)).toEqual(oldDraft); expect((await inspect(page)).saved).toBeNull();
    const downloaded = page.waitForEvent('download'); await (await menuCommand(page, '保存')).click();
    const download = await downloaded, file = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(file.project).toEqual(edited.project); expect(file.blobs.length).toBeGreaterThanOrEqual(2); expect(file.blobs.every((blob: any) => typeof blob.base64 === 'string' && blob.base64.length > 0)).toBe(true);
    expect((await inspect(page)).project).toEqual(edited.project);
  } finally { await client.send('Storage.overrideQuotaForOrigin', { origin }); }
});

test('deleting an actual imported image retains its bitmap for undo and clearing history keeps the current image available for exact rendering', async ({ page }) => {
  const ids = await fixture(page), before = await inspect(page);
  await page.locator(`.layer-row:not([data-layer-type="pageBackground"])[data-layer-id="${ids.panel}"]`).getByRole('button', { name: '展开图层' }).click();
  await page.locator(`.layer-row:not([data-layer-type="pageBackground"])[data-layer-id="${ids.image}"]`).locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').click(); await page.keyboard.press('Delete');
  await expect(page.locator(`.layer-row:not([data-layer-type="pageBackground"])[data-layer-id="${ids.image}"]`)).toHaveCount(0);
  await page.evaluate(async () => { const { collectUnreferencedBlobs } = await import('/src/' + 'storage/blobRepository.ts'); await collectUnreferencedBlobs(); });
  const deleted = await inspect(page); expect(deleted.blobs).toEqual(before.blobs); expect(deleted.images).toEqual(before.images); expect(deleted.sizes).toEqual(before.sizes);
  await (await menuCommand(page, '撤销')).click(); const undone = await inspect(page); expect(undone.project).toEqual(before.project); expect(undone.pixels).toBe(before.pixels);
  await page.getByRole('button', { name: '清空历史', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: '确认清空', exact: true }).click();
  await page.evaluate(async () => { const { collectUnreferencedBlobs } = await import('/src/' + 'storage/blobRepository.ts'); await collectUnreferencedBlobs(); });
  const cleared = await inspect(page); expect(cleared.history.past).toHaveLength(0); expect(cleared.history.future).toHaveLength(0); expect(cleared.project).toEqual(before.project); expect(cleared.blobs).toEqual(before.blobs); expect(cleared.sizes).toEqual(before.sizes); expect(cleared.pixels).toBe(before.pixels);
});
