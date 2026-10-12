import { menuCommand } from './menuHelpers';
import { test, expect, type Page } from '@playwright/test';

async function fixture(page: Page, nested = false) {
  await page.goto('/');
  return page.evaluate(async (nested) => {
    const source = (path: string) => performance.getEntriesByType('resource').find((entry) => entry.name.includes(`/src/${path}`))?.name ?? `/src/${path}`;
    const { createProject, createLayer } = await import(source('domain/factories.ts')), { replaceDocument } = await import(source('history/commandBus.ts')); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const { replaceRuntimeResources } = await import(source('storage/blobRepository.ts')), { sessionStore } = await import(source('state/sessionStore.ts'));
    const { beginCropEdit } = await import(source('images/cropController.ts'));
    const project = createProject(), pageId = project.pageOrder[0]; project.pages[pageId].width = 800; project.pages[pageId].height = 700;
    const panel = createLayer('panel', pageId); panel.geometry = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }]; panel.matrix = [1, 0, 0, 1, 150, 300]; panel.style.borderRadius = 30; panel.style.borderWidth = 0;
    const image = createLayer('image', pageId); image.parentId = panel.id; image.width = 400; image.height = 100; image.crop = { focus: { u: .5, v: .5 }, zoom: 1 }; image.assetId = crypto.randomUUID();
    const peer = { ...image, id: crypto.randomUUID(), name: '下层图片' }, locked = { ...image, id: crypto.randomUUID(), name: '锁定图片', locked: true }; image.name = '上层图片'; panel.children = [peer.id, image.id, locked.id]; locked.visible = false;
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 100; const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 400, 100); const blob = await new Promise<Blob>((resolve) => canvas.toBlob((data) => resolve(data!), 'image/png'));
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    project.assets[image.assetId] = { id: image.assetId, name: 'crop.png', originalHash: hash, renderHash: hash, originalMime: 'image/png', renderMime: 'image/png', width: 400, height: 100, originalBytes: blob.size, renderBytes: blob.size, framePolicy: 'still', normalizedOrientation: true };
    for (const layer of [panel, peer, image, locked]) project.layers[layer.id] = layer;
    const upper = createLayer('panel', pageId); upper.geometry = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 100 }, { x: 0, y: 100 }]; upper.matrix = [1, 0, 0, 1, 60, 300]; upper.style.fill = '#0000FFFF'; upper.style.borderWidth = 0;
    project.layers[upper.id] = upper;
    if (nested) {
      delete project.layers[upper.id];
      const group = createLayer('group', pageId); group.matrix = [0, 1, -1, 0, 580, 120]; panel.matrix = [1, 0, 0, 1, 150, 0]; panel.parentId = group.id; group.children = [panel.id]; project.layers[group.id] = group; project.pages[pageId].roots = [...project.pages[pageId].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...([group.id])];
    } else project.pages[pageId].roots = [...project.pages[pageId].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...([panel.id, upper.id])];
    const replaced = replaceDocument(numberFixture(project)); if (!replaced.ok) throw Error(JSON.stringify(replaced)); replaceRuntimeResources(new Map([[hash, blob]]), new Map([[hash, await createImageBitmap(blob)]]));
    sessionStore.setState({ viewportByPage: { [pageId]: { zoom: 1, pan: { x: 0, y: 0 } } }, selection: [panel.id], scopeId: null });
    const result = beginCropEdit(panel.id); if (!result.ok) throw Error(JSON.stringify(result));
    return { panel: panel.id, image: image.id, peer: peer.id, upper: upper.id, project };
  }, nested);
}
async function state(page: Page) {
  return page.evaluate(async () => {
    const source = (path: string) => performance.getEntriesByType('resource').find((entry) => entry.name.includes(`/src/${path}`))?.name ?? `/src/${path}`;
    const { getDocument } = await import(source('state/documentStore.ts')), { currentCropEdit } = await import(source('images/cropController.ts')), { runtimeStore } = await import(source('state/runtimeStore.ts'));
    const doc = getDocument(); return { project: doc.project, past: doc.history.past.length, active: currentCropEdit(), stats: runtimeStore.getState().renderStats };
  });
}
async function pixel(page: Page, x: number, y: number, index = 1) {
  return page.locator('.canvas-viewport').evaluate((root, point) => { const canvas = root.querySelectorAll('canvas')[point.index], ratio = canvas.width / root.clientWidth; return [...canvas.getContext('2d')!.getImageData(Math.round(point.x * ratio), Math.round(point.y * ratio), 1, 1).data]; }, { x, y, index });
}

