import { menuCommand } from './menuHelpers';
import { expect, test, type Page } from '@playwright/test';
import type { Project, Result } from '../../src/domain/types';
import type { DocumentStoreState } from '../../src/state/documentStore';
import type { RuntimeStoreState } from '../../src/state/runtimeStore';
import type { BubbleGeometry } from '../../src/bubbles/geometry';

const bodies = ['roundRect', 'rect', 'circle', 'cloud', 'spiky'] as const;
const names = ['对白气泡', '方框气泡', '圆形气泡', '云朵气泡', '尖刺气泡'];
async function emptyPage(page: Page) {
  // Each Playwright test owns a fresh context. Within a five-shape sample,
  // replace its test document instead of reloading dirty projects and then
  // accidentally interacting through the legitimate recovery dialog.
  if (page.url() === 'about:blank') await page.goto('/'); await expect(page.locator('.canvas-viewport')).toBeVisible();
  await page.evaluate(async () => {
    const { createProject } = await import('/src/' + 'domain/factories.ts'), { replaceDocument } = await import('/src/' + 'history/commandBus.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts'); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const project = createProject(), id = project.pageOrder[0]; Object.assign(project.pages[id], { width: 800, height: 600 });
    const result = replaceDocument(numberFixture(project)); if (!result.ok) throw Error(result.problems[0].message);
    sessionStore.setState({ activePageId: id, selection: [], toolMode: 'select', snap16: false, viewportByPage: { [id]: { zoom: 1, pan: { x: 20, y: 20 } } } });
  });
}
async function inspect(page: Page) {
  return page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const { getDocument } = await import('/src/' + 'state/documentStore.ts'), { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts'), { buildBubble } = await import('/src/' + 'bubbles/geometry.ts');
    const doc = getDocument() as DocumentStoreState, runtime = runtimeStore.getState() as RuntimeStoreState, project = runtime.previewProject ?? doc.project;
    const bubble = Object.values(project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((layer) => layer.type === 'bubble')!; if (bubble.type !== 'bubble') throw Error('Missing bubble');
    const canvas = document.querySelector<HTMLCanvasElement>('.konvajs-content canvas')!;
    const geometry: Result<BubbleGeometry> = buildBubble(bubble.shape, bubble.width, bubble.height, bubble.style, bubble.tail);
    return { project: doc.project, history: doc.history, preview: runtime.previewProject, bubble, text: project.layers[bubble.children[0]], geometry, stats: runtime.renderStats, pixels: canvas.toDataURL() };
  });
}
async function localPoint(page: Page, x: number, y: number) {
  return page.evaluate(async ({ x, y }) => {
    const { getProject } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const p = getProject() as Project, s = sessionStore.getState(), bubble = Object.values(p.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((layer) => layer.type === 'bubble')!, m = bubble.matrix, vp = s.viewportByPage[s.activePageId], root = document.querySelector('.canvas-viewport')!.getBoundingClientRect();
    return { x: root.x + vp.pan.x + (m[0] * x + m[2] * y + m[4]) * vp.zoom, y: root.y + vp.pan.y + (m[1] * x + m[3] * y + m[5]) * vp.zoom };
  }, { x, y });
}
async function compareExport(page: Page) {
  return page.evaluate(async () => {
    const { getProject } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { exportPng } = await import('/src/' + 'export/exportFiles.ts');
    const project = getProject(), s = sessionStore.getState(), id = s.activePageId, vp = s.viewportByPage[id], paper = project.pages[id];
    if (devicePixelRatio !== 1 || vp.zoom !== 1) throw Error('Exact integer paper raster precondition');
    const result = await exportPng(project, id, new Map()); if (!result.ok) throw Error(result.problems[0].message);
    const bitmap = await createImageBitmap(result.value), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
    const exported = ctx.getImageData(0, 0, canvas.width, canvas.height).data, main = document.querySelector<HTMLCanvasElement>('.konvajs-content canvas')!;
    const screen = main.getContext('2d')!.getImageData(vp.pan.x, vp.pan.y, paper.width, paper.height).data;
    const differences = exported.reduce((sum, value, index) => sum + Number(value !== screen[index]), 0), size = [canvas.width, canvas.height]; canvas.width = canvas.height = 0;
    return { differences, size };
  });
}

test('all five actual dragged templates move and resize once, circles stay square and their full screen rasters equal PNG export', async ({ page }) => {
  test.setTimeout(60_000);
  for (const [index, shape] of bodies.entries()) {
    await emptyPage(page); const root = (await page.locator('.canvas-viewport').boundingBox())!, item = page.locator('.library-item').filter({ hasText: names[index] });
    await item.scrollIntoViewIfNeeded(); const box = (await item.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(root.x + 420, root.y + 270, { steps: 8 }); await page.mouse.up();
    const deployed = await inspect(page); expect(deployed.bubble.shape).toBe(shape); expect(deployed.history.past).toHaveLength(1);
    const center = await localPoint(page, deployed.bubble.width / 2, deployed.bubble.height / 2);
    await page.mouse.move(center.x, center.y); await page.mouse.down(); await page.mouse.move(center.x + 17, center.y + 13); await page.mouse.up();
    const moved = await inspect(page); expect(moved.bubble.matrix[4]).toBe(deployed.bubble.matrix[4] + 17); expect(moved.bubble.matrix[5]).toBe(deployed.bubble.matrix[5] + 13); expect(moved.history.past).toHaveLength(2);
    const corner = await localPoint(page, moved.bubble.width, moved.bubble.height);
    await page.mouse.move(corner.x, corner.y); await page.mouse.down(); await page.mouse.move(corner.x + 40, corner.y + 10); await page.mouse.up();
    const resized = await inspect(page); expect(resized.history.past).toHaveLength(3); expect(resized.bubble.width).toBe(moved.bubble.width + 40);
    expect(resized.bubble.height).toBe(moved.bubble.height + (shape === 'circle' ? 40 : 10)); expect(resized.geometry.ok).toBe(true);
    if (shape === 'circle') expect(resized.bubble.width).toBe(resized.bubble.height);
    expect(await compareExport(page)).toEqual({ differences: 0, size: [800, 600] });
    for (const format of ['PNG', 'PDF']) {
      const pending = page.waitForEvent('download'); await (await menuCommand(page, format)).click(); const download = await pending;
      await download.saveAs(`output/playwright/bubble-${shape}-${test.info().project.name || 'edge'}.${format.toLowerCase()}`);
    }
    await (await menuCommand(page, '撤销')).click(); const undone = await inspect(page); expect(undone.project).toEqual(moved.project); expect(undone.pixels).toBe(moved.pixels);
  }
});

test('cloud and spiky safe boxes follow the independent minimum-radius formula and their vertices follow deterministic polar formulas', async ({ page }) => {
  for (const shape of ['cloud', 'spiky'] as const) {
    await emptyPage(page); await page.locator('.library-item').filter({ hasText: shape === 'cloud' ? '云朵气泡' : '尖刺气泡' }).click();
    const state = await inspect(page), b = state.bubble, count = shape === 'cloud' ? 96 : 24, rMin = shape === 'cloud' ? .92 / 1.08 : .76;
    expect(state.geometry.ok).toBe(true); if (!state.geometry.ok) throw Error('Invalid geometry');
    const box = state.geometry.value.textBox, halfW = Math.max(0, b.width / 2 * rMin / Math.SQRT2 - 12), halfH = Math.max(0, b.height / 2 * rMin / Math.SQRT2 - 12);
    expect(box.x).toBeCloseTo(b.width / 2 - halfW, 6); expect(box.y).toBeCloseTo(b.height / 2 - halfH, 6); expect(box.width).toBeCloseTo(2 * halfW, 6); expect(box.height).toBeCloseTo(2 * halfH, 6);
    const points = state.geometry.value.outline.ops.flatMap((op) => op.op === 'M' || op.op === 'L' ? [op.p] : []); expect(points).toHaveLength(count);
    for (const [i, point] of points.entries()) { const theta = 2 * Math.PI * i / count, r = shape === 'cloud' ? (1 + .08 * Math.cos(12 * theta)) / 1.08 : i % 2 === 0 ? 1 : .76;
      expect(point.x).toBeCloseTo(b.width / 2 + b.width / 2 * r * Math.cos(theta), 6); expect(point.y).toBeCloseTo(b.height / 2 + b.height / 2 * r * Math.sin(theta), 6); }
    // Each corner stays strictly inside the inner ellipse, which itself is
    // contained by all of the deterministic body boundary points.
    for (const x of [box.x, box.x + box.width]) for (const y of [box.y, box.y + box.height]) expect(((x - b.width / 2) / (b.width / 2 * rMin)) ** 2 + ((y - b.height / 2) / (b.height / 2 * rMin)) ** 2).toBeLessThan(1);
  }
});

test('minimum bubble dimensions keep the complete dialogue and nonnegative zero safe box while showing overflow and exporting transparently', async ({ page }) => {
  await emptyPage(page); await page.locator('.library-item').filter({ hasText: '云朵气泡' }).click();
  const before = await inspect(page), center = await localPoint(page, before.bubble.width / 2, before.bubble.height / 2);
  await page.mouse.dblclick(center.x, center.y); await page.getByLabel('编辑文字内容').fill('原文😀仍然完整\n第二段对白'); await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.locator(`[data-layer-id="${before.bubble.id}"] .layer-name`).click();
  await page.getByLabel('对象宽', { exact: true }).fill('16'); await page.getByLabel('对象宽', { exact: true }).press('Enter');
  await page.getByLabel('对象高', { exact: true }).fill('16'); await page.getByLabel('对象高', { exact: true }).press('Enter');
  const small = await inspect(page); expect(small.bubble.width).toBe(16); expect(small.bubble.height).toBe(16); expect(small.geometry.ok).toBe(true);
  if (!small.geometry.ok || small.text.type !== 'text') throw Error('Missing text'); expect(small.geometry.value.textBox).toEqual({ x: 8, y: 8, width: 0, height: 0 }); expect(small.text.text.content).toBe('原文😀仍然完整\n第二段对白');
  const tinyCenter = await localPoint(page, 8, 8); await page.mouse.dblclick(tinyCenter.x, tinyCenter.y); await expect(page.getByText('文字溢出 · 内容保留', { exact: true })).toBeVisible(); await page.keyboard.press('Escape');
  await page.locator(`[data-layer-id="${before.bubble.id}"] .layer-name`).click();
  await page.getByLabel('气泡填充色RGBA').fill('#FFFFFF00'); await page.getByLabel('气泡填充色RGBA').press('Enter'); expect((await inspect(page)).bubble.style.fill).toBe('#FFFFFF00'); expect(await compareExport(page)).toEqual({ differences: 0, size: [800, 600] });
});

test('a 16384px curved bubble can be selected natively without exhausting the tail flattening budget and its empty bounding corner does not hit', async ({ page }) => {
  await emptyPage(page); const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const id = await page.evaluate(async () => {
    const { createLayer } = await import('/src/' + 'domain/factories.ts'), { getProject } = await import('/src/' + 'state/documentStore.ts'), { replaceDocument } = await import('/src/' + 'history/commandBus.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts'); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const p = structuredClone(getProject()), pageId = p.pageOrder[0], bubble = createLayer('bubble', pageId); if (bubble.type !== 'bubble') throw Error('Bad factory');
    bubble.shape = 'circle'; bubble.width = bubble.height = 16384; bubble.matrix = [1,0,0,1,-8092,-8092]; bubble.children = [];  p.layers[bubble.id] = bubble; p.pages[pageId].roots = [...p.pages[pageId].roots.filter((id: string) => p.layers[id]?.type === 'pageBackground'), ...([bubble.id])];
    const result = replaceDocument(numberFixture(p)); if (!result.ok) throw Error(result.problems[0].message); sessionStore.setState({ activePageId: pageId, selection: [], viewportByPage: { [pageId]: { zoom: 1, pan: { x: 20, y: 20 } } } }); return bubble.id;
  });
  const before = await inspect(page), root = (await page.locator('.canvas-viewport').boundingBox())!; await page.mouse.click(root.x + 120, root.y + 120);
  const selected = await page.evaluate(async () => (await import('/src/' + 'state/sessionStore.ts')).sessionStore.getState().selection); expect(errors).toEqual([]); expect(selected).toEqual([id]);
  expect((await inspect(page)).project).toEqual(before.project); expect((await inspect(page)).history).toEqual(before.history);
  const corner = await page.evaluate(async () => { const { getProject } = await import('/src/' + 'state/documentStore.ts'), { hitLayer } = await import('/src/' + 'render/drawScene.ts'); const p = getProject(); return hitLayer(p,p.pageOrder[0],{x:-8091,y:-8091}); }); expect(corner).toBeNull();
});
