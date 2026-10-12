import { menuCommand } from './menuHelpers';
import { expect, test, type Page } from '@playwright/test';
import type { Project } from '../../src/domain/types';

// Only directory selection is substituted. Every returned handle, writable
// stream, file and readback belongs to the browser's real persistent OPFS.
// This proves interruption recovery with native storage, not external-picker
// permissions, disk power-loss guarantees, or Safari on macOS.
async function installPicker(page: Page, name: string) {
  await page.evaluate(async (name) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
    if (!(root instanceof FileSystemDirectoryHandle)) throw Error('Native directory handle required');
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => root });
  }, name);
}

async function picture(page: Page, color: string) {
  await page.evaluate(async (color) => {
    const { decodeImage, placeImage } = await import('/src/' + 'assets/importImage.ts') as typeof import('../../src/assets/importImage');
    const { getDocument } = await import('/src/' + 'state/documentStore.ts') as typeof import('../../src/state/documentStore');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 32, 32);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png')); canvas.width = canvas.height = 0;
    const decoded = await decodeImage(new File([blob], 'native-storage.png', { type: 'image/png' }), new AbortController().signal);
    if (!decoded.ok) throw Error(JSON.stringify(decoded));
    const result = placeImage(decoded.value, getDocument().project.pageOrder[0], { x: 100, y: 100 });
    if (!result.ok) throw Error(JSON.stringify(result));
  }, color);
}

