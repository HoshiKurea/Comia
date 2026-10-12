import { menuCommand } from './menuHelpers';
import { expect, test } from '@playwright/test';

test('a real horizontal free-corner drag makes a trapezoid with one parallel pair while the other three corners stay fixed', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.library-item').first()).toBeVisible();
  const setup = await page.evaluate(async () => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts'), { replaceDocument } = await import('/src/' + 'history/commandBus.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts'); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const project = createProject(), pageId = project.pageOrder[0], panel = createLayer('panel', pageId);
    Object.assign(project.pages[pageId], { width: 800, height: 600 }); panel.matrix = [1, 0, 0, 1, 100, 100]; panel.geometry = [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 160 }, { x: 0, y: 160 }];
    project.layers[panel.id] = panel; project.pages[pageId].roots = [...project.pages[pageId].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...([panel.id])]; const result = replaceDocument(numberFixture(project)); if (!result.ok) throw Error(JSON.stringify(result));
    sessionStore.setState({ activePageId: pageId, selection: [panel.id], toolMode: 'geometry', geometryConstraint: 'freeConvex', viewportByPage: { [pageId]: { zoom: 1, pan: { x: 16, y: 16 } } }, snap16: false });
    return { id: panel.id, geometry: panel.geometry };
  });
  const root = (await page.locator('.canvas-viewport').boundingBox())!;
  await page.mouse.move(root.x + 116, root.y + 116); await page.mouse.down(); await page.mouse.move(root.x + 96, root.y + 116, { steps: 8 }); await page.mouse.up();
  const geometry = await page.evaluate(async (id) => { const { getProject } = await import('/src/' + 'state/documentStore.ts'); const panel = getProject().layers[id]; if (panel.type !== 'panel') throw Error('panel'); return panel.geometry; }, setup.id);
  expect(geometry).toEqual([{ x: -20, y: 0 }, ...setup.geometry.slice(1)]);
  const edge = (i: number) => ({ x: geometry[(i + 1) % 4].x - geometry[i].x, y: geometry[(i + 1) % 4].y - geometry[i].y });
  const cross = (a: ReturnType<typeof edge>, b: ReturnType<typeof edge>) => a.x * b.y - a.y * b.x;
  expect(cross(edge(0), edge(2))).toBe(0); expect(cross(edge(1), edge(3))).not.toBe(0);
  await (await menuCommand(page, '撤销')).click();
  expect(await page.evaluate(async (id) => { const { getProject } = await import('/src/' + 'state/documentStore.ts'); return (getProject().layers[id] as any).geometry; }, setup.id)).toEqual(setup.geometry);
});
