import { menuCommand } from './menuHelpers';
import { expect, test, type Page } from '@playwright/test';
import type { Project } from '../../src/domain/types';
import type { DocumentStoreState } from '../../src/state/documentStore';

async function state(page: Page) {
  return page.evaluate(async () => {
    const { getDocument } = await import('/src/' + 'state/documentStore.ts');
    const { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts');
    const { apply, worldMatrix } = await import('/src/' + 'geometry/matrix.ts');
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const doc = getDocument() as DocumentStoreState, session = sessionStore.getState(), runtime = runtimeStore.getState();
    const preview = runtime.previewProject as Project | null;
    const centers = Object.fromEntries(Object.values(doc.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter((layer) => layer.type === 'panel').map((layer) => [layer.id, apply(worldMatrix(doc.project, layer.id), { x: 60, y: 40 })]));
    const previewCenters = preview ? Object.fromEntries(Object.values(preview.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter((layer) => layer.type === 'panel').map((layer) => [layer.id, apply(worldMatrix(preview, layer.id), { x: 60, y: 40 })])) : null;
    return { ...doc, session, render: runtime.renderStats, centers, previewCenters, preview: runtime.previewProject };
  });
}
async function fixture(page: Page) {
  await page.goto('/');
  await expect.poll(() => page.evaluate(async () => {
    const { getProject } = await import('/src/' + 'state/documentStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    return Boolean(getProject().pages[sessionStore.getState().activePageId]);
  })).toBe(true);
  return page.evaluate(async () => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts'), { replaceDocument } = await import('/src/' + 'history/commandBus.ts'); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const { multiply, rotationRad, translation } = await import('/src/' + 'geometry/matrix.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const project = createProject(), pageId = project.pageOrder[0]; project.pages[pageId].width = 800; project.pages[pageId].height = 600;
    const groups = [createLayer('group', pageId), createLayer('group', pageId)], panels = [createLayer('panel', pageId), createLayer('panel', pageId)];
    if (groups.some((layer) => layer.type !== 'group') || panels.some((layer) => layer.type !== 'panel')) throw Error('fixture');
    groups[0].matrix = multiply(translation(120, 160), multiply(rotationRad(37 * Math.PI / 180), [1.3, 0, .2, .8, 0, 0]));
    groups[1].matrix = multiply(translation(450, 260), multiply(rotationRad(-29 * Math.PI / 180), [.75, 0, -.15, 1.2, 0, 0]));
    for (let i = 0; i < 2; i++) {
      const group = groups[i], panel = panels[i]; if (group.type !== 'group' || panel.type !== 'panel') throw Error('fixture');
      panel.name = `子分镜${i + 1}`; panel.geometry = [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 80 }, { x: 0, y: 80 }];
      panel.parentId = group.id; panel.matrix = translation(20, 10); group.children = [panel.id]; project.layers[group.id] = group; project.layers[panel.id] = panel;
    }
    project.pages[pageId].roots = [...project.pages[pageId].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...(groups.map((layer) => layer.id))];
    const result = replaceDocument(numberFixture(project)); if (!result.ok) throw Error(JSON.stringify(result.problems));
    sessionStore.setState({ activePageId: pageId, selection: [], scopeId: null, expanded: groups.map((layer) => layer.id), viewportByPage: { [pageId]: { zoom: 1, pan: { x: 12, y: 12 } } } });
    return { panels: panels.map((layer) => layer.id), groups: groups.map((layer) => layer.id) };
  });
}
async function point(page: Page, p: { x: number; y: number }) {
  const rect = (await page.locator('.canvas-viewport').boundingBox())!, s = await state(page), vp = s.session.viewportByPage[s.session.activePageId];
  return { x: Math.round(rect.x + vp.pan.x + p.x * vp.zoom), y: Math.round(rect.y + vp.pan.y + p.y * vp.zoom) };
}

test('selected children in different rotated and sheared groups move by one page delta without changing parents or spacing', async ({ page }) => {
  const ids = await fixture(page);
  await page.locator(`[data-layer-id="${ids.panels[0]}"] .layer-name`).click();
  await page.locator(`[data-layer-id="${ids.panels[1]}"] .layer-name`).click({ modifiers: ['Control'] });
  const before = await state(page); expect(before.session.selection).toEqual(ids.panels);
  const start = await point(page, before.centers[ids.panels[0]]);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.keyboard.down('Alt');
  await page.mouse.move(start.x + 10, start.y + 10);
  await expect.poll(async () => Boolean((await state(page)).preview)).toBe(true);
  await page.evaluate(async () => (await import('/src/' + 'state/runtimeStore.ts')).resetRenderStats());
  await page.mouse.move(start.x + 73, start.y - 41, { steps: 16 });
  const during = await state(page); expect(during.project).toEqual(before.project); expect(during.history).toEqual(before.history); expect(during.render.mainDraws).toBe(0);
  for (const id of ids.panels) {
    expect(during.previewCenters![id].x - before.centers[id].x).toBeCloseTo(73, 5);
    expect(during.previewCenters![id].y - before.centers[id].y).toBeCloseTo(-41, 5);
  }
  await page.mouse.up(); await page.keyboard.up('Alt'); const after = await state(page);
  expect(after.history.past).toHaveLength(before.history.past.length + 1); expect(after.session.selection).toEqual(ids.panels);
  for (const id of ids.groups) expect(after.project.layers[id]).toEqual(before.project.layers[id]);
  for (const id of ids.panels) { expect(after.project.layers[id].parentId).toBe(before.project.layers[id].parentId); expect(after.project.layers[id].matrix.slice(0, 4)).toEqual(before.project.layers[id].matrix.slice(0, 4)); }
  expect(after.centers[ids.panels[1]].x - after.centers[ids.panels[0]].x).toBeCloseTo(before.centers[ids.panels[1]].x - before.centers[ids.panels[0]].x, 6);
  expect(after.centers[ids.panels[1]].y - after.centers[ids.panels[0]].y).toBeCloseTo(before.centers[ids.panels[1]].y - before.centers[ids.panels[0]].y, 6);
  await page.keyboard.press('Control+z'); expect((await state(page)).project).toEqual(before.project);
  await page.keyboard.press('Control+Shift+z'); expect((await state(page)).project).toEqual(after.project);
});

test('negative parent position applies from the actual inspector, rejects empty input and survives undo redo without clamping', async ({ page }) => {
  const ids = await fixture(page); await page.locator(`[data-layer-id="${ids.groups[0]}"] .layer-name`).click();
  const before = await state(page), input = page.getByLabel('对象X', { exact: true });
  await input.fill('-20'); await input.press('Enter'); await expect(input).toHaveValue('-20');
  const after = await state(page); expect(after.project.layers[ids.groups[0]].matrix[4]).toBe(-20); expect(after.history.past).toHaveLength(before.history.past.length + 1);
  // Geometry extends across the page edge, rather than merely displaying a negative form value.
  expect(after.centers[ids.panels[0]].x).toBeLessThan(before.centers[ids.panels[0]].x);
  const groupMatrix = after.project.layers[ids.groups[0]].matrix, childMatrix = after.project.layers[ids.panels[0]].matrix;
  expect(groupMatrix[0] * childMatrix[4] + groupMatrix[2] * childMatrix[5] + groupMatrix[4]).toBeLessThan(0);
  await input.fill(''); await input.press('Tab'); await expect(input).toHaveValue('-20'); await expect(page.getByText('X必须是有效数字', { exact: true })).toBeVisible(); expect((await state(page)).history).toEqual(after.history);
  await (await menuCommand(page, '撤销')).click(); expect((await state(page)).project).toEqual(before.project);
  await (await menuCommand(page, '重做')).click(); expect((await state(page)).project).toEqual(after.project);
});

test('selecting a group together with its child moves that child once and keeps the other rotated parent unchanged', async ({ page }) => {
  const ids = await fixture(page);
  await page.locator(`[data-layer-id="${ids.groups[0]}"] .layer-name`).click();
  await page.locator(`[data-layer-id="${ids.panels[0]}"] .layer-name`).click({ modifiers: ['Control'] });
  const before = await state(page), start = await point(page, before.centers[ids.panels[0]]);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.keyboard.down('Alt'); await page.mouse.move(start.x + 47, start.y + 23, { steps: 12 }); await page.mouse.up(); await page.keyboard.up('Alt');
  const after = await state(page);
  expect(after.centers[ids.panels[0]].x - before.centers[ids.panels[0]].x).toBeCloseTo(47, 5);
  expect(after.centers[ids.panels[0]].y - before.centers[ids.panels[0]].y).toBeCloseTo(23, 5);
  expect(after.project.layers[ids.panels[0]]).toEqual(before.project.layers[ids.panels[0]]);
  expect(after.project.layers[ids.groups[1]]).toEqual(before.project.layers[ids.groups[1]]);
  expect(after.project.layers[ids.panels[1]]).toEqual(before.project.layers[ids.panels[1]]);
  expect(after.history.past).toHaveLength(before.history.past.length + 1);
  await page.keyboard.press('Control+z'); expect((await state(page)).project).toEqual(before.project);
});

test('a selected child below a locked ancestor prevents the entire cross-group move and leaves no preview or history', async ({ page }) => {
  const ids = await fixture(page);
  await page.locator(`[data-layer-id="${ids.panels[0]}"] .layer-name`).click();
  await page.locator(`[data-layer-id="${ids.panels[1]}"] .layer-name`).click({ modifiers: ['Control'] });
  await page.locator(`[data-layer-id="${ids.groups[1]}"]`).locator('button[aria-label="锁定"]:not(.layer-row[data-layer-type="pageBackground"] button)').click();
  const before = await state(page), start = await point(page, before.centers[ids.panels[0]]);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 71, start.y + 39, { steps: 12 }); await page.mouse.up();
  const after = await state(page); expect(after.project).toEqual(before.project); expect(after.history).toEqual(before.history); expect(after.preview).toBeNull();
  await expect(page.getByText('选区包含有效锁定图层，不能整体变换', { exact: true })).toBeVisible();
});

test('a frontmost unselected object remains the hit target instead of a selected child behind it', async ({ page }) => {
  const ids = await fixture(page);
  const coverId = await page.evaluate(async (childId) => {
    const { createLayer } = await import('/src/' + 'domain/factories.ts'), { execute } = await import('/src/' + 'history/commandBus.ts');
    const { getProject } = await import('/src/' + 'state/documentStore.ts'), { worldMatrix } = await import('/src/' + 'geometry/matrix.ts');
    const project = getProject(), pageId = project.pageOrder[0], cover = createLayer('panel', pageId); if (cover.type !== 'panel') throw Error('fixture');
    cover.geometry = structuredClone((project.layers[childId] as typeof cover).geometry); cover.matrix = worldMatrix(project, childId); cover.name = '上方遮挡';
    const result = execute({ label: '测试真实遮挡对象', context: { pageId, selection: [] }, mutate(draft: Project) { draft.layers[cover.id] = cover; draft.pages[pageId].roots.push(cover.id); } });
    if (!result.ok) throw Error(JSON.stringify(result.problems)); return cover.id;
  }, ids.panels[0]);
  await page.locator(`[data-layer-id="${ids.panels[0]}"] .layer-name`).click();
  await page.locator(`[data-layer-id="${ids.panels[1]}"] .layer-name`).click({ modifiers: ['Control'] });
  const before = await state(page), start = await point(page, before.centers[ids.panels[0]]);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.keyboard.down('Alt'); await page.mouse.move(start.x + 59, start.y + 31, { steps: 12 }); await page.mouse.up(); await page.keyboard.up('Alt');
  const after = await state(page); expect(after.session.selection).toEqual([coverId]);
  for (const id of [...ids.panels, ...ids.groups]) expect(after.project.layers[id]).toEqual(before.project.layers[id]);
  expect(after.project.layers[coverId].matrix[4] - before.project.layers[coverId].matrix[4]).toBeCloseTo(59, 5);
  expect(after.history.past).toHaveLength(before.history.past.length + 1);
});