async function inspect(page: Page) {
  return page.evaluate(async () => {
    const { getDocument } = await import('/src/' + 'state/documentStore.ts') as typeof import('../../src/state/documentStore');
    const { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts') as typeof import('../../src/state/runtimeStore');
    const { exportPng } = await import('/src/' + 'export/exportFiles.ts') as typeof import('../../src/export/exportFiles');
    const doc = getDocument(), runtime = runtimeStore.getState();
    const hash = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((n) => n.toString(16).padStart(2, '0')).join('');
    const result = await exportPng(doc.project, doc.project.pageOrder[0], runtime.images); if (!result.ok) throw Error(JSON.stringify(result));
    return { project: doc.project, pixels: await hash(await result.value.arrayBuffer()), saved: doc.savedStateId, stateId: doc.history.stateId,
      blobs: await Promise.all([...runtime.blobs].sort(([a], [b]) => a.localeCompare(b)).map(async ([key, blob]) => ({ key, hash: await hash(await blob.arrayBuffer()) }))) };
  });
}

async function setup(page: Page, name: string) {
  page.on('pageerror', (error) => console.log(`native-directory-pageerror: ${error.message}`));
  await page.goto('/'); await expect(page.locator('.library-item').first()).toBeVisible();
  await page.getByRole('tab', { name: '页面', exact: true }).click();
  await page.getByLabel('页面宽度').fill('800'); await page.getByLabel('页面高度').fill('600');
  await page.getByRole('button', { name: '应用页面尺寸', exact: true }).click();
  await picture(page, '#f0000080'); await installPicker(page, name);
  await (await menuCommand(page, '保存目录')).click();
  await expect.poll(async () => page.locator('.notice').allTextContents()).toContainEqual(expect.stringContaining('项目目录已写入并校验'));
  await expect(page.locator('.unsaved')).toContainText('已保存');
  return inspect(page);
}

test('native OPFS survives renderer crashes during blob, manifest and current writes without replacing the complete old project', async ({ browser, channel }) => {
  test.setTimeout(90_000);
  for (const phase of ['blob', 'manifest', 'current'] as const) {
    // Each independent crash case owns a fresh browser process as well as a
    // fresh context. Repeated Page.crash on the shared runner stalled creation
    // of the third replacement renderer. This is isolation, not a retry: each
    // phase crashes ONCE, and reads the SAME context/origin/native OPFS.
    const isolated = await browser.browserType().launch({ channel });
    const context = await isolated.newContext();
    try {
    console.log(`native-phase:${phase}:start`);
    const page = await context.newPage(), name = `native-interruption-${phase}-${crypto.randomUUID()}`;
    const before = await setup(page, name); await picture(page, '#0066ff');
    console.log(`native-phase:${phase}:saved-baseline`);
    await expect(page.locator('.unsaved')).toContainText('未保存');
    await page.evaluate((phase) => {
      const original = FileSystemFileHandle.prototype.createWritable;
      FileSystemFileHandle.prototype.createWritable = async function (...args) {
        const stream = await original.apply(this, args), name = this.name;
        const matches = phase === 'blob' ? name.endsWith('.png') : phase === 'manifest' ? name.endsWith('.json') && name !== 'current.json' : name === 'current.json';
        if (matches) {
          const write = stream.write.bind(stream);
          stream.write = async (data) => {
            await write(data);
            document.documentElement.dataset.nativeWriteBarrier = phase;
            // Real native write completed, but close has not been called.
            // The renderer crash abandons this writer; no fabricated error.
            await new Promise<void>(() => undefined);
          };
        }
        return stream;
      };
    }, phase);
    await (await menuCommand(page, '保存目录')).click();
    await expect(page.locator('html')).toHaveAttribute('data-native-write-barrier', phase);
    console.log(`native-phase:${phase}:write-barrier`);
    const crash = page.waitForEvent('crash');
    const client = await context.newCDPSession(page); void client.send('Page.crash').catch(() => undefined); await crash;
    console.log(`native-phase:${phase}:crashed`);
    // Dispose the dead renderer before opening its replacement. Keep the SAME
    // context/origin and native OPFS: closing a crashed page cannot execute the
    // abandoned writer's close(), and does not erase persisted generations.
    await page.close();
    const fresh = await context.newPage(); await fresh.goto('/'); await expect(fresh.locator('.canvas-viewport')).toBeVisible(); await fresh.getByRole('tab', { name: '组件库', exact: true }).click(); await expect(fresh.locator('.library-item').first()).toBeVisible();
    const later = fresh.getByRole('button', { name: '稍后', exact: true }); if (await later.isVisible()) await later.click();
    await installPicker(fresh, name); await (await menuCommand(fresh, '打开目录')).click();
    await expect.poll(async () => (await inspect(fresh)).project).toEqual(before.project);
    const restored = await inspect(fresh);
    expect(restored.pixels).toBe(before.pixels); expect(restored.blobs).toEqual(before.blobs);
    console.log(JSON.stringify({ scope: 'real native OPFS, renderer crash before stream close', phase, name, completeOldProject: true, exactPng: true, blobSha: restored.blobs }));
    } finally {
      console.log(`native-phase:${phase}:closing-context`);
      try { await context.close(); } finally { await isolated.close(); }
    }
    console.log(`native-phase:${phase}:closed`);
  }
});

test('native OPFS damaged current offers only complete verified generations and UI recovery retains exact image content', async ({ page }) => {
  test.setTimeout(60_000);
  const name = `native-recovery-${crypto.randomUUID()}`, old = await setup(page, name);
  await picture(page, '#0066ff'); await (await menuCommand(page, '保存目录')).click();
  await expect(page.locator('.unsaved')).toContainText('已保存'); const newest = await inspect(page);
  const damaged = await page.evaluate(async (name) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name), manifests = await root.getDirectoryHandle('manifests');
    const entries: { name: string; project: Project; generation: string }[] = [];
    for await (const [name, entry] of (manifests as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (entry.kind === 'file') { const raw = JSON.parse(await (await (entry as FileSystemFileHandle).getFile()).text()); entries.push({ name, project: raw.project, generation: raw.generation }); }
    }
    // An invalid manifest must never become a recovery candidate.
    const bogus = `${crypto.randomUUID()}.json`, bad = await (await manifests.getFileHandle(bogus, { create: true })).createWritable(); await bad.write('{incomplete'); await bad.close();
    const pointer = await (await root.getFileHandle('current.json')).createWritable(); await pointer.write('{broken'); await pointer.close();
    return { entries, bogus };
  }, name);
  expect(damaged.entries).toHaveLength(2);
  await (await menuCommand(page, '打开目录')).click();
  const dialog = page.getByRole('dialog', { name: '选择可恢复的目录版本' }); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '恢复此版本' })).toHaveCount(2);
  await dialog.getByRole('button', { name: '恢复此版本' }).first().click();
  await expect(dialog).toHaveCount(0); const restored = await inspect(page);
  expect(restored.project).toEqual(newest.project); expect(restored.pixels).toBe(newest.pixels); expect(restored.blobs).toEqual(newest.blobs);
  expect(restored.project).not.toEqual(old.project);
  await page.evaluate(async (name) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name); await root.removeEntry('current.json');
  }, name);
  await (await menuCommand(page, '打开目录')).click(); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '恢复此版本' })).toHaveCount(2);
  await dialog.getByRole('button', { name: '恢复此版本' }).first().click(); await expect(dialog).toHaveCount(0);
  const missingRestored = await inspect(page);
  expect(missingRestored.project).toEqual(newest.project); expect(missingRestored.pixels).toBe(newest.pixels); expect(missingRestored.blobs).toEqual(newest.blobs);
  console.log(JSON.stringify({ scope: 'real native OPFS, actual UI candidate selection', verifiedCandidates: 2, invalidExcluded: damaged.bogus, exactPng: true, blobSha: restored.blobs }));
});
