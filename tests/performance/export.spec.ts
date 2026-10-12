import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

interface PdfClickBenchmark {
  start: number | null; end: number | null; bytes: number; trusted: boolean;
  heapBefore: number | null; heapAfter: number | null; restore: () => void;
}
declare global { interface Window { __pdfClickBenchmark: PdfClickBenchmark } }

test('20-page 50-mixed-layer PDF benchmark records all five complete lossless exports', async ({ page, browser }) => {
  test.setTimeout(300_000); await page.goto('/');
  const meta = await page.evaluate(async () => {
    const { createBenchmark } = await import('/tests/fixtures/' + 'benchmark/createBenchmark.ts') as typeof import('../fixtures/benchmark/createBenchmark');
    const { replaceDocument } = await import('/src/' + 'history/commandBus.ts') as typeof import('../../src/history/commandBus');
    const { replaceRuntimeResources } = await import('/src/' + 'storage/blobRepository.ts') as typeof import('../../src/storage/blobRepository');
    const fixture = await createBenchmark(); replaceRuntimeResources(fixture.blobs, fixture.images);
    const result = replaceDocument(fixture.project); if (!result.ok) throw Error(result.problems[0].message);
    const heap = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
    const original = URL.createObjectURL;
    const click = (event: MouseEvent) => {
      const button = (event.target as Element).closest('button');
      if (event.isTrusted && button?.closest('.top-actions') && button.textContent?.trim() === 'PDF') {
        state.start = performance.now(); state.end = null; state.bytes = 0; state.trusted = true; state.heapBefore = heap();
      }
    };
    const state: PdfClickBenchmark = { start: null, end: null, bytes: 0, trusted: false, heapBefore: null, heapAfter: null,
      restore: () => { URL.createObjectURL = original; document.removeEventListener('click', click, true); } };
    document.addEventListener('click', click, true);
    URL.createObjectURL = (object) => {
      const url = original.call(URL, object);
      if (object instanceof Blob && object.type === 'application/pdf' && state.start !== null) { state.end = performance.now(); state.bytes = object.size; state.heapAfter = heap(); }
      return url;
    };
    window.__pdfClickBenchmark = state;
    return { readyFontWaitMs: fixture.readyFontWaitMs, pages: fixture.project.pageOrder.length, layers: Object.keys(fixture.project.layers).length, assets: Object.keys(fixture.project.assets).length, textCodePoints: fixture.textCodePoints, dpr: devicePixelRatio };
  });
  const runs: { ms: number; bytes: number; completed: number; trusted: boolean; heapBefore: number | null; heapAfter: number | null }[] = [];
  await mkdir('output/performance', { recursive: true });
  try {
    for (let index = 0; index < 5; index++) {
      const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'PDF', exact: true }).click();
      const download = await pending;
      const sample = await page.evaluate(() => {
        const state = window.__pdfClickBenchmark;
        if (state.start === null || state.end === null) throw Error('Actual native click and downloadable PDF Blob markers missing');
        return { ms: state.end - state.start, bytes: state.bytes, trusted: state.trusted, heapBefore: state.heapBefore, heapAfter: state.heapAfter };
      });
      // Parsing/downloading is outside the recorded click to Blob-ready interval.
      const path = (await download.path())!;
      const completed = Number(execFileSync('python', ['-c', 'import fitz,sys; d=fitz.open(sys.argv[1]); print(len(d)); d.close()', path], { encoding: 'utf8' }).trim());
      runs.push({ ...sample, completed });
      if (index === 0 || index === 4) await download.saveAs(`output/performance/mixed-pdf-${index === 0 ? 'first' : 'last'}.pdf`);
      await expect(page.getByRole('button', { name: 'PDF', exact: true })).toBeEnabled();
    }
  } finally { await page.evaluate(() => window.__pdfClickBenchmark.restore()); }
  const result = { kind: '20-page-mixed-PDF', timing: 'Trusted native PDF button click to real PDF Blob object URL creation; includes EditorShell snapshot, UI progress and exporter; excludes disk transfer and parser', condition: '[待确认] Q11 条件性结果', cpu: os.cpus()[0]?.model, ramGB: +(os.totalmem() / 2 ** 30).toFixed(1), os: `${os.platform()} ${os.release()}`, browser: browser.version(), viewport: '1440x900', fixtures: '8 deterministic real 1600x1200 PNGs, 4 with transparent holes; same hashes reused across pages', ...meta, runs };
  await writeFile(`output/performance/mixed-pdf-dpr${meta.dpr}.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  expect(meta.pages).toBe(20); expect(meta.layers).toBe(1000); expect(meta.assets).toBe(8); expect(meta.textCodePoints).toBe(200);
  expect(runs).toHaveLength(5); for (const run of runs) { expect(run.completed).toBe(20); expect(run.trusted).toBe(true); expect(run.bytes).toBeGreaterThan(10000); }
  expect(runs.filter((run) => run.ms >= 10000), 'Every actual UI export must finish within 10s; all samples are saved even on failure').toEqual([]);
});
