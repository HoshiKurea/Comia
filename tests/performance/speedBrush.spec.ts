import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Project } from '../../src/domain/types';
import type { RuntimeStoreState } from '../../src/state/runtimeStore';
import { parkFloatingControls } from '../e2e/floatingHelpers';

test('100 trusted brush inputs with 50 panels redraw only preview and commit a single transaction', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.canvas-viewport')).toBeVisible();
  await page.evaluate(async () => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts'), { execute, replaceDocument } = await import('/src/' + 'history/commandBus.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const p = createProject(), id = p.pageOrder[0]; Object.assign(p.pages[id], { width: 900, height: 700 }); if (!replaceDocument(p).ok) throw Error('fixture');
    const r = execute({ label: '50分镜场景', context: { pageId: id, selection: [] }, mutate(d: Project) {
      for (let i = 0; i < 50; i++) { const panel = createLayer('panel', id); if (panel.type !== 'panel') throw Error('panel'); panel.geometry = [{ x: 0, y: 0 }, { x: 140, y: 0 }, { x: 140, y: 55 }, { x: 0, y: 55 }]; panel.matrix = [1,0,0,1,20+i%5*170,20+Math.floor(i/5)*65]; d.layers[panel.id] = panel; d.pages[id].roots.push(panel.id); }
    } }); if (!r.ok) throw Error(JSON.stringify(r)); sessionStore.setState({ viewportByPage: { [id]: { zoom: 1, pan: { x: 10, y: 10 } } }, scopeId: null }); await document.fonts.ready;
  });
  await page.getByRole('button', { name: '速度线笔刷', exact: true }).click(); await parkFloatingControls(page);
  await page.getByLabel('笔刷密度', { exact: true }).fill('24'); await page.getByLabel('笔刷密度', { exact: true }).press('Enter');
  const box = (await page.locator('.canvas-viewport').boundingBox())!;
  const before = await page.evaluate(async () => { const d = (await import('/src/' + 'state/documentStore.ts')).getDocument(); return { project: d.project, history: d.history.past.length }; });
  await page.mouse.move(box.x + 160, box.y + 240); await page.mouse.down();
  await page.evaluate(async () => {
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const { runtimeStore, resetRenderStats } = await import('/src/' + 'state/runtimeStore.ts'); resetRenderStats();
    const data: { samples: number[]; twoRaf: number[]; trusted: number; pending: number | null; longTasks: { start: number; duration: number }[] } = { samples: [], twoRaf: [], trusted: 0, pending: null, longTasks: [] };
    (window as any).__brushPerformance = data;
    const observer = new PerformanceObserver(list => { for (const e of list.getEntries()) data.longTasks.push({ start: e.startTime, duration: e.duration }); }); observer.observe({ type: 'longtask', buffered: true });
    const off = runtimeStore.subscribe((s: RuntimeStoreState, old: RuntimeStoreState) => { if (s.renderStats.gestureDraws > old.renderStats.gestureDraws && data.pending !== null) { data.samples.push(performance.now() - data.pending); data.pending = null; } });
    const listener = (e: PointerEvent) => {
      if (!e.isTrusted || !document.querySelector('.speed-brush-surface')?.hasPointerCapture(e.pointerId)) return;
      data.trusted++; const start = performance.now(); data.pending = start;
      requestAnimationFrame(() => requestAnimationFrame(() => { data.twoRaf.push(performance.now() - start); }));
    }; window.addEventListener('pointermove', listener, true);
    (window as any).__stopBrushPerformance = () => { off(); observer.disconnect(); window.removeEventListener('pointermove', listener, true); };
  });
  for (let i = 0; i < 100; i++) {
    await page.mouse.move(box.x + 164 + i * 4, box.y + 240 + 40 * Math.sin(i / 25));
    await page.waitForFunction(n => (window as any).__brushPerformance.samples.length === n && (window as any).__brushPerformance.twoRaf.length === n, i + 1);
  }
  const result = await page.evaluate(async () => {
    (window as any).__stopBrushPerformance(); const { getDocument } = await import('/src/' + 'state/documentStore.ts'), { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts'), { currentSpeedStroke } = await import('/src/' + 'library/speedBrushController.ts');
    const stroke = currentSpeedStroke(), d = getDocument(); return { ...(window as any).__brushPerformance, project: d.project, history: d.history.past.length, stats: runtimeStore.getState().renderStats, points: stroke?.layer.spec.kind === 'speed-brush' ? stroke.layer.spec.ribbons.reduce((n: number,r: {x:number;y:number}[]) => n+r.length,0) : 0, userAgent: navigator.userAgent, platform: navigator.platform, dpr: devicePixelRatio, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: (navigator as any).deviceMemory };
  });
  await page.mouse.up();
  const after = await page.evaluate(async () => { const d = (await import('/src/' + 'state/documentStore.ts')).getDocument(); return { history: d.history.past.length, brushCount: Object.values((d.project as Project).layers).filter(l => l.type === 'decoration' && l.spec.kind === 'speed-brush').length }; });
  const sorted = [...result.samples].sort((a,b) => a-b), maximum = Math.max(...sorted), rafMaximum = Math.max(...result.twoRaf);
  await mkdir('output/audit/brush-performance', { recursive: true });
  await writeFile(`output/audit/brush-performance/straight-dpr${result.dpr}.json`, JSON.stringify({ ...result, project: undefined, after, scene: '50 independent panels; 24 parallel straight tracks; radius64; 1440x900; zoom1; 100 trusted mouse inputs along a curved pointer path', metric: 'native pointermove capture to actual Canvas preview draw completion; two-rAF approximation also recorded; no automation RPC in either timing; excludes GPU scanout', p50: sorted[49], p95: sorted[94], maximum, rafMaximum }, null, 2));
  await page.screenshot({ path: `output/playwright/straight-speed-brush-dpr${result.dpr}.png` });
  expect(result.project).toEqual(before.project); expect(result.history).toBe(before.history); expect(result.trusted).toBe(100); expect(result.samples).toHaveLength(100); expect(result.twoRaf).toHaveLength(100);
  expect(result.stats.mainDraws).toBe(0); expect(result.stats.gestureDraws).toBeGreaterThanOrEqual(100); expect(result.points).toBeGreaterThan(5000); expect(after.history).toBe(before.history + 1); expect(after.brushCount).toBe(1);
  expect(maximum).toBeLessThan(100); expect(rafMaximum).toBeLessThan(100);
});
