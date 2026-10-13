import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import type { BubbleLayer, ImageLayer } from '../../src/domain/types';
import { initHandBubble } from './handBubbleHelpers';
test('120 real brush inputs preserve main artwork and history on 20 detailed bubbles with dialogue and a covering image', async ({ page }) => {
  test.setTimeout(90000); await initHandBubble(page);
  const id = await page.evaluate(async () => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts'), { newId } = await import('/src/' + 'domain/id.ts');
    const p = createProject({ background: false }), pid = p.pageOrder[0], ids: string[] = []; Object.assign(p.pages[pid], { width: 1024, height: 768, dpi: 72 });
    for (let i = 0; i < 20; i++) {
      const b = createLayer('bubble', pid) as BubbleLayer; b.shape = 'freehand'; b.width = 96; b.height = 64; b.matrix = [1, 0, 0, 1, 50 + i % 4 * 210, 60 + Math.floor(i / 4) * 125]; b.style.borderWidth = 2;
      b.freehandSource = { version: 2, width: 96, height: 64, baseRing: Array.from({ length: 1000 }, (_, j) => ({ x: 48 + 38 * Math.cos(j / 1000 * Math.PI * 2), y: 32 + 24 * Math.sin(j / 1000 * Math.PI * 2) })), edits: [], ink: Array.from({ length: 20 }, (_, j) => ({ id: newId(), tool: 'pen', color: '#AA000080', opacity: .5, width: 1, pressureMode: 'fixed', points: Array.from({ length: 100 }, (_, k) => ({ x: 12 + k / 99 * 70, y: 7 + j * 2.5, pressure: .5, dt: k })) })) };
      p.layers[b.id] = b; p.pages[pid].roots.push(b.id); ids.push(b.id);
    }
    const c = document.createElement('canvas'); c.width = c.height = 32; const ctx = c.getContext('2d')!; ctx.fillStyle = '#00FF0080'; ctx.fillRect(0, 0, 32, 32);
    const blob = await new Promise<Blob>(resolve => c.toBlob(b => resolve(b!), 'image/png')), decoded = await (await import('/src/' + 'assets/importImage.ts')).decodeImage(new File([blob], 'cover.png', { type: 'image/png' }), new AbortController().signal); if (!decoded.ok) throw Error(JSON.stringify(decoded));
    const asset = decoded.value; p.assets[asset.meta.id] = asset.meta; const image = createLayer('image', pid) as ImageLayer; image.assetId = asset.meta.id; image.width = image.height = 32; image.matrix = [1, 0, 0, 1, 92, 80]; p.layers[image.id] = image; p.pages[pid].roots.push(image.id);
    const replaced = (await import('/src/' + 'history/commandBus.ts')).replaceDocument(p); if (!replaced.ok) throw Error(JSON.stringify(replaced));
    (await import('/src/' + 'storage/blobRepository.ts')).replaceRuntimeResources(new Map([[asset.meta.originalHash, asset.original], [asset.meta.renderHash, asset.render]]), new Map([[asset.meta.renderHash, asset.bitmap]]));
    const group = (await import('/src/' + 'bubbles/dialogueCommands.ts')).createDialogue(ids.slice(-2), 'connector'); if (!group.ok) throw Error(JSON.stringify(group));
    (await import('/src/' + 'state/sessionStore.ts')).sessionStore.setState({ selection: [ids[0]], viewportByPage: { [pid]: { zoom: .9, pan: { x: 20, y: 20 } } } }); return ids[0];
  });
  await page.getByRole('button', { name: '画细节', exact: true }).click();
  const v = await page.evaluate(async () => { const s = (await import('/src/' + 'state/sessionStore.ts')).sessionStore.getState(), r = document.querySelector('.canvas-viewport')!.getBoundingClientRect(); return { ...s.viewportByPage[s.activePageId], x: r.x, y: r.y }; });
  const point = (x: number, y: number) => ({ x: v.x + v.pan.x + x * v.zoom, y: v.y + v.pan.y + y * v.zoom });
  const start = point(108, 92); await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.evaluate(async () => { (await import('/src/' + 'freehand/metrics.ts')).resetDrawingMetrics(); (await import('/src/' + 'state/runtimeStore.ts')).resetRenderStats(); (window as any).__handBaseline = (await import('/src/' + 'state/documentStore.ts')).getDocument(); });
  for (let i = 1; i <= 120; i++) { const q = point(98 + 10 * Math.cos(i / 120 * Math.PI * 2), 92 + 8 * Math.sin(i / 120 * Math.PI * 2)); await page.mouse.move(q.x, q.y); await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))) }
  const result = await page.evaluate(async id => { const { drawingMetrics } = await import('/src/' + 'freehand/metrics.ts'), d = (await import('/src/' + 'state/documentStore.ts')).getDocument(), baseline = (window as any).__handBaseline, runtime = (await import('/src/' + 'state/runtimeStore.ts')).runtimeStore.getState(), stats = (await import('/src/' + 'bubbles/inkPaint.ts')).bubbleInkCacheStats(), draft = (await import('/src/' + 'bubbles/brushController.ts')).currentBubbleBrush()!; return { id, inputs: [...drawingMetrics.inputs], frames: [...drawingMetrics.frames], stable: d.project === baseline.project && d.history.stateId === baseline.history.stateId, mainDraws: runtime.renderStats.mainDraws, gestureDraws: runtime.renderStats.gestureDraws, cache: stats, dpr: devicePixelRatio, ua: navigator.userAgent, previewInk: (draft.preview.layers[id] as BubbleLayer).freehandSource!.version === 2 }; }, id);
  await page.mouse.up(); const commits = await page.evaluate(async () => [...(await import('/src/' + 'freehand/metrics.ts')).drawingMetrics.commits]);
  const p95 = (v: number[]) => v.slice().sort((a, b) => a - b)[Math.ceil(v.length * .95) - 1]; await mkdir('output/hand-bubble', { recursive: true });
  await writeFile(`output/hand-bubble/performance-dpr${result.dpr}.json`, JSON.stringify({ ...result, commits, p95: { input: p95(result.inputs), preview: p95(result.frames) }, scene: '20 bubbles; 1000 contour points and 20x100-point detail strokes each; connector dialogue and real alpha PNG above target; 1024x768 page; 1440x900 viewport; 120 trusted moves', metric: 'JS input and gesture renderer duration, excludes IPC and GPU presentation', device: { os: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0].model, memoryBytes: os.totalmem() } }, null, 2));
  expect(result.inputs.length).toBeGreaterThanOrEqual(100); expect(result.frames.length).toBeGreaterThanOrEqual(100); expect(result.stable).toBe(true); expect(result.mainDraws).toBe(0); expect(result.cache.bytes).toBeLessThanOrEqual(result.cache.limit); expect(result.previewInk).toBe(true); expect(commits).toHaveLength(1);
});
