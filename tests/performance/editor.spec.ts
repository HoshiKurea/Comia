import { expect, test, type Page, type Browser } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';

// rAF/batchDraw can merge pointer events. Keep the same motion and sending
// mode, with enough native inputs to measure >=100 distinct updated frames.
const INPUT_STEPS = 180;

async function measureEditor(page: Page, browser: Browser, nested: boolean) {
  test.setTimeout(120_000); await page.goto('/');
  await page.evaluate(async (nested) => {
    const { createBenchmark } = await import('/tests/fixtures/' + 'benchmark/createBenchmark.ts');
    const { replaceDocument } = await import('/src/' + 'history/commandBus.ts');
    const { replaceRuntimeResources } = await import('/src/' + 'storage/blobRepository.ts');
    const fixture = await createBenchmark(nested); (window as any).__mixedFixture = fixture;
    replaceRuntimeResources(fixture.blobs, fixture.images); const result = replaceDocument(fixture.project); if (!result.ok) throw Error(result.problems[0].message);
  }, nested);
  await expect(page.locator('.layer-row')).toHaveCount(nested ? 30 : 34); // Owned children stay collapsed; project still has 50 layers/page.
  const client = await page.context().newCDPSession(page);
  await client.send('Tracing.start', { categories: 'devtools.timeline,cc,benchmark,viz,blink.user_timing', transferMode: 'ReturnAsStream' });
  const reports: any[] = [];
  for (const kind of ['drag', 'resize', 'skew', 'crop']) {
    const point = await page.evaluate(async (kind) => {
      const { sessionStore, setSelection } = await import('/src/' + 'state/sessionStore.ts');
      const { getDocument } = await import('/src/' + 'state/documentStore.ts');
      const { fitPage } = await import('/src/' + 'interaction/viewport.ts');
      const { worldMatrix, apply } = await import('/src/' + 'geometry/matrix.ts');
      const { beginCropEdit } = await import('/src/' + 'images/cropController.ts');
      const fixture = (window as any).__mixedFixture, first = fixture.targets[0];
      // The crop toolbar covers the top row; exercise the lower-row real panel without hiding UI.
      const lower = Object.values(fixture.project.layers).find((layer: any) => layer.type === 'panel' && layer.pageId === first.pageId && worldMatrix(fixture.project, layer.id)[5] > 1000) as any;
      const target = kind === 'crop' ? { ...first, panelId: lower.id, imageId: lower.children[0] } : first;
      const root = document.querySelector('.canvas-viewport')!, rect = root.getBoundingClientRect();
      const vp = fitPage(fixture.project.pages[target.pageId], { x: rect.width, y: rect.height });
      setSelection([target.panelId]); sessionStore.setState({ toolMode: kind === 'skew' ? 'geometry' : 'select', geometryConstraint: kind === 'skew' ? 'parallelogram' : 'freeConvex', viewportByPage: { [target.pageId]: vp } });
      if (kind === 'crop') { const result = beginCropEdit(target.panelId, target.imageId); if (!result.ok) throw Error(result.problems[0].message); }
      const local = kind === 'resize' ? { x: 490, y: 620 } : kind === 'skew' ? { x: 490, y: 0 } : { x: 245, y: 310 };
      const point = apply(worldMatrix(fixture.project, target.panelId), local);
      return { x: rect.x + vp.pan.x + point.x * vp.zoom, y: rect.y + vp.pan.y + point.y * vp.zoom, history: getDocument().history.past.length };
    }, kind);
    await page.waitForTimeout(400); await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.mouse.move(point.x + 5, point.y + 2); await page.waitForTimeout(100);
    expect(await page.evaluate(async () => { const { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts'); return runtimeStore.getState().gestureActive; }), `${kind} must be an active real gesture before measurement`).toBe(true);
    await page.evaluate(async (kind) => {
      const { runtimeStore, resetRenderStats } = await import('/src/' + 'state/runtimeStore.ts'); resetRenderStats();
      const root = document.querySelector('.canvas-viewport')!, samples: any[] = [], pending = new Set<number>(); let serial = 0, input = 0;
      const move = (event: Event) => { input = performance.now(); serial++; performance.mark(`comia-${kind}-input-${serial}`, { detail: { timestamp: event.timeStamp } }); };
      root.addEventListener('pointermove', move, true);
      const off = runtimeStore.subscribe((next: any, previous: any) => {
        if (next.renderStats.gestureDraws <= previous.renderStats.gestureDraws || !serial || pending.has(serial)) return;
        const id = serial, start = input; pending.add(id);
        requestAnimationFrame(() => requestAnimationFrame(() => { performance.mark(`comia-${kind}-complete-${id}`); samples.push({ input: id, inputMs: start, completedMs: performance.now(), ms: performance.now() - start }); }));
      });
      (window as any).__mixedProbe = { stop: () => { off(); root.removeEventListener('pointermove', move, true); return { kind, inputs: serial, samples, render: runtimeStore.getState().renderStats }; } };
    }, kind);
    await page.mouse.move(point.x + 36, point.y + 9, { steps: INPUT_STEPS });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
    const report = await page.evaluate(() => (window as any).__mixedProbe.stop()); reports.push(report);
    await page.keyboard.press('Escape'); await page.mouse.up();
    expect(await page.evaluate(async () => { const { getDocument } = await import('/src/' + 'state/documentStore.ts'); return getDocument().history.past.length; })).toBe(point.history);
  }
  const completed = new Promise<any>((resolve) => client.once('Tracing.tracingComplete', resolve)); await client.send('Tracing.end');
  const { stream } = await completed; let raw = '';
  for (;;) { const chunk = await client.send('IO.read', { handle: stream }); raw += chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString('utf8') : chunk.data; if (chunk.eof) break; }
  await client.send('IO.close', { handle: stream }); const trace = JSON.parse(raw);
  const names = [...new Set<string>(trace.traceEvents.filter((event: any) => /Paint|DrawFrame|SubmitCompositorFrame|DrawAndSwap/.test(event.name)).map((event: any) => event.name))];
  const result = { condition: '[待确认] Q11 条件性结果', nested, inputSteps: INPUT_STEPS, browser: browser.version(), cpu: os.cpus()[0]?.model, ramGB: +(os.totalmem() / 2 ** 30).toFixed(1), os: `${os.platform()} ${os.release()}`, viewport: '1440x900', dpr: await page.evaluate(() => devicePixelRatio), pages: 20, layersPerPage: 50, timing: 'pointer event receipt → two rAF completion; approximation, accompanied by actual browser paint/compositor trace', traceEventNames: names,
    reports: reports.map((report) => { const sorted = report.samples.map((sample: any) => sample.ms).sort((a: number, b: number) => a - b); const pick = (p: number) => sorted[Math.floor((sorted.length - 1) * p)]; return { ...report, count: sorted.length, p50: pick(.5), p95: pick(.95), max: sorted.at(-1) }; }) };
  await mkdir('output/performance', { recursive: true }); await writeFile(`output/performance/mixed-editor-dpr${result.dpr}${nested ? '-nested' : ''}.trace.json`, raw); await writeFile(`output/performance/mixed-editor-dpr${result.dpr}${nested ? '-nested' : ''}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, reports: result.reports.map(({ samples, ...report }) => report) }));
  expect(names.some((name) => name.includes('Paint'))).toBe(true); expect(names.some((name) => /DrawFrame|SubmitCompositorFrame|DrawAndSwap/.test(name))).toBe(true);
  for (const report of result.reports) { expect(report.inputs).toBe(INPUT_STEPS); expect(report.count).toBeGreaterThanOrEqual(100); expect(report.render.mainDraws).toBe(0); expect(report.max, `${report.kind}: all samples must be <100ms`).toBeLessThan(100); }
}

test('20-page mixed editor reports every drag, resize, skew and crop sample with compositor trace', async ({ page, browser }) => measureEditor(page, browser, false));
test('20-page equal-count nested editor reports every drag, resize, skew and crop sample with compositor trace', async ({ page, browser }) => measureEditor(page, browser, true));
