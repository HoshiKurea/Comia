import { menuCommand, setMenuSnap } from './menuHelpers';
import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  await setMenuSnap(page, false);
  await page.evaluate(() => {
    (window as any).__pointerProbe = { down: null, moved: null, events: [] };
    const root = document.querySelector('.canvas-viewport')!;
    for (const phase of ['pointerdown', 'pointermove', 'pointerup']) root.addEventListener(phase, (event) => {
      const e = event as PointerEvent, probe = (window as any).__pointerProbe;
      if (phase === 'pointerdown') probe.down = { x: e.clientX, y: e.clientY, id: e.pointerId };
      else if (phase === 'pointermove') probe.moved = { x: e.clientX, y: e.clientY };
      probe.events.push({ phase, trusted: e.isTrusted, captured: root.hasPointerCapture(e.pointerId) });
    }, true);
    window.addEventListener('blur', (event) => (window as any).__pointerProbe.events.push({ phase: 'blur', trusted: event.isTrusted }));
  });
  return inspect(page);
}
async function inspect(page: Page) {
  return page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const { getDocument } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts');
    const doc = getDocument(), session = sessionStore.getState(), runtime = runtimeStore.getState(), id = session.selection[0], panel = doc.project.layers[id];
    const rect = document.querySelector('.canvas-viewport')!.getBoundingClientRect(), vp = session.viewportByPage[session.activePageId];
    return { project: doc.project, history: doc.history, preview: runtime.previewProject, active: runtime.gestureActive, id, vp, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, focused: document.hasFocus(), probe: (window as any).__pointerProbe, pixels: document.querySelector<HTMLCanvasElement>('.konvajs-content canvas')!.toDataURL(), center: { x: rect.x + vp.pan.x + (panel.matrix[4] + 300) * vp.zoom, y: rect.y + vp.pan.y + (panel.matrix[5] + 200) * vp.zoom } };
  });
}
async function startDrag(page: Page, before: Awaited<ReturnType<typeof inspect>>) {
  await page.mouse.move(before.center.x, before.center.y); await page.mouse.down(); await page.mouse.move(before.center.x + 30, before.center.y + 20, { steps: 4 });
  const moving = await inspect(page); expect(moving.active).toBe(true); expect(moving.preview).not.toBeNull(); expect(moving.project).toEqual(before.project); expect(moving.history).toEqual(before.history); return moving;
}

test('a native click and two-CSS-pixel movement preserve every coordinate, pixel and history entry', async ({ page }) => {
  const before = await setup(page);
  await page.mouse.click(before.center.x, before.center.y); const clicked = await inspect(page); expect(clicked.project).toEqual(before.project); expect(clicked.history).toEqual(before.history); expect(clicked.pixels).toBe(before.pixels);
  await page.mouse.move(before.center.x, before.center.y); await page.mouse.down(); await page.mouse.move(before.center.x + 2, before.center.y);
  const pressed = await inspect(page); expect(pressed.preview).toBeNull(); expect(pressed.project).toEqual(before.project); expect(pressed.history).toEqual(before.history); await page.mouse.up();
  const ended = await inspect(page); expect(ended.project).toEqual(before.project); expect(ended.history).toEqual(before.history); expect(ended.pixels).toBe(before.pixels);
});

test('native pointer capture keeps an ordinary drag alive outside the canvas and its release commits exactly once with the final input', async ({ page }) => {
  const before = await setup(page); await startDrag(page, before);
  await page.mouse.move(before.rect.x + 100, before.rect.y - 30, { steps: 8 }); const outside = await inspect(page);
  expect(outside.probe.moved.y).toBeLessThan(before.rect.y); expect(outside.probe.events.at(-1)).toMatchObject({ phase: 'pointermove', trusted: true, captured: true }); expect(outside.active).toBe(true);
  await page.mouse.up(); const ended = await inspect(page), oldMatrix = before.project.layers[before.id].matrix, nextMatrix = ended.project.layers[before.id].matrix;
  expect(nextMatrix[4] - oldMatrix[4]).toBeCloseTo((outside.probe.moved.x - outside.probe.down.x) / before.vp.zoom, 6); expect(nextMatrix[5] - oldMatrix[5]).toBeCloseTo((outside.probe.moved.y - outside.probe.down.y) / before.vp.zoom, 6);
  expect(ended.history.past.length).toBe(before.history.past.length + 1); expect(ended.preview).toBeNull(); expect(ended.active).toBe(false);
  await (await menuCommand(page, '撤销')).click(); const undone = await inspect(page); expect(undone.project).toEqual(before.project); expect(undone.pixels).toBe(before.pixels);
});

test('native releasePointerCapture cancels an ordinary object preview and the subsequent move and up cannot reenter the transaction', async ({ page }) => {
  const before = await setup(page), moving = await startDrag(page, before);
  await page.locator('.canvas-viewport').evaluate((root, pointerId) => root.releasePointerCapture(pointerId), moving.probe.down.id);
  await page.mouse.move(before.center.x + 35, before.center.y + 20); await page.mouse.up(); const cancelled = await inspect(page);
  expect(cancelled.project).toEqual(before.project); expect(cancelled.history).toEqual(before.history); expect(cancelled.preview).toBeNull(); expect(cancelled.active).toBe(false); expect(cancelled.pixels).toBe(before.pixels);
});

test('Shift range in a filtered expanded group selects exactly the two matching visible children and excludes context-only and unmatched rows', async ({ page }) => {
  await page.goto('/');
  for (let i = 0; i < 3; i++) await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  for (const [index, name] of ['保留 A', '不匹配 B', '保留 C'].entries()) {
    await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').filter({ hasText: new RegExp(`^分镜 ${index + 1}$`) }).dblclick();
    await page.getByLabel('图层名称', { exact: true }).fill(name); await page.getByLabel('图层名称', { exact: true }).press('Enter');
  }
  await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').first().click(); await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').last().click({ modifiers: ['Shift'] }); await (await menuCommand(page, '编组')).click();
  const baseline = await page.evaluate(async () => { const { getDocument } = await import('/src/' + 'state/documentStore.ts'); return getDocument(); });
  await page.getByLabel('搜索图层', { exact: true }).fill('保留'); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(3); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"]).context-only')).toHaveCount(1);
  const matched = page.locator('.layer-row:not([data-layer-type="pageBackground"]):not(.context-only)'), ids = await matched.evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.layerId));
  await matched.first().locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').click(); await matched.last().locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').click({ modifiers: ['Shift'] });
  const result = await page.evaluate(async () => { const { getDocument } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts'); return { doc: getDocument(), selected: sessionStore.getState().selection }; });
  expect(new Set(result.selected)).toEqual(new Set(ids)); expect(result.selected).toHaveLength(2); expect(result.doc).toEqual(baseline);
});
