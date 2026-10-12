import { menuCommand } from './menuHelpers';
import { expect, test, type Page } from '@playwright/test';
import type { Point, Project, PanelLayer, ImageLayer } from '../../src/domain/types';
import type { DocumentStoreState } from '../../src/state/documentStore';

const rectangle = [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 160 }, { x: 0, y: 160 }];
const pentagon = Array.from({ length: 5 }, (_, i) => ({ x: 120 + 110 * Math.cos(i * 2 * Math.PI / 5), y: 90 + 80 * Math.sin(i * 2 * Math.PI / 5) }));
const triangle = [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 120, y: 160 }];

async function fixture(page: Page, geometry = rectangle, nested = false, aligned = false) {
  if(page.url()==='about:blank')await page.goto('/');
  await expect.poll(() => page.evaluate(async () => {
    const { getProject } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    return Boolean(getProject().pages[sessionStore.getState().activePageId]);
  })).toBe(true);
  return page.evaluate(async ({ geometry, nested, aligned }) => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts'), { replaceDocument } = await import('/src/' + 'history/commandBus.ts'); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { multiply, translation, rotationRad } = await import('/src/' + 'geometry/matrix.ts');
    const { decodeImage, placeImage } = await import('/src/' + 'assets/importImage.ts');
    const project = createProject(), pageId = project.pageOrder[0], group = createLayer('group', pageId), panel = createLayer('panel', pageId);
    Object.assign(project.pages[pageId], { width: 900, height: 700 }); panel.geometry = geometry; panel.parentId = group.id;
    group.matrix = aligned ? translation(200, 200) : multiply(translation(200, 200), multiply(rotationRad(37 * Math.PI / 180), [1.15, 0, .2, .85, 0, 0])); group.children = [panel.id];
    let parentId: string | null = null;
    if (nested) {
      const parent = createLayer('panel', pageId); parent.geometry = [{ x: 0, y: 0 }, { x: 320, y: 0 }, { x: 320, y: 240 }, { x: 0, y: 240 }];
      parent.role = 'split'; parent.children = [panel.id]; parent.parentId = group.id; panel.parentId = parent.id; group.children = [parent.id]; project.layers[parent.id] = parent; parentId = parent.id;
    }
    project.layers[group.id] = group; project.layers[panel.id] = panel; project.pages[pageId].roots = [...project.pages[pageId].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...([group.id])];
    const result = replaceDocument(numberFixture(project)); if (!result.ok) throw Error(JSON.stringify(result.problems));
    sessionStore.setState({ activePageId: pageId, scopeId: group.id, selection: [panel.id], toolMode: 'select', geometryConstraint: 'freeConvex', snap16: false, viewportByPage: { [pageId]: { zoom: 1, pan: { x: 12, y: 12 } } } });
    // Import an actual locally encoded checker PNG through the production decoder
    // and placement command; fixture preparation does not test OS drop targeting.
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256; const ctx = canvas.getContext('2d')!;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { ctx.fillStyle = (x + y) % 2 ? '#ff0000' : '#0066ff'; ctx.fillRect(x * 16, y * 16, 16, 16); }
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png')); canvas.width = canvas.height = 0;
    const decoded = await decodeImage(new File([blob], 'geometry-checker.png', { type: 'image/png' }), new AbortController().signal); if (!decoded.ok) throw Error(JSON.stringify(decoded.problems));
    const image = placeImage(decoded.value, pageId, { x: 0, y: 0 }, panel.id); if (!image.ok) throw Error(JSON.stringify(image.problems));
    sessionStore.setState({ selection: [panel.id] });
    const root = document.querySelector('.canvas-viewport')!;
    (window as any).__geometryPointers = {};
    for (const phase of ['pointerdown', 'pointermove']) root.addEventListener(phase, (event) => {
      const e = event as PointerEvent; (window as any).__geometryPointers[phase] = { x: e.clientX, y: e.clientY };
    }, true);
    (window as any).__geometryCaptions = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
      if (this.canvas === document.querySelectorAll('.konvajs-content canvas')[3]) (window as any).__geometryCaptions.push(text);
      return maxWidth === undefined ? fillText.call(this, text, x, y) : fillText.call(this, text, x, y, maxWidth);
    };
    return { panel: panel.id, image: image.value, group: group.id, parent: parentId };
  }, { geometry, nested, aligned });
}
async function state(page: Page) {
  return page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const { getDocument } = await import('/src/' + 'state/documentStore.ts'), { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { worldMatrix } = await import('/src/' + 'geometry/matrix.ts');
    const doc = getDocument() as DocumentStoreState, runtime = runtimeStore.getState();
    const session = sessionStore.getState(), vp = session.viewportByPage[session.activePageId], rect = document.querySelector('.canvas-viewport')!.getBoundingClientRect(), m = worldMatrix(doc.project, session.selection[0]);
    const local = (p: Point | undefined) => {
      if (!p) return null;
      const x = (p.x - rect.x - vp.pan.x) / vp.zoom - m[4], y = (p.y - rect.y - vp.pan.y) / vp.zoom - m[5], determinant = m[0] * m[3] - m[1] * m[2];
      return { x: (m[3] * x - m[2] * y) / determinant, y: (-m[1] * x + m[0] * y) / determinant };
    };
    return { project: doc.project, history: doc.history, preview: runtime.previewProject as Project | null, render: runtime.renderStats, constraint: session.geometryConstraint, pixels: document.querySelector<HTMLCanvasElement>('.konvajs-content canvas')!.toDataURL(), captions: (window as any).__geometryCaptions as string[], down: local((window as any).__geometryPointers.pointerdown), moved: local((window as any).__geometryPointers.pointermove) };
  });
}
async function screen(page: Page, id: string, local: Point) {
  return page.evaluate(async ({ id, local }) => {
    const { getProject } = await import('/src/' + 'state/documentStore.ts'), { worldMatrix, apply } = await import('/src/' + 'geometry/matrix.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const session = sessionStore.getState(), vp = session.viewportByPage[session.activePageId], rect = document.querySelector('.canvas-viewport')!.getBoundingClientRect(), p = apply(worldMatrix(getProject(), id), local);
    return { x: rect.x + vp.pan.x + p.x * vp.zoom, y: rect.y + vp.pan.y + p.y * vp.zoom };
  }, { id, local });
}
async function dragPreview(page: Page, id: string, from: Point, to: Point) {
  const start = await screen(page, id, from), end = await screen(page, id, to);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.evaluate(async () => { const { resetRenderStats } = await import('/src/' + 'state/runtimeStore.ts'); resetRenderStats(); (window as any).__geometryCaptions = []; });
  await page.mouse.move(end.x, end.y, { steps: 8 }); return state(page);
}
function closePoint(actual: Point, expected: Point) { expect(actual.x).toBeCloseTo(expected.x, 6); expect(actual.y).toBeCloseTo(expected.y, 6); }
function assertCover(project: Project, panelId: string, imageId: string) {
  const panel = project.layers[panelId] as PanelLayer, image = project.layers[imageId] as ImageLayer, crop = image.crop!;
  const xs = panel.geometry.map((p) => p.x), ys = panel.geometry.map((p) => p.y), x0 = Math.min(...xs), y0 = Math.min(...ys), width = Math.max(...xs) - x0, height = Math.max(...ys) - y0;
  const s = Math.max(width / image.width, height / image.height) * crop.zoom, tx = x0 + width / 2 - crop.focus.u * image.width * s, ty = y0 + height / 2 - crop.focus.v * image.height * s;
  expect(tx).toBeLessThanOrEqual(x0 + 1e-6); expect(ty).toBeLessThanOrEqual(y0 + 1e-6); expect(tx + image.width * s).toBeGreaterThanOrEqual(x0 + width - 1e-6); expect(ty + image.height * s).toBeGreaterThanOrEqual(y0 + height - 1e-6);
  expect(crop.focus.u).toBeCloseTo(.5, 6); expect(crop.focus.v).toBeCloseTo(.5, 6); expect(crop.zoom).toBe(1); expect(image.matrix).toEqual([1, 0, 0, 1, 0, 0]);
}
async function assertCommitUndo(page: Page, before: Awaited<ReturnType<typeof state>>) {
  await page.mouse.up(); const committed = await state(page); expect(committed.history.past.length).toBe(before.history.past.length + 1); expect(committed.preview).toBeNull();
  await (await menuCommand(page, '撤销')).click(); const undone = await state(page); expect(undone.project).toEqual(before.project); expect(undone.pixels).toBe(before.pixels);
  await (await menuCommand(page, '重做')).click(); const redone = await state(page); expect(redone.project).toEqual(committed.project); expect(redone.pixels).toBe(committed.pixels);
}

test('every free vertex of a quadrilateral, triangle and pentagon moves alone through a rotated sheared parent and reflows its real image', async ({ page }) => {
  test.setTimeout(60000);
  for (const geometry of [rectangle, triangle, pentagon]) for (let i = 0; i < geometry.length; i++) {
    const ids = await fixture(page, geometry); await page.getByRole('button', { name: '几何', exact: true }).click(); const before = await state(page);
    const original = geometry[i], end = { x: original.x + (original.x - 120) * .08, y: original.y + (original.y - 80) * .08 }, during = await dragPreview(page, ids.panel, original, end);
    expect(during.project).toEqual(before.project); expect(during.history).toEqual(before.history); expect(during.render.mainDraws).toBe(0); expect(during.render.gestureDraws).toBeGreaterThan(0);
    const panel = during.preview!.layers[ids.panel] as PanelLayer;
    const delivered = during.moved!;
    for (let j = 0; j < geometry.length; j++) closePoint(panel.geometry[j], j === i ? delivered : geometry[j]);
    expect(during.preview!.layers[ids.group]).toEqual(before.project.layers[ids.group]); assertCover(during.preview!, ids.panel, ids.image);
    const previous = panel.geometry[(i + geometry.length - 1) % geometry.length], next = panel.geometry[(i + 1) % geometry.length], a = { x: previous.x - delivered.x, y: previous.y - delivered.y }, b = { x: next.x - delivered.x, y: next.y - delivered.y };
    const angle = Math.atan2(Math.abs(a.x * b.y - a.y * b.x), a.x * b.x + a.y * b.y) * 180 / Math.PI;
    expect(during.captions).toContain(`X ${delivered.x.toFixed(1)} · Y ${delivered.y.toFixed(1)} · 夹角 ${angle.toFixed(1)}°`);
    if (geometry.length !== 4) await expect(page.getByLabel('平行四边形约束')).toBeDisabled();
    await assertCommitUndo(page, before);
  }
});

test('all four constrained corners keep the opposite point and parallel sum invariant throughout actual preview frames', async ({ page }) => {
  test.setTimeout(60000);
  for (let i = 0; i < 4; i++) {
    const ids = await fixture(page); await page.getByRole('button', { name: '几何', exact: true }).click(); await page.getByLabel('平行四边形约束').check(); const before = await state(page);
    const from = rectangle[i], delta = { x: (from.x - 120) * .1, y: (from.y - 80) * .1 }, start = await screen(page, ids.panel, from);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    for (let step = 1; step <= 4; step++) {
      const end = { x: from.x + delta.x * step / 4, y: from.y + delta.y * step / 4 }, pointer = await screen(page, ids.panel, end); await page.mouse.move(pointer.x, pointer.y);
      const current = await state(page), poly = (current.preview!.layers[ids.panel] as PanelLayer).geometry;
      closePoint(poly[(i + 2) % 4], rectangle[(i + 2) % 4]); closePoint({ x: poly[0].x + poly[2].x, y: poly[0].y + poly[2].y }, { x: poly[1].x + poly[3].x, y: poly[1].y + poly[3].y });
      const deliveredDelta = { x: current.moved!.x - from.x, y: current.moved!.y - from.y };
      for (let j = 0; j < 4; j++) closePoint(poly[j], { x: rectangle[j].x + deliveredDelta.x * (j === i ? 1 : j === (i + 2) % 4 ? 0 : .5), y: rectangle[j].y + deliveredDelta.y * (j === i ? 1 : j === (i + 2) % 4 ? 0 : .5) });
      expect(current.project).toEqual(before.project); assertCover(current.preview!, ids.panel, ids.image);
    }
    await assertCommitUndo(page, before);
  }
});

test('a triangle vertex dragged beyond the opposite edge stops on the original winding side and undoes geometry and crop together', async ({ page }) => {
  const ids = await fixture(page, triangle); await page.getByRole('button', { name: '几何', exact: true }).click(); const before = await state(page);
  const during = await dragPreview(page, ids.panel, triangle[2], { x: 120, y: -160 }), poly = (during.preview!.layers[ids.panel] as PanelLayer).geometry;
  expect(poly[2].y).toBeGreaterThan(0); expect(poly[2].y).toBeLessThan(.1); closePoint(poly[0], triangle[0]); closePoint(poly[1], triangle[1]);
  expect(240 * poly[2].y / 2).toBeGreaterThanOrEqual(4 - 1e-6); expect(during.render.mainDraws).toBe(0); assertCover(during.preview!, ids.panel, ids.image); await assertCommitUndo(page, before);
});

test('a nested child vertex stops inside its convex parent clip and a collapsed edge stops at the one-pixel minimum', async ({ page }) => {
  const child = [{ x: 20, y: 20 }, { x: 280, y: 20 }, { x: 280, y: 200 }, { x: 20, y: 200 }], ids = await fixture(page, child, true);
  await page.getByRole('button', { name: '几何', exact: true }).click(); const before = await state(page), during = await dragPreview(page, ids.panel, child[0], { x: -120, y: -80 }), poly = (during.preview!.layers[ids.panel] as PanelLayer).geometry;
  for (const p of poly) { expect(p.x).toBeGreaterThanOrEqual(-1e-6); expect(p.y).toBeGreaterThanOrEqual(-1e-6); expect(p.x).toBeLessThanOrEqual(320 + 1e-6); expect(p.y).toBeLessThanOrEqual(240 + 1e-6); }
  expect(poly[0].x).toBeCloseTo(0, 5); expect(during.preview!.layers[ids.parent!]).toEqual(before.project.layers[ids.parent!]); assertCover(during.preview!, ids.panel, ids.image); await assertCommitUndo(page, before);
  const short = await fixture(page); await page.getByRole('button', { name: '几何', exact: true }).click(); const start = await state(page), end = await dragPreview(page, short.panel, rectangle[0], rectangle[1]), result = (end.preview!.layers[short.panel] as PanelLayer).geometry;
  expect(Math.hypot(result[1].x - result[0].x, result[1].y - result[0].y)).toBeCloseTo(1, 5); assertCover(end.preview!, short.panel, short.image); await assertCommitUndo(page, start);
});

test('all quad and pentagon edge handles project onto the normal and move only the two endpoints with one crop-aware transaction', async ({ page }) => {
  test.setTimeout(60000);
  for (const geometry of [rectangle, pentagon]) for (let i = 0; i < geometry.length; i++) {
    const ids = await fixture(page, geometry); await page.getByRole('button', { name: '几何', exact: true }).click(); const before = await state(page), a = geometry[i], b = geometry[(i + 1) % geometry.length], length = Math.hypot(b.x - a.x, b.y - a.y);
    const normal = { x: (b.y - a.y) / length, y: (a.x - b.x) / length }, tangent = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }, from = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, end = { x: from.x + 20 * normal.x + 15 * tangent.x, y: from.y + 20 * normal.y + 15 * tangent.y };
    const during = await dragPreview(page, ids.panel, from, end), panel = during.preview!.layers[ids.panel] as PanelLayer;
    const h = (during.moved!.x - during.down!.x) * normal.x + (during.moved!.y - during.down!.y) * normal.y;
    for (let j = 0; j < geometry.length; j++) closePoint(panel.geometry[j], j === i || j === (i + 1) % geometry.length ? { x: geometry[j].x + h * normal.x, y: geometry[j].y + h * normal.y } : geometry[j]);
    expect(during.captions).toContain(`h ${h.toFixed(1)} px · 边角 ${(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI).toFixed(1)}°`);
    expect(during.project).toEqual(before.project); expect(during.history).toEqual(before.history); expect(during.render.mainDraws).toBe(0); assertCover(during.preview!, ids.panel, ids.image); await assertCommitUndo(page, before);
  }
});

