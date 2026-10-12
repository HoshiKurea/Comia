import { expect, test, type Page } from '@playwright/test';
import type { DocumentStoreState } from '../../src/state/documentStore';

async function state(page: Page) {
  return page.evaluate(async () => {
    const { getDocument } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return { ...(getDocument() as DocumentStoreState), session: sessionStore.getState() };
  });
}
async function fixture(page: Page) {
  await page.goto('/');
  await expect.poll(() => page.evaluate(async () => {
    const { getProject } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    return Boolean(getProject().pages[sessionStore.getState().activePageId]);
  })).toBe(true);
  return page.evaluate(async () => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts'), { replaceDocument } = await import('/src/' + 'history/commandBus.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts'); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const project = createProject(), pageId = project.pageOrder[0], panel = createLayer('panel', pageId);
    panel.geometry = [{ x: 0, y: 0 }, { x: 128, y: 0 }, { x: 128, y: 128 }, { x: 0, y: 128 }]; panel.matrix = [1, 0, 0, 1, 300, 200];
    Object.assign(project.pages[pageId], { width: 800, height: 600 }); project.layers[panel.id] = panel; project.pages[pageId].roots = [...project.pages[pageId].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...([panel.id])];
    const result = replaceDocument(numberFixture(project)); if (!result.ok) throw Error(JSON.stringify(result.problems));
    sessionStore.setState({ activePageId: pageId, selection: [panel.id], scopeId: null, toolMode: 'select', snap16: false, viewportByPage: { [pageId]: { zoom: 1, pan: { x: -140, y: -40 } } } });
    return panel.id;
  });
}
async function corner(page: Page) { const rect = (await page.locator('.canvas-viewport').boundingBox())!; return { x: rect.x + 160, y: rect.y + 160 }; }

test('actual overlay handle fill pixels and ten-CSS-pixel diameter match at 25 and 400 percent zoom', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.arc;
    (window as any).__controlArcs = [];
    CanvasRenderingContext2D.prototype.arc = function(x, y, radius, start, end, counterclockwise) {
      if (this.canvas === document.querySelectorAll('.konvajs-content canvas')[3]) (window as any).__controlArcs.push({ x, y, radius });
      return original.call(this, x, y, radius, start, end, counterclockwise);
    };
  });
  const images: number[][] = [];
  for (const zoom of [.25, 4]) {
    await page.evaluate(async (zoom) => {
      const { setViewport, sessionStore } = await import('/src/' + 'state/sessionStore.ts');
      setViewport(sessionStore.getState().activePageId, { zoom, pan: { x: 160 - zoom * 300, y: 160 - zoom * 200 } });
    }, zoom);
    await state(page);
    const capture = await page.locator('.konvajs-content canvas').nth(3).evaluate((element) => {
      const canvas = element as HTMLCanvasElement, context = canvas.getContext('2d')!;
      // Resolve the actual off-white handle fill separately from the dashed
      // selection polygon, whose dash phase properly changes with zoom.
      const pixels = [...context.getImageData(153, 153, 14, 14).data];
      const mask = Array.from({ length: 196 }, (_, i) => pixels[i * 4] === 255 && pixels[i * 4 + 1] === 253 && pixels[i * 4 + 2] === 249 && pixels[i * 4 + 3] === 255 ? 1 : 0);
      return { mask, radius: (window as any).__controlArcs.filter((arc: any) => arc.x === 160 && arc.y === 160).at(-1)?.radius };
    });
    expect(capture.radius).toBe(5); expect(capture.mask.some(Boolean)).toBe(true); images.push(capture.mask);
  }
  expect(images[1]).toEqual(images[0]);
  // The unblended off-white interior of the 10px circle spans 8 raster pixels;
  // the remaining boundary is the orange stroke and antialiasing.
  const pixels = images[0], white: { x: number; y: number }[] = [];
  for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) if (pixels[y * 14 + x]) white.push({ x, y });
  expect(Math.max(...white.map((p) => p.x)) - Math.min(...white.map((p) => p.x)) + 1).toBe(8);
  expect(Math.max(...white.map((p) => p.y)) - Math.min(...white.map((p) => p.y)) + 1).toBe(8);
});

