import { menuCommand } from './menuHelpers';
import { test, expect, type Page } from '@playwright/test';

async function readState(page: Page) {
  return page.evaluate(async () => {
    const source = (path: string) => performance.getEntriesByType('resource').find((entry) => entry.name.includes(`/src/${path}`))?.name ?? `/src/${path}`;
    const { getDocument } = await import(source('state/documentStore.ts')), { sessionStore } = await import(source('state/sessionStore.ts'));
    const doc = getDocument(); return { project: doc.project, past: doc.history.past.length, stateId: doc.history.stateId, saved: doc.savedStateId, selection: sessionStore.getState().selection };
  });
}

test('clear history cancellation preserves undo, confirmation preserves pixels, selection and dirty marker', async ({ page }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); const before = await readState(page);
  const pixels = await page.locator('.canvas-viewport canvas').first().evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
  await page.getByRole('button', { name: '清空历史', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click(); expect(await readState(page)).toEqual(before);
  await page.getByRole('button', { name: '清空历史', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: '确认清空', exact: true }).click();
  const after = await readState(page); expect(after).toEqual({ ...before, past: 0 }); await expect((await menuCommand(page, '撤销'))).toBeDisabled();
  expect(await page.locator('.canvas-viewport canvas').first().evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL())).toBe(pixels);
  await page.locator('.library-item').filter({ hasText: '梯形分镜' }).click(); await (await menuCommand(page, '撤销')).click(); expect((await readState(page)).project).toEqual(before.project);
});

test('a copied real bitmap survives project replacement and can still be pasted and exported', async ({ page }) => {
  await page.goto('/'); const pixel = await page.evaluate(async () => {
    const source = (path: string) => performance.getEntriesByType('resource').find((entry) => entry.name.includes(`/src/${path}`))?.name ?? `/src/${path}`;
    const { createProject, createLayer } = await import(source('domain/factories.ts')), { replaceDocument } = await import(source('history/commandBus.ts')); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const { replaceRuntimeResources, collectUnreferencedBlobs } = await import(source('storage/blobRepository.ts')), { copyToClipboard, pasteFromClipboard, clearClipboard } = await import(source('layers/clipboard.ts'));
    const { runtimeStore } = await import(source('state/runtimeStore.ts')), { getProject } = await import(source('state/documentStore.ts'));
    const { exportPng } = await import(source('export/exportFiles.ts'));
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32; const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ed174c'; ctx.fillRect(0, 0, 32, 32);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'));
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (value) => value.toString(16).padStart(2, '0')).join('');
    const project = createProject({ background: false }), image = createLayer('image', project.pageOrder[0]); image.width = image.height = 32; image.assetId = crypto.randomUUID();
    project.layers[image.id] = image; project.pages[image.pageId].roots = [...project.pages[image.pageId].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...([image.id])]; project.assets[image.assetId] = { id: image.assetId, name: '红图', originalHash: hash, renderHash: hash, originalMime: 'image/png', renderMime: 'image/png', width: 32, height: 32, originalBytes: blob.size, renderBytes: blob.size, framePolicy: 'still', normalizedOrientation: true };
    replaceDocument(numberFixture(project)); replaceRuntimeResources(new Map([[hash, blob]]), new Map([[hash, await createImageBitmap(blob)]]));
    if (!copyToClipboard([image.id]).ok) throw Error('copy failed'); const next = createProject({ background: false }); replaceDocument(next); replaceRuntimeResources(new Map(), new Map()); await collectUnreferencedBlobs();
    const pasted = pasteFromClipboard(next.pageOrder[0]); if (!pasted.ok) throw Error(JSON.stringify(pasted)); clearClipboard(); await collectUnreferencedBlobs();
    const result = await exportPng(getProject(), next.pageOrder[0], runtimeStore.getState().images); if (!result.ok) throw Error(JSON.stringify(result));
    const rendered = await createImageBitmap(result.value); canvas.width = rendered.width; canvas.height = rendered.height; ctx.drawImage(rendered, 0, 0); rendered.close();
    return [...ctx.getImageData(32, 32, 1, 1).data];
  }); expect(pixel).toEqual([237, 23, 76, 255]);
});

