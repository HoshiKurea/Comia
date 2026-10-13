import { expect, type Page } from '@playwright/test';
export async function initHandBubble(page: Page) {
  await page.goto('/'); await expect(page.getByRole('toolbar', { name: '绘图工具' })).toBeVisible();
  await page.evaluate(async () => {
    const brush=await import('/src/'+'bubbles/brushController.ts'),defaults=await import('/src/'+'bubbles/brushOptions.ts');brush.setBubbleBrushOptions({...defaults.DEFAULT_BUBBLE_BRUSH,pen:{stabilization:0,postCorrection:0,sharpCorners:true,pressure:false}});
    const p = (await import('/src/' + 'domain/factories.ts')).createProject({ background: false }), pid = p.pageOrder[0]; Object.assign(p.pages[pid], { width: 640, height: 480, dpi: 72 });
    const r = (await import('/src/' + 'history/commandBus.ts')).replaceDocument(p); if (!r.ok) throw Error(JSON.stringify(r));
    (await import('/src/' + 'state/sessionStore.ts')).sessionStore.setState({ activePageId: pid, selection: [], scopeId: null, toolMode: 'select', snap16: false, viewportByPage: { [pid]: { zoom: 1, pan: { x: 20, y: 20 } } } });
  });
}
export const handArc = (cx = 200, cy = 170, radius = 100) => Array.from({ length: 91 }, (_, i) => ({ x: cx + radius * Math.cos(i / 120 * 2 * Math.PI), y: cy + radius * .7 * Math.sin(i / 120 * 2 * Math.PI) }));
export async function canvasInk(page: Page, points: { x: number; y: number }[]) {
  const v = await page.evaluate(async () => { const s = (await import('/src/' + 'state/sessionStore.ts')).sessionStore.getState(), b = document.querySelector('.canvas-viewport')!.getBoundingClientRect(); return { ...s.viewportByPage[s.activePageId], left: b.left, top: b.top }; });
  const first = points[0]; await page.mouse.move(v.left + v.pan.x + first.x * v.zoom, v.top + v.pan.y + first.y * v.zoom); await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(v.left + v.pan.x + p.x * v.zoom, v.top + v.pan.y + p.y * v.zoom); await page.mouse.up();
}
export async function handState(page: Page) { return page.evaluate(async () => { const d = (await import('/src/' + 'state/documentStore.ts')).getDocument(), s = (await import('/src/' + 'state/sessionStore.ts')).sessionStore.getState(); return { project: d.project, past: d.history.past.length, selection: s.selection, mode: s.toolMode }; }); }
export async function scenePixel(page: Page, x: number, y: number) { return page.evaluate(async ({ x, y }) => { const p = (await import('/src/' + 'state/documentStore.ts')).getProject(), c = document.createElement('canvas'); c.width = p.pages[p.pageOrder[0]].width; c.height = p.pages[p.pageOrder[0]].height; (await import('/src/' + 'render/drawScene.ts')).drawPage(c.getContext('2d')!, p, p.pageOrder[0], (await import('/src/' + 'state/runtimeStore.ts')).runtimeStore.getState().images); return [...c.getContext('2d')!.getImageData(x, y, 1, 1).data]; }, { x, y }); }
