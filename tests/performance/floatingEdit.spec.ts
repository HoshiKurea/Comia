import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Project } from '../../src/domain/types';

test('100 trusted floating-window moves preserve 50 panels and history without canvas redraw', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.canvas-viewport')).toBeVisible();
  await page.evaluate(async () => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts'), { execute, replaceDocument } = await import('/src/' + 'history/commandBus.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const p = createProject(), pageId = p.pageOrder[0]; const replaced = replaceDocument(p); if (!replaced.ok) throw Error(JSON.stringify(replaced));
    const made = execute({ label: '性能场景50分镜', context: { pageId, selection: [] }, mutate(d: Project) { for (let i = 0; i < 50; i++) { const panel = createLayer('panel', pageId); if (panel.type !== 'panel') throw Error('panel'); panel.geometry = [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 160 }, { x: 0, y: 160 }]; panel.matrix = [1, 0, 0, 1, 20 + i % 5 * 170, 20 + Math.floor(i / 5) * 180]; d.layers[panel.id] = panel; d.pages[pageId].roots.push(panel.id); } } }); if (!made.ok) throw Error(JSON.stringify(made));
    sessionStore.setState({ viewportByPage: { [pageId]: { zoom: .4, pan: { x: 20, y: 20 } } } }); await document.fonts.ready;
  });
  await page.getByRole('button', { name: '多边形分格', exact: true }).click();
  const handle = page.getByRole('button', { name: '移动分格修正浮窗' }), box = (await handle.boundingBox())!;
  const before = await page.evaluate(async () => { const d = (await import('/src/' + 'state/documentStore.ts')).getDocument(); return { project: d.project, history: d.history.past.length }; });
  await page.mouse.move(box.x + 30, box.y + box.height / 2); await page.mouse.down();
  await page.evaluate(async () => {
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))); (await import('/src/' + 'state/runtimeStore.ts')).resetRenderStats();
    const data: { samples: number[]; trusted: number; pending: number | null; transforms: string[]; longTasks: { start: number; duration: number }[] } = { samples: [], trusted: 0, pending: null, transforms: [], longTasks: [] };
    new PerformanceObserver(list => { for (const entry of list.getEntries()) data.longTasks.push({ start: entry.startTime, duration: entry.duration }); }).observe({ type: 'longtask', buffered: true });
    (window as any).__floatingPerformance = data;
    window.addEventListener('pointermove', e => { if (!e.isTrusted || !document.querySelector<HTMLElement>('.floating-edit-handle')?.hasPointerCapture(e.pointerId)) return; data.trusted++; const start = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => { data.samples.push(performance.now() - start); data.transforms.push((document.querySelector('.floating-edit-panel') as HTMLElement).style.transform); })); }, true);
  });
  for (let i = 0; i < 100; i++) {
    await page.mouse.move(box.x + 30 + 35 * Math.sin(i / 8), box.y + box.height / 2 + 30 + 18 * Math.cos(i / 8));
    await page.waitForFunction(count => (window as any).__floatingPerformance.samples.length === count, i + 1);
  }
  const result = await page.evaluate(async () => { const data = (window as any).__floatingPerformance, d = (await import('/src/' + 'state/documentStore.ts')).getDocument(), stats = (await import('/src/' + 'state/runtimeStore.ts')).runtimeStore.getState().renderStats; return { ...data, project: d.project, history: d.history.past.length, stats, userAgent: navigator.userAgent, platform: navigator.platform, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: (navigator as any).deviceMemory, dpr: devicePixelRatio }; });
  await page.mouse.up();
  const sorted = [...result.samples].sort((a, b) => a - b), maximum = Math.max(...sorted);
  await mkdir('output/audit/floating-performance', { recursive: true });
  await writeFile(`output/audit/floating-performance/dpr${result.dpr}.json`, JSON.stringify({ ...result, project: undefined, scene: '50 independent panels; polygon editor floating window; 1440x900; zoom .4; 100 trusted mouse moves', metric: 'trusted pointermove capture schedules both rAF callbacks inside the browser; no per-sample automation RPC in timing; does not measure scanout', p50: sorted[49], p95: sorted[94], maximum }, null, 2));
  await page.screenshot({ path: `output/playwright/floating-edit-dpr${result.dpr}.png` });
  expect(result.project).toEqual(before.project); expect(result.history).toBe(before.history); expect(result.trusted).toBe(100); expect(result.samples).toHaveLength(100); expect(new Set(result.transforms).size).toBeGreaterThan(90); expect(result.stats.mainDraws).toBe(0); expect(result.stats.gestureDraws).toBe(0);
  expect(maximum).toBeLessThan(100);
  await page.getByRole('button', { name: '取消分格' }).click();
});
