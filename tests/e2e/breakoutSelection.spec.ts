import { expect, test, type Page } from '@playwright/test';
import type { ImageLayer, PanelLayer } from '../../src/domain/types';
import { menuCommand } from './menuHelpers';

async function setup(page: Page, mode: 'whole' | 'partial') {
  await page.goto('/');
  await expect(page.getByRole('toolbar', { name: '绘图工具' })).toBeVisible();
  return page.evaluate(async mode => {
    const { panelBindingScene } = await import('/tests/fixtures/' + 'panelBindingScene.ts');
    const { getProject } = await import('/src/' + 'state/documentStore.ts');
    const { replaceDocument } = await import('/src/' + 'history/commandBus.ts');
    const { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const f = await panelBindingScene(), project = structuredClone(getProject());
    const panel = project.layers[f.panelId] as PanelLayer, image = project.layers[f.imageId] as ImageLayer;
    // Use an independent leaf, as produced by the current panel creation tools.
    panel.parentId = null; panel.matrix = project.layers[f.outerId].matrix;
    project.pages[f.pageId].roots[0] = panel.id; delete project.layers[f.outerId];
    image.panelClip = mode === 'whole' ? { mode } : { mode, region: {
      shape: 'rect', geometry: [{ x: 0, y: 0 }, { x: 140, y: 0 }, { x: 140, y: 120 }, { x: 0, y: 120 }], matrix: [1, 0, 0, 1, 0, 0],
    } };
    const result = replaceDocument(project); if (!result.ok) throw Error(JSON.stringify(result));
    sessionStore.setState({ selection: [], snap16: false, viewportByPage: { [f.pageId]: { zoom: 1, pan: { x: 20, y: 20 } } } });
    return f;
  }, mode);
}

async function state(page: Page) {
  return page.evaluate(async () => {
    const { getDocument } = await import('/src/' + 'state/documentStore.ts');
    const { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const { worldMatrix } = await import('/src/' + 'geometry/matrix.ts');
    const d = getDocument();
    return { project: d.project, past: d.history.past.length, selection: sessionStore.getState().selection,
      worlds: Object.fromEntries(Object.keys(d.project.layers).map(id => [id, worldMatrix(d.project, id)])) };
  });
}

async function point(page: Page, x: number, y: number) {
  const b = (await page.getByRole('application', { name: '页面编辑画布' }).boundingBox())!;
  return { x: b.x + 20 + x, y: b.y + 20 + y };
}

for (const mode of ['partial', 'whole'] as const) test(`${mode} breakout overlap selects the panel and moves its material once with undo/redo`, async ({ page }) => {
  const f = await setup(page, mode), before = await state(page), p = await point(page, 150, 150);
  await page.mouse.click(p.x, p.y);
  expect((await state(page)).selection).toEqual([f.panelId]);
  expect((await state(page)).project).toEqual(before.project);
  for (let attempt = 0; attempt < 2; attempt++) {
    // Both a fresh overlap drag and dragging the already-selected panel must work.
    await page.evaluate(async ids => (await import('/src/' + 'state/sessionStore.ts')).sessionStore.setState({ selection: ids }), attempt === 0 ? [] : [f.panelId]);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.keyboard.down('Alt'); // Disable snapping after the target has been chosen.
    await page.mouse.move(p.x + 24, p.y + 18, { steps: 8 });
    expect((await state(page)).project).toEqual(before.project);
    await page.mouse.up(); await page.keyboard.up('Alt');
    const moved = await state(page);
    expect(moved.selection).toEqual([f.panelId]);
    expect(moved.past).toBe(before.past + 1);
    expect(moved.project.layers[f.panelId].matrix).toEqual([1, 0, 0, 1, 124, 118]);
    expect(moved.project.layers[f.imageId]).toEqual(before.project.layers[f.imageId]);
    expect(moved.worlds[f.imageId]).toEqual([1, 0, 0, 1, 74, 68]);
    await (await menuCommand(page, '撤销')).click();
    expect((await state(page)).project).toEqual(before.project);
    await (await menuCommand(page, '重做')).click();
    expect((await state(page)).project).toEqual(moved.project);
    await (await menuCommand(page, '撤销')).click();
  }
});

test('partial breakout still supports Alt material picking, selected-image dragging and direct picking outside the panel', async ({ page }) => {
  const f = await setup(page, 'partial'), p = await point(page, 150, 150), before = await state(page);
  await page.keyboard.down('Alt'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Alt');
  expect((await state(page)).selection).toEqual([f.imageId]);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.keyboard.down('Alt');
  await page.mouse.move(p.x + 12, p.y + 9, { steps: 8 }); await page.mouse.up(); await page.keyboard.up('Alt');
  const moved = await state(page);
  expect(moved.selection).toEqual([f.imageId]);
  expect(moved.project.layers[f.panelId]).toEqual(before.project.layers[f.panelId]);
  expect(moved.project.layers[f.imageId].matrix).toEqual([1, 0, 0, 1, -38, -41]);
  expect((moved.project.layers[f.imageId] as ImageLayer).panelClip).toEqual((before.project.layers[f.imageId] as ImageLayer).panelClip);
  expect(moved.past).toBe(before.past + 1);
  await (await menuCommand(page, '撤销')).click();
  expect((await state(page)).project).toEqual(before.project);
  await page.evaluate(async () => (await import('/src/' + 'state/sessionStore.ts')).sessionStore.setState({ selection: [] }));
  const outside = await point(page, 80, 150); await page.mouse.click(outside.x, outside.y);
  expect((await state(page)).selection).toEqual([f.imageId]);
});

test('breakout point selection follows the transformed panel path, material mask and topmost branch', async ({ page }) => {
  const f = await setup(page, 'partial');
  const result = await page.evaluate(async f => {
    const { getProject } = await import('/src/' + 'state/documentStore.ts');
    const { hitLayer, hitVisibleImage } = await import('/src/' + 'render/drawScene.ts');
    const { apply, worldMatrix } = await import('/src/' + 'geometry/matrix.ts');
    const project = structuredClone(getProject()), panel = project.layers[f.panelId] as PanelLayer, image = project.layers[f.imageId] as ImageLayer;
    panel.matrix = [1, .2, -.1, 1, 100, 100]; panel.style.borderRadius = 25;
    const at = (x: number, y: number) => apply(worldMatrix(project, panel.id), { x, y });
    const inside = hitLayer(project, f.pageId, at(50, 50));
    const material = hitVisibleImage(project, f.pageId, at(50, 50));
    const roundedCorner = hitLayer(project, f.pageId, at(1, 1));
    // Concave notch is outside the actual panel but inside its bounding rectangle.
    panel.style.borderRadius = 0; panel.geometryMode = 'simple';
    panel.geometry = [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 120 }, { x: 80, y: 120 }, { x: 80, y: 35 }, { x: 40, y: 35 }, { x: 40, y: 120 }, { x: 0, y: 120 }];
    const notch = hitLayer(project, f.pageId, at(60, 50));
    image.mask = { enabled: true, linked: true, shape: 'rect', geometry: [{ x: 80, y: 0 }, { x: 320, y: 0 }, { x: 320, y: 240 }, { x: 80, y: 240 }], matrix: [1, 0, 0, 1, 0, 0] };
    const masked = hitLayer(project, f.pageId, at(-20, 50));
    const upper = project.layers[f.upperId] as PanelLayer;
    upper.matrix = panel.matrix; upper.geometry = [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 120 }, { x: 0, y: 120 }];
    const neighbor = hitLayer(project, f.pageId, at(50, 50)); upper.visible = false;
    delete image.mask;
    image.locked = true;
    const lockedInside = hitLayer(project, f.pageId, at(20, 20)), lockedOutside = hitLayer(project, f.pageId, at(-20, 50));
    image.locked = false; image.visible = false;
    const hiddenInside = hitLayer(project, f.pageId, at(20, 20)), hiddenOutside = hitLayer(project, f.pageId, at(-20, 50));
    return { inside, material, roundedCorner, notch, masked, neighbor, lockedInside, lockedOutside, hiddenInside, hiddenOutside };
  }, f);
  expect(result).toEqual({ inside: f.panelId, material: f.imageId, roundedCorner: f.imageId, notch: f.imageId, masked: null,
    neighbor: f.upperId, lockedInside: f.panelId, lockedOutside: null, hiddenInside: f.panelId, hiddenOutside: null });
});
