import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import type { createBenchmark } from '../fixtures/benchmark/createBenchmark';

interface StressState {
  fixture: Awaited<ReturnType<typeof createBenchmark>>;
  copies: ImageBitmap[];
  surfaces: HTMLCanvasElement[];
  measurementSurfaces: Set<HTMLCanvasElement>;
  restore: () => void;
}
declare global { interface Window { __exportStress: StressState } }

test('twenty consecutive full lossless PDF exports release every real copy and canvas and retain bounded post-GC JavaScript memory', async ({ page, browser }) => {
  test.setTimeout(300_000); await page.goto('/');
  await page.evaluate(async () => {
    const { createBenchmark } = await import('/tests/fixtures/' + 'benchmark/createBenchmark.ts') as typeof import('../fixtures/benchmark/createBenchmark');
    const { replaceDocument } = await import('/src/' + 'history/commandBus.ts') as typeof import('../../src/history/commandBus');
    const { replaceRuntimeResources } = await import('/src/' + 'storage/blobRepository.ts') as typeof import('../../src/storage/blobRepository');
    const fixture = await createBenchmark(); replaceRuntimeResources(fixture.blobs, fixture.images);
    const result = replaceDocument(fixture.project); if (!result.ok) throw Error(result.problems[0].message);
    const bitmap = window.createImageBitmap, create = document.createElement;
    const state: StressState = { fixture, copies: [], surfaces: [], measurementSurfaces: new Set(), restore: () => { window.createImageBitmap = bitmap; document.createElement = create; } };
    window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => {
      const owned = new Error().stack?.includes('/src/export/exportFiles.ts');
      return (Reflect.apply(bitmap, window, args) as Promise<ImageBitmap>).then((copy) => { if (owned) state.copies.push(copy); return copy; });
    }) as typeof createImageBitmap;
    document.createElement = ((tag: string, options?: ElementCreationOptions) => {
      const node = create.call(document, tag, options);
      const stack = new Error().stack;
      if (node instanceof HTMLCanvasElement && stack?.includes('/src/export/exportFiles.ts')) {
        state.surfaces.push(node);
        if (stack.includes('/src/render/compileScene.ts')) state.measurementSurfaces.add(node);
      }
      return node;
    }) as typeof document.createElement;
    window.__exportStress = state;
  });
  const client = await page.context().newCDPSession(page);
  const runs: { ms: number; bytes: number; completed: number; copyCount: number; copiesClosed: boolean; surfaceCount: number; rasterSurfaceCount: number; measurementSurfaceCount: number; surfacesReleased: boolean; usedHeap: number; backingStorage: number | null; error: string | null }[] = [];
  let originalWidths: number[] = [];
  try {
    for (let round = 0; round < 20; round++) {
      const result = await page.evaluate(async () => {
        const { exportPdf } = await import('/src/' + 'export/exportFiles.ts') as typeof import('../../src/export/exportFiles');
        const state = window.__exportStress;
        let completed = 0; const started = performance.now();
        const result = await exportPdf(state.fixture.project, state.fixture.images, undefined, { scale: 1, onProgress: (progress) => { if (progress.phase === 'encode') completed = progress.completed; } });
        const evidence = { ms: performance.now() - started, bytes: result.ok ? result.value.size : 0, completed,
          copyCount: state.copies.length, copiesClosed: state.copies.every((copy) => copy.width === 0 && copy.height === 0),
          surfaceCount: state.surfaces.length, surfacesReleased: state.surfaces.every((surface) => surface.width === 0 && surface.height === 0), error: result.ok ? null : result.problems[0].message };
        const classified = { ...evidence, rasterSurfaceCount: state.surfaces.length - state.measurementSurfaces.size, measurementSurfaceCount: state.measurementSurfaces.size };
        // Do not create observer-induced memory growth by retaining closed native wrappers.
        state.copies = []; state.surfaces = []; state.measurementSurfaces.clear(); return classified;
      });
      await client.send('HeapProfiler.collectGarbage');
      const heap = await client.send('Runtime.getHeapUsage');
      runs.push({ ...result, usedHeap: heap.usedSize, backingStorage: heap.backingStorageSize ?? null });
      if (result.error) break;
    }
    originalWidths = await page.evaluate(async () => {
      const { replaceDocument } = await import('/src/' + 'history/commandBus.ts') as typeof import('../../src/history/commandBus');
      const { createProject } = await import('/src/' + 'domain/factories.ts') as typeof import('../../src/domain/factories');
      const { replaceRuntimeResources } = await import('/src/' + 'storage/blobRepository.ts') as typeof import('../../src/storage/blobRepository');
      const state = window.__exportStress;
      const result = replaceDocument(createProject()); if (!result.ok) throw Error(result.problems[0].message);
      replaceRuntimeResources(new Map(), new Map());
      return [...state.fixture.images.values()].map((bitmap) => bitmap.width);
    });
  } finally { await page.evaluate(() => window.__exportStress.restore()); }
  const report = { condition: '[待确认] Q11 条件性结果', browser: browser.version(), cpu: os.cpus()[0]?.model, ramGB: +(os.totalmem() / 2 ** 30).toFixed(1), os: `${os.platform()} ${os.release()}`, dpr: await page.evaluate(() => devicePixelRatio), pages: 20, layersPerPage: 50, scale: 1,
    memoryScope: 'Actual CDP post-forced-GC JavaScript heap and backing-store endpoints, not process/GPU peaks; round 1 is cold-layout warmup', warmGrowthBudgetBytes: 8 * 1024 * 1024, runs, originalWidths };
  await mkdir('output/performance', { recursive: true }); await writeFile('output/performance/export-stress-dpr1.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  expect(runs).toHaveLength(20);
  for (const run of runs) { expect(run.error).toBeNull(); expect(run.completed).toBe(20); expect(run.copyCount).toBe(8); expect(run.copiesClosed).toBe(true); expect(run.rasterSurfaceCount).toBe(40); expect(run.measurementSurfaceCount).toBe(20); expect(run.surfaceCount).toBe(60); expect(run.surfacesReleased).toBe(true); expect(run.bytes).toBe(runs[0].bytes); expect(run.ms).toBeLessThan(10000); }
  expect(originalWidths).toEqual(Array(8).fill(0)); // No leaked export owner may keep old source bitmaps alive.
  const warm = runs.slice(1);
  expect(warm.some((run, index) => index > 0 && run.usedHeap < warm[index - 1].usedHeap), 'Warm post-GC heap must not grow monotonically on all rounds').toBe(true);
  expect(warm.at(-1)!.usedHeap - Math.min(...warm.map((run) => run.usedHeap))).toBeLessThanOrEqual(report.warmGrowthBudgetBytes);
});
