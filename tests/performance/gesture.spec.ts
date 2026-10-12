import { test, expect } from '@playwright/test';
import os from 'node:os';
import { createLayer, createProject } from '../../src/domain/factories';

test('50-panel drag reports frame work without main-layer redraw', async ({ page, browser }) => {
  const project = createProject();
  const pageId = project.pageOrder[0];
  for (let i = 0; i < 49; i++) {
    const panel = createLayer('panel', pageId);
    panel.matrix = [1, 0, 0, 1, (i % 7) * 330, Math.floor(i / 7) * 290];
    project.layers[panel.id] = panel;
    project.pages[pageId].roots.push(panel.id);
  }
  const target = createLayer('panel', pageId);
  target.matrix = [1, 0, 0, 1, project.pages[pageId].width / 2 - 300, project.pages[pageId].height / 2 - 200];
  project.layers[target.id] = target;
  project.pages[pageId].roots.push(target.id);
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'benchmark.Comia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'Comia', version: 1, project, blobs: [] })) });
  await expect(page.locator('.layer-row')).toHaveCount(50);
  const box = await page.locator('.canvas-viewport').boundingBox();
  expect(box).not.toBeNull();
  const cx = box!.x + box!.width / 2, cy = box!.y + box!.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 5, cy + 2);
  await page.waitForTimeout(80);
  await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').find((entry) => entry.name.includes('/src/state/runtimeStore.ts'))?.name;
    if (!path) throw new Error('运行时模块未加载');
    const mod = await import(path);
    mod.resetRenderStats();
    const samples: number[] = [];
    let lastEvent = 0;
    const root = document.querySelector('.canvas-viewport')!;
    const pointer = () => { lastEvent = performance.now(); };
    root.addEventListener('pointermove', pointer, true);
    const unsubscribe = mod.runtimeStore.subscribe((next: any, previous: any) => {
      if (next.renderStats.gestureDraws > previous.renderStats.gestureDraws && lastEvent > 0) {
        const inputTime = lastEvent;
        requestAnimationFrame(() => requestAnimationFrame(() => samples.push(performance.now() - inputTime)));
      }
    });
    (window as any).__gestureBenchmark = { samples, stop: () => { unsubscribe(); root.removeEventListener('pointermove', pointer, true); return mod.runtimeStore.getState().renderStats; } };
  });
  await page.mouse.move(cx + 60, cy + 20, { steps: 100 });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const result = await page.evaluate(() => {
    const benchmark = (window as any).__gestureBenchmark;
    const stats = benchmark.stop();
    const values = [...benchmark.samples].sort((a: number, b: number) => a - b);
    const pick = (p: number) => values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))];
    return { samples: values.length, p50: pick(0.5), p95: pick(0.95), max: values.at(-1), mainDraws: stats.mainDraws, gestureDraws: stats.gestureDraws, dpr: window.devicePixelRatio };
  });
  await page.mouse.up();
  expect(result.samples).toBeGreaterThan(0);
  expect(result.mainDraws).toBe(0);
  console.log(JSON.stringify({ kind: '50-panel-preview', browser: browser.version(), cpu: os.cpus()[0]?.model, ramGB: +(os.totalmem() / 2 ** 30).toFixed(1), os: `${os.platform()} ${os.release()}`, viewport: '1440x900', ...result }));
});