test('two real tabs keep separate recovery generations and saving one never deletes the other', async ({ page, context }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); const first = await readState(page), peer = await context.newPage(); await peer.goto('/');
  await peer.evaluate(async (project) => { const source = (path: string) => performance.getEntriesByType('resource').find((entry) => entry.name.includes(`/src/${path}`))?.name ?? `/src/${path}`; const { replaceDocument } = await import(source('history/commandBus.ts')); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts'); replaceDocument(numberFixture(project)); }, first.project);
  await peer.locator('.library-item').filter({ hasText: '梯形分镜' }).click();
  const candidates = () => page.evaluate(async () => { const path = performance.getEntriesByType('resource').find((entry) => entry.name.includes('/src/storage/recovery.ts'))!.name; return (await import(path)).listRecoveries(); });
  await expect.poll(async () => { const result = await candidates(); return result.ok ? result.value.filter((item: any) => item.key.startsWith(`${first.project.id}:`)).map((item: any) => item.layerCount).sort() : []; }, { timeout: 9000 }).toEqual([2, 3]);
  await page.evaluate(async () => { const source = (path: string) => performance.getEntriesByType('resource').find((entry) => entry.name.includes(`/src/${path}`))!.name; const { markRecoverySaved } = await import(source('storage/recovery.ts')), { getDocument } = await import(source('state/documentStore.ts')); const doc = getDocument(); await markRecoverySaved(doc.project.id, doc.history.stateId); });
  const result = await candidates(); expect(result.ok && result.value.filter((item: any) => item.key.startsWith(`${first.project.id}:`)).map((item: any) => item.layerCount)).toEqual([3]); await peer.close();
});

test('a save waiting for a file picker writes its original image snapshot even after opening another project', async ({ page }) => {
  await page.goto('/'); const result = await page.evaluate(async () => {
    const source = (path: string) => performance.getEntriesByType('resource').find((entry) => entry.name.includes(`/src/${path}`))?.name ?? `/src/${path}`;
    const { decodeImage, placeImages } = await import(source('assets/importImage.ts')), { createProject } = await import(source('domain/factories.ts')), { replaceDocument } = await import(source('history/commandBus.ts'));
    const { getDocument } = await import(source('state/documentStore.ts')), { replaceRuntimeResources, collectUnreferencedBlobs } = await import(source('storage/blobRepository.ts'));
    const { saveFile, clearActiveFileHandle } = await import(source('storage/fileSave.ts')), { decodeProject } = await import(source('storage/codec.ts'));
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32; canvas.getContext('2d')!.fillRect(0, 0, 32, 32);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png')), controller = new AbortController();
    const asset = await decodeImage(new File([blob], 'save.png', { type: 'image/png' }), controller.signal); if (!asset.ok) throw Error(JSON.stringify(asset));
    const before = getDocument(); const placed = placeImages([asset.value], before.project.pageOrder[0], { x: 50, y: 50 }, null); if (!placed.ok) throw Error(JSON.stringify(placed));
    const snapshot = getDocument(); let releasePicker!: (handle: any) => void, written: Blob | null = null;
    clearActiveFileHandle(); Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: () => new Promise((resolve) => { releasePicker = resolve; }) });
    const pending = saveFile(); if (!releasePicker) throw Error('picker was not synchronous');
    const next = createProject({ background: false }); replaceDocument(next); replaceRuntimeResources(new Map(), new Map()); await collectUnreferencedBlobs();
    releasePicker({ createWritable: async () => ({ write: async (data: Blob) => { written = data; }, close: async () => undefined }) });
    const saved = await pending; if (!saved.ok || !written) throw Error(JSON.stringify(saved)); const decoded = await decodeProject(new File([written], 'saved.Comia.json')); if (!decoded.ok) throw Error(JSON.stringify(decoded));
    return { imageCount: Object.values(decoded.value.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter((layer: any) => layer.type === 'image').length, projectId: decoded.value.project.id, originalId: snapshot.project.id, bytes: [...decoded.value.blobs.values()].map((blob: Blob) => blob.size), currentId: getDocument().project.id, nextId: next.id, savedMarker: getDocument().savedStateId };
  }); expect(result.imageCount).toBe(1); expect(result.projectId).toBe(result.originalId); expect(result.currentId).toBe(result.nextId); expect(result.savedMarker).toBeNull(); expect(result.bytes.every((bytes: number) => bytes > 0)).toBe(true);
});