test('rounded-mask dark ghost keeps upper paint order, updates only the gesture layer and never appears in PNG', async ({ page }) => {
  const ids = await fixture(page); await expect(page.getByLabel('裁剪目标图片')).toHaveValue(ids.image); await page.waitForTimeout(250);
  expect(await pixel(page, 70, 350)).toEqual([0, 0, 255, 255]);
  const outside = await pixel(page, 110, 350); expect(outside[0]).toBeGreaterThan(outside[1]); expect(outside[1]).toBeGreaterThan(100); expect(outside[0]).toBeLessThan(255);
  expect(await pixel(page, 160, 310)).not.toEqual([255, 0, 0, 255]); expect(await pixel(page, 240, 350)).toEqual([255, 0, 0, 255]);
  const before = await state(page);
  const slider = page.getByLabel('裁剪缩放滑块'), sliderRect = await slider.boundingBox();
  await page.mouse.move(sliderRect!.x + 8, sliderRect!.y + sliderRect!.height / 2); await page.mouse.down();
  for (let step = 1; step <= 20; step++) await page.mouse.move(sliderRect!.x + 8 + step * 2, sliderRect!.y + sliderRect!.height / 2);
  await page.mouse.up(); await page.waitForTimeout(80);
  const draft = await state(page); expect(draft.project).toEqual(before.project); expect(draft.past).toBe(0); expect(draft.stats.mainDraws).toBe(before.stats.mainDraws); expect(draft.stats.gestureDraws).toBeGreaterThan(before.stats.gestureDraws);
  await page.getByRole('button', { name: '完成裁剪' }).click(); await page.waitForTimeout(80); expect((await state(page)).past).toBe(1); expect(await pixel(page, 110, 350, 0)).toEqual([255, 255, 255, 255]);
  const exported = await page.evaluate(async () => {
    const source = (path: string) => performance.getEntriesByType('resource').find((entry) => entry.name.includes(`/src/${path}`))?.name ?? `/src/${path}`;
    const { getProject } = await import(source('state/documentStore.ts')), { runtimeStore } = await import(source('state/runtimeStore.ts')), { exportPng } = await import(source('export/exportFiles.ts'));
    const project = getProject(), result = await exportPng(project, project.pageOrder[0], runtimeStore.getState().images); if (!result.ok) throw Error(JSON.stringify(result));
    const bitmap = await createImageBitmap(result.value), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close(); return [...ctx.getImageData(110, 350, 1, 1).data];
  }); expect(exported).toEqual([255, 255, 255, 255]);
});

test('numeric controls reject invalid values, multi-image switch retains drafts and Escape cancels the whole session', async ({ page }) => {
  const ids = await fixture(page); const zoom = page.getByLabel('裁剪缩放倍数'); await zoom.fill('17'); await zoom.press('Enter'); await expect(page.getByRole('alert')).toContainText('缩放须在1～16'); expect((await state(page)).past).toBe(0); await expect(zoom).toHaveValue('1');
  await zoom.fill('2'); await zoom.press('Enter'); await page.getByLabel('裁剪目标图片').selectOption(ids.peer); await zoom.fill('3'); await zoom.press('Enter');
  const draft = await state(page); expect(draft.active.preview.layers[ids.image].crop.zoom).toBe(2); expect(draft.active.preview.layers[ids.peer].crop.zoom).toBe(3); expect(draft.project).toEqual(ids.project);
  await page.locator('.canvas-viewport').focus(); await page.keyboard.press('ArrowRight'); expect((await state(page)).project).toEqual(ids.project); expect((await state(page)).active).not.toBeNull();
  await page.keyboard.press('Escape'); await expect(page.getByLabel('裁剪目标图片')).toHaveCount(0); expect((await state(page)).project).toEqual(ids.project); expect((await state(page)).past).toBe(0);
});

