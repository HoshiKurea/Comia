import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';

test('256-point contour correction keeps mixed nested content in independent preview for every measured input', async ({ page, browser }) => {
  test.setTimeout(120_000); await page.goto('/');
  const target = await page.evaluate(async () => {
    const { createBenchmark } = await import('/tests/fixtures/' + 'benchmark/createBenchmark.ts') as typeof import('../fixtures/benchmark/createBenchmark');
    const { replaceRuntimeResources } = await import('/src/' + 'storage/blobRepository.ts') as typeof import('../../src/storage/blobRepository');
    const { replaceDocument } = await import('/src/' + 'history/commandBus.ts') as typeof import('../../src/history/commandBus');
    const { sessionStore } = await import('/src/' + 'state/sessionStore.ts') as typeof import('../../src/state/sessionStore');
    const { worldMatrix, apply } = await import('/src/' + 'geometry/matrix.ts') as typeof import('../../src/geometry/matrix');
    const fixture = await createBenchmark(true), first = fixture.targets[0], panel = fixture.project.layers[first.panelId];
    if (panel.type !== 'panel') throw Error('panel required'); panel.geometryMode = 'simple'; panel.style.borderRadius = 0;
    panel.geometry = Array.from({ length: 256 }, (_, i) => { const angle = i * Math.PI / 128, r = i % 2 ? .96 : 1; return { x: 245 + 220 * r * Math.cos(angle), y: 310 + 270 * r * Math.sin(angle) }; });
    // Fit the selected contour large enough to operate every point while retaining all 50 layers/page.
    const vp = { zoom: 1, pan: { x: -40, y: -40 } };
    replaceRuntimeResources(fixture.blobs, fixture.images); const r = replaceDocument(fixture.project); if (!r.ok) throw Error(JSON.stringify(r.problems));
    sessionStore.setState({ selection: [panel.id], viewportByPage: { [first.pageId]: vp } });
    const rect = document.querySelector('.canvas-viewport')!.getBoundingClientRect(), p = apply(worldMatrix(fixture.project, panel.id), panel.geometry[0]);
    return { x: rect.x + vp.pan.x + p.x, y: rect.y + vp.pan.y + p.y, id: panel.id, original: structuredClone(fixture.project) };
  });
  await page.getByRole('button', { name: '修正分格轮廓' }).click(); await expect(page.locator('.panel-contour-point')).toHaveCount(256);
  await page.mouse.move(target.x, target.y); await page.mouse.down(); await page.mouse.move(target.x - 1, target.y); await page.waitForTimeout(100);
  const client = await page.context().newCDPSession(page);
  await client.send('Tracing.start', { categories: 'devtools.timeline,cc,benchmark,viz,blink.user_timing', transferMode: 'ReturnAsStream' });
  await page.evaluate(async () => {
    const { runtimeStore, resetRenderStats } = await import('/src/' + 'state/runtimeStore.ts') as typeof import('../../src/state/runtimeStore');
    resetRenderStats(); const samples: { input: number; ms: number }[] = [], pending = new Set<number>(); let serial = 0, start = 0;
    const move = () => { serial++; start = performance.now(); performance.mark(`contour-input-${serial}`); };
    const root = document.querySelector('.canvas-viewport')!; root.addEventListener('pointermove', move, true);
    const off = runtimeStore.subscribe((s, old) => {
      if (s.renderStats.gestureDraws <= old.renderStats.gestureDraws || !serial || pending.has(serial)) return;
      const input = serial, at = start; pending.add(input);
      requestAnimationFrame(() => requestAnimationFrame(() => { performance.mark(`contour-complete-${input}`); samples.push({ input, ms: performance.now() - at }); }));
    });
    (window as any).__contourProbe = { stop: () => { off(); root.removeEventListener('pointermove', move, true); return { inputs: serial, samples, render: runtimeStore.getState().renderStats }; } };
  });
  await page.mouse.move(target.x - 5, target.y + 1, { steps: 180 });
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r())))));
  const probe = await page.evaluate(() => (window as any).__contourProbe.stop()); await page.mouse.up();
  const state = await page.evaluate(async () => {
    const { currentDrawing } = await import('/src/' + 'panels/drawingController.ts') as typeof import('../../src/panels/drawingController');
    const { getDocument } = await import('/src/' + 'state/documentStore.ts') as typeof import('../../src/state/documentStore');
    return { error: currentDrawing()?.error, pointCount: currentDrawing()?.points.length, history: getDocument().history.past.length, project: getDocument().project };
  });
  const completed = new Promise<any>(r => client.once('Tracing.tracingComplete', r)); await client.send('Tracing.end'); const { stream } = await completed; let trace = '';
  for (;;) { const c = await client.send('IO.read', { handle: stream }); trace += c.base64Encoded ? Buffer.from(c.data, 'base64').toString('utf8') : c.data; if (c.eof) break; } await client.send('IO.close', { handle: stream });
  const names = [...new Set<string>(JSON.parse(trace).traceEvents.filter((e: any) => /Paint|DrawFrame|SubmitCompositorFrame|DrawAndSwap/.test(e.name)).map((e: any) => e.name))];
  const sorted = probe.samples.map((s: { ms: number }) => s.ms).sort((a: number, b: number) => a - b), dpr = await page.evaluate(() => devicePixelRatio);
  const result = { cpu: os.cpus()[0]?.model, ramGiB: +(os.totalmem() / 2 ** 30).toFixed(1), os: `${os.platform()} ${os.release()}`, browser: browser.version(), dpr, viewport: '1440x900', points: 256, pages: 20, layersPerPage: 50, assets: '8 actual 1600x1200 PNGs, 4 transparent; 200-codepoint text; 37°/-19° transformed ancestors', timing: 'trusted pointermove receipt → two rAF; presentation approximation, not physical scanout', ...probe, count: sorted.length, p95: sorted[Math.floor((sorted.length - 1) * .95)], max: sorted.at(-1), traceEventNames: names };
  await mkdir('output/performance', { recursive: true }); await writeFile(`output/performance/panel-contour-dpr${dpr}.json`, JSON.stringify(result, null, 2)); await writeFile(`output/performance/panel-contour-dpr${dpr}.trace.json`, trace);
  console.log(JSON.stringify({ ...result, samples: undefined }));
  expect(state.error).toBe(''); expect(state.pointCount).toBe(256); expect(state.history).toBe(0); expect(state.project).toEqual(target.original);
  expect(result.inputs).toBe(180); expect(result.count).toBeGreaterThanOrEqual(100); expect(result.render.mainDraws).toBe(0); expect(result.max).toBeLessThan(100);
  expect(names.some(n => n.includes('Paint'))).toBe(true); expect(names.some(n => /DrawFrame|SubmitCompositorFrame|DrawAndSwap/.test(n))).toBe(true);
  await page.keyboard.press('Escape'); expect(await page.evaluate(async () => (await import('/src/' + 'panels/drawingController.ts')).currentDrawing())).toBeNull();
});