test('mouse handle hit includes eight CSS pixels and excludes nine without accidentally moving the content', async ({ page }) => {
  const id = await fixture(page), before = await state(page), at = await corner(page);
  await page.mouse.move(at.x - 9, at.y); await page.mouse.down(); await page.mouse.move(at.x - 31, at.y - 22, { steps: 8 }); await page.mouse.up();
  const missed = await state(page); expect(missed.project).toEqual(before.project); expect(missed.history).toEqual(before.history); expect(missed.session.selection).toEqual([]);
  await page.locator(`[data-layer-id="${id}"] .layer-name`).click();
  await page.mouse.move(at.x - 8, at.y); await page.mouse.down(); await page.mouse.move(at.x - 30, at.y - 22, { steps: 8 }); await page.mouse.up();
  const resized = await state(page); expect(resized.project.layers[id].matrix).toEqual(before.project.layers[id].matrix);
  expect(resized.project.layers[id]).not.toEqual(before.project.layers[id]); expect(resized.history.past).toHaveLength(before.history.past.length + 1);
  await page.keyboard.press('Control+z'); expect((await state(page)).project).toEqual(before.project);
});

test('native browser touch input includes fourteen CSS pixels and excludes fifteen at a selected corner handle', async ({ page, context }) => {
  const id = await fixture(page), before = await state(page), at = await corner(page), cdp = await context.newCDPSession(page);
  const drag = async (radius: number) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: at.x - radius, y: at.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: at.x - radius - 22, y: at.y - 22 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await drag(15); const missed = await state(page); expect(missed.project).toEqual(before.project); expect(missed.history).toEqual(before.history);
  await page.locator(`[data-layer-id="${id}"] .layer-name`).click(); await drag(14);
  const resized = await state(page); expect(resized.project.layers[id].matrix).toEqual(before.project.layers[id].matrix); expect(resized.project.layers[id]).not.toEqual(before.project.layers[id]);
  expect(resized.history.past).toHaveLength(before.history.past.length + 1); await cdp.detach();
  // Browser-engine touch injection proves the hit radius, not physical stylus
  // or OS touch hardware compatibility.
});

test('a locked layer can be selected and unlocked in the layer panel but cannot move on the canvas', async ({ page }) => {
  const id = await fixture(page), row = page.locator(`[data-layer-id="${id}"]`);
  await row.locator('button[aria-label="锁定"]:not(.layer-row[data-layer-type="pageBackground"] button)').click(); await row.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').click();
  const before = await state(page); expect(before.session.selection).toEqual([id]);
  const rect = (await page.locator('.canvas-viewport').boundingBox())!;
  await page.mouse.move(rect.x + 224, rect.y + 224); await page.mouse.down(); await page.mouse.move(rect.x + 268, rect.y + 246, { steps: 10 }); await page.mouse.up();
  const unchanged = await state(page); expect(unchanged.project).toEqual(before.project); expect(unchanged.history).toEqual(before.history);
  await row.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').click(); await expect(page.getByLabel('对象X', { exact: true })).toBeDisabled();
  await row.getByRole('button', { name: '解锁', exact: true }).click(); await expect(page.getByLabel('对象X', { exact: true })).toBeEnabled();
});

test('clicking the empty part of a trapezoid bounding box selects the visible object behind it without editing history', async ({ page }) => {
  const id = await fixture(page);
  const belowId = await page.evaluate(async (id) => {
    const { createLayer } = await import('/src/' + 'domain/factories.ts'), { getProject } = await import('/src/' + 'state/documentStore.ts'), { execute } = await import('/src/' + 'history/commandBus.ts');
    const project = getProject(), target = project.layers[id], below = createLayer('panel', target.pageId);
    below.geometry = structuredClone(target.geometry); below.matrix = [...target.matrix]; below.style.fill = '#0000FFFF';
    const result = execute({ label: '创建实际梯形遮挡场景', context: { pageId: target.pageId, selection: [id] }, mutate(draft: typeof project) {
      draft.layers[id].geometry = [{ x: 30, y: 0 }, { x: 128, y: 0 }, { x: 128, y: 128 }, { x: 0, y: 128 }]; draft.layers[below.id] = below; draft.pages[target.pageId].roots.splice(draft.pages[target.pageId].roots[0] && draft.layers[draft.pages[target.pageId].roots[0]].type === 'pageBackground' ? 1 : 0, 0, below.id);
    } });
    if (!result.ok) throw Error(JSON.stringify(result.problems)); return below.id;
  }, id);
  const at = await corner(page); await page.mouse.click(at.x + 400, at.y + 300); // Remove the selected object's control handles first.
  const before = await state(page); expect(before.session.selection).toEqual([]);
  await page.mouse.click(at.x + 4, at.y + 4); const after = await state(page);
  expect(after.session.selection).toEqual([belowId]); expect(after.project).toEqual(before.project); expect(after.history).toEqual(before.history);
  await expect(page.locator(`[data-layer-id="${belowId}"]`)).toHaveClass(/selected/);
});