test('clicking outside commits before selecting another object, and one undo restores all crop targets', async ({ page }) => {
  const ids = await fixture(page); const zoom = page.getByLabel('裁剪缩放倍数'); await zoom.fill('2'); await zoom.press('Enter'); await page.getByLabel('裁剪目标图片').selectOption(ids.peer); await zoom.fill('3'); await zoom.press('Enter');
  const rect = await page.locator('.canvas-viewport').boundingBox(); await page.mouse.click(rect!.x + 70, rect!.y + 350); await expect(page.getByLabel('裁剪目标图片')).toHaveCount(0); const committed = await state(page); expect(committed.past).toBe(1); expect(committed.project.layers[ids.image].crop.zoom).toBe(2); expect(committed.project.layers[ids.peer].crop.zoom).toBe(3);
  await (await menuCommand(page, '撤销')).click(); expect((await state(page)).project).toEqual(ids.project);
});

test('dragging inside a rotated group uses the panel inverse transform and leaves its geometry and document untouched until commit', async ({ page }) => {
  const ids = await fixture(page, true); await page.getByLabel('裁剪缩放倍数').fill('2'); await page.getByLabel('裁剪缩放倍数').press('Enter');
  const rect = await page.locator('.canvas-viewport').boundingBox(); await page.mouse.move(rect!.x + 530, rect!.y + 370); await page.mouse.down(); await page.mouse.move(rect!.x + 530, rect!.y + 410, { steps: 10 }); await page.mouse.up();
  const draft = await state(page); expect(draft.active).not.toBeNull(); const image = draft.active.preview.layers[ids.image]; expect(image.crop.focus.u).toBeCloseTo(.45, 5); expect(image.crop.focus.v).toBeCloseTo(.5, 5); expect(draft.project).toEqual(ids.project); expect(draft.past).toBe(0);
  await page.getByRole('button', { name: '完成裁剪' }).click(); expect((await state(page)).project.layers[ids.panel].geometry).toEqual(ids.project.layers[ids.panel].geometry); expect((await state(page)).past).toBe(1);
});

test('a nested crop ghost stays inside its rotated ancestor clip and clicking the clipped-away part finishes the session', async ({ page }) => {
  const ids = await fixture(page, true);
  await page.evaluate(async (panelId) => {
    const source = (path: string) => performance.getEntriesByType('resource').find((entry) => entry.name.includes(`/src/${path}`))?.name ?? `/src/${path}`;
    const { getProject } = await import(source('state/documentStore.ts')), { replaceDocument } = await import(source('history/commandBus.ts')), { beginCropEdit, cancelCropEdit } = await import(source('images/cropController.ts')), { sessionStore } = await import(source('state/sessionStore.ts')); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    cancelCropEdit(); const project = structuredClone(getProject()), panel = project.layers[panelId], outer = project.layers[panel.parentId];
    project.layers[outer.id] = { ...outer, type: 'panel', role: 'split', geometry: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 0, y: 200 }], style: { fill: '#FFFFFFFF', borderColor: '#000000FF', borderWidth: 0, borderRadius: 0 } };
    panel.geometry = panel.geometry.map((point: any) => ({ x: point.x + 150, y: point.y })); panel.matrix = [1, 0, 0, 1, 0, 0];
    const result = replaceDocument(numberFixture(project)); if (!result.ok) throw Error(JSON.stringify(result)); sessionStore.setState({ viewportByPage: { [panel.pageId]: { zoom: 1, pan: { x: 0, y: 0 } } } }); beginCropEdit(panelId);
  }, ids.panel); await page.waitForTimeout(100);
  expect(await pixel(page, 530, 520)).toEqual([255, 255, 255, 255]); const ghost = await pixel(page, 530, 200); expect(ghost[0]).toBeGreaterThan(ghost[1]); expect(await pixel(page, 530, 370)).toEqual([255, 0, 0, 255]);
  const rect = await page.locator('.canvas-viewport').boundingBox(); await page.mouse.click(rect!.x + 530, rect!.y + 450); await expect(page.getByLabel('裁剪目标图片')).toHaveCount(0);
});