test('a tangential edge drag makes no document step and cancelling or accepting the mode prompt has the requested constraint behavior', async ({ page }) => {
  const ids = await fixture(page, rectangle, false, true); await page.getByRole('button', { name: '几何', exact: true }).click(); const before = await state(page);
  const during = await dragPreview(page, ids.panel, { x: 240, y: 80 }, { x: 240, y: 110 });
  expect((during.preview!.layers[ids.panel] as PanelLayer).geometry).toEqual(rectangle); await page.mouse.up(); const tangent = await state(page); expect(tangent.project).toEqual(before.project); expect(tangent.history).toEqual(before.history);
  await page.getByLabel('平行四边形约束').check(); const constrained = await state(page);
  page.once('dialog', (dialog) => void dialog.dismiss()); await dragPreview(page, ids.panel, { x: 240, y: 80 }, { x: 260, y: 80 }); await page.mouse.up();
  const rejected = await state(page); expect(rejected.constraint).toBe('parallelogram'); expect(rejected.project).toEqual(constrained.project); expect(rejected.history).toEqual(constrained.history);
  page.once('dialog', (dialog) => void dialog.accept()); const accepted = await dragPreview(page, ids.panel, { x: 240, y: 80 }, { x: 260, y: 80 }); expect(accepted.constraint).toBe('freeConvex'); expect(accepted.render.mainDraws).toBe(0); await assertCommitUndo(page, constrained);
});
