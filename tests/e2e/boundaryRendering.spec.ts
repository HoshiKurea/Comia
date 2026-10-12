import { expect, test } from '@playwright/test';
import type { Project } from '../../src/domain/types';

test('a tiny rotated panel with a maximum thick border keeps its entire stroke inside the actual layer thumbnail', async ({ page }) => {
  await page.goto('/');
  const id = await page.evaluate(async () => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts'), { replaceDocument } = await import('/src/' + 'history/commandBus.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts'); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const { multiply, rotationRad, translation } = await import('/src/' + 'geometry/matrix.ts');
    const project = createProject({ background: false }), pageId = project.pageOrder[0], panel = createLayer('panel', pageId);
    panel.geometry = [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 16 }, { x: 0, y: 16 }];
    panel.style.borderWidth = 128; panel.style.fill = '#FFFFFF00'; panel.matrix = multiply(translation(400, 400), rotationRad(37 * Math.PI / 180));
    project.layers[panel.id] = panel; project.pages[pageId].roots = [...project.pages[pageId].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...([panel.id])]; const result = replaceDocument(numberFixture(project)); if (!result.ok) throw Error(JSON.stringify(result.problems));
    sessionStore.setState({ activePageId: pageId, selection: [panel.id], scopeId: null }); return panel.id;
  });
  const icon = page.locator(`[data-layer-id="${id}"] .layer-thumbnail`); await expect(icon).toHaveAttribute('data-paint-count', /^[1-9]\d*$/);
  const result = await icon.evaluate((element) => {
    const canvas = element as HTMLCanvasElement, rgba = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let borderPixels = 0, visible = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (rgba[(y * canvas.width + x) * 4 + 3]) {
      visible++; if (x === 0 || y === 0 || x === canvas.width - 1 || y === canvas.height - 1) borderPixels++;
    }
    return { borderPixels, visible };
  });
  expect(result.borderPixels).toBe(0); expect(result.visible).toBeGreaterThan(20);
});

test('rotated curved outlines and protruding tails survive thumbnail fitting and static gesture cache without clipping pixels', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts'), { replaceDocument } = await import('/src/' + 'history/commandBus.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts'); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const { multiply, rotationRad, translation } = await import('/src/' + 'geometry/matrix.ts'), { drawPage } = await import('/src/' + 'render/drawScene.ts');
    const { beginGestureRuns, drawGestureRuns, disposeGestureRuns } = await import('/src/' + 'render/gestureRuns.ts');
    const project = createProject({ background: false }) as Project, pageId = project.pageOrder[0]; Object.assign(project.pages[pageId], { width: 800, height: 600 });
    const bubble = createLayer('bubble', pageId), ellipse = createLayer('bubble', pageId), moving = createLayer('panel', pageId);
    project.schemaVersion=5; bubble.tail = { kind: 'line', attachU: .6, baseWidth: 24, tip: { x: 460, y: 230 } }; bubble.width = 180; bubble.height = 100; bubble.style.borderWidth = 32;
    bubble.matrix = multiply(translation(380, 80), multiply(rotationRad(37 * Math.PI / 180), [1, 0, .3, .75, 0, 0]));
    ellipse.shape = 'circle'; ellipse.width = ellipse.height = 100; ellipse.style.borderWidth = 32; ellipse.matrix = multiply(translation(90, 370), rotationRad(-29 * Math.PI / 180));
    moving.geometry = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }]; moving.matrix = translation(500, 400);
    for (const layer of [bubble, ellipse, moving]) project.layers[layer.id] = layer; project.pages[pageId].roots = [...project.pages[pageId].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...([bubble.id, moving.id, ellipse.id])];
    const replaced = replaceDocument(numberFixture(project)); if (!replaced.ok) throw Error(JSON.stringify(replaced.problems)); sessionStore.setState({ activePageId: pageId, selection: [moving.id], scopeId: null });
    const surface = () => { const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600; return canvas; };
    const normal = surface(), replay = surface(); drawPage(normal.getContext('2d')!, project, pageId, new Map());
    const cache = beginGestureRuns(project, pageId, [moving.id], { zoom: 1, pan: { x: 0, y: 0 } }, { width: 800, height: 600 }, new Map());
    const actualCaches = cache.runs.filter((run: any) => run.kind === 'static' && run.canvas).length;
    drawGestureRuns(replay.getContext('2d')!, cache, project, new Map()); disposeGestureRuns(cache);
    // Compare both surfaces through the same lossless PNG decode boundary,
    // matching the production file/thumbnail tests. Firefox's unpremultiply
    // path can otherwise expose +/-1 RGB for equal low-alpha canvas pixels.
    const pixels = async (canvas: HTMLCanvasElement) => {
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
      const bitmap = await createImageBitmap(blob), decoded = surface(); decoded.getContext('2d')!.drawImage(bitmap, 0, 0); bitmap.close();
      const bytes = decoded.getContext('2d')!.getImageData(0, 0, 800, 600).data; decoded.width = decoded.height = 0; return bytes;
    };
    const a = await pixels(normal), b = await pixels(replay);
    let different = 0; const diagnostic = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { different++; if (diagnostic.length < 20) diagnostic.push({ x: Math.floor(i / 4) % 800, y: Math.floor(i / 3200), channel: i % 4, direct: a[i], cached: b[i] }); }
    normal.width = normal.height = replay.width = replay.height = 0;
    return { different, diagnostic, actualCaches, ids: [bubble.id, ellipse.id] };
  });
  expect(result.different, JSON.stringify(result.diagnostic)).toBe(0); expect(result.actualCaches).toBe(2);
  for (const id of result.ids) {
    const clipped = await page.locator(`[data-layer-id="${id}"] .layer-thumbnail`).evaluate((element) => {
      const canvas = element as HTMLCanvasElement, bytes = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let edge = 0, total = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (bytes[(y * canvas.width + x) * 4 + 3]) { total++; if (x === 0 || y === 0 || x === canvas.width - 1 || y === canvas.height - 1) edge++; }
      return { edge, total };
    });
    expect(clipped.edge).toBe(0); expect(clipped.total).toBeGreaterThan(10);
  }
});

test('rounded-path snap boundaries follow rendered curve extrema rather than polygon corners and an empty group shows no handles', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts'), { replaceDocument } = await import('/src/' + 'history/commandBus.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts'); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const { multiply, rotationRad, translation, apply } = await import('/src/' + 'geometry/matrix.ts'), { drawPage } = await import('/src/' + 'render/drawScene.ts');
    const { layerWorldBounds, localLayerBounds } = await import('/src/' + 'interaction/layerBounds.ts'), { collectMoveSnap } = await import('/src/' + 'interaction/snap.ts');
    const project = createProject({ background: false }), pageId = project.pageOrder[0]; Object.assign(project.pages[pageId], { width: 800, height: 600 });
    const panel = createLayer('panel', pageId), moving = createLayer('panel', pageId), empty = createLayer('group', pageId);
    panel.geometry = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 120 }, { x: 0, y: 120 }]; panel.style.borderRadius = 55; panel.style.borderWidth = 0; panel.style.fill = '#FFFFFFFF'; panel.matrix = multiply(translation(320, 160), rotationRad(37 * Math.PI / 180));
    moving.matrix = translation(50, 450); moving.geometry = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }];
    for (const layer of [panel, moving, empty]) project.layers[layer.id] = layer; project.pages[pageId].roots = [...project.pages[pageId].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...([panel.id, moving.id, empty.id])];
    const bounds = layerWorldBounds(project, panel.id), snap = collectMoveSnap(project, pageId, [moving.id]);
    const candidate = snap.candidates.find((value: any) => value.sourceId === panel.id && value.axis === 'x' && value.kind === 'edge' && value.value === bounds.x);
    // Sample raster extrema at 4x to resolve subpixel curve tips; retain the
    // original one-page-pixel bound instead of treating a sparse 1x raster as
    // the exact continuous geometry.
    const canvas = document.createElement('canvas'); canvas.width = 3200; canvas.height = 2400; canvas.getContext('2d')!.scale(4, 4); drawPage(canvas.getContext('2d')!, project, pageId, new Map(), [panel.id], false);
    const rgba = canvas.getContext('2d')!.getImageData(0, 0, 3200, 2400).data; let minX = 800, minY = 600, maxX = -1, maxY = -1;
    for (let y = 0; y < 2400; y++) for (let x = 0; x < 3200; x++) if (rgba[(y * 3200 + x) * 4 + 3]) { minX = Math.min(minX, x / 4); minY = Math.min(minY, y / 4); maxX = Math.max(maxX, (x + 1) / 4); maxY = Math.max(maxY, (y + 1) / 4); }
    const polygonMin = Math.min(...panel.geometry.map((p: any) => apply(panel.matrix, p).x)); canvas.width = canvas.height = 0;
    const replaced = replaceDocument(numberFixture(project)); if (!replaced.ok) throw Error(JSON.stringify(replaced.problems)); sessionStore.setState({ activePageId: pageId, selection: [empty.id], scopeId: null, showPanelNumbers: false });
    return { bounds, candidate: candidate?.value, raster: { minX, minY, maxX, maxY }, polygonMin, empty: localLayerBounds(project, empty.id) };
  });
  expect(result.candidate).toBe(result.bounds.x); expect(result.bounds.x - result.polygonMin).toBeGreaterThan(5);
  expect(Math.abs(result.bounds.x - result.raster.minX)).toBeLessThanOrEqual(1);
  expect(Math.abs(result.bounds.y - result.raster.minY)).toBeLessThanOrEqual(1);
  expect(Math.abs(result.bounds.x + result.bounds.width - result.raster.maxX)).toBeLessThanOrEqual(1);
  expect(Math.abs(result.bounds.y + result.bounds.height - result.raster.maxY)).toBeLessThanOrEqual(1);
  expect(result.empty).toBeNull(); await expect(page.getByLabel('对象宽')).toHaveCount(0);
  // Four layers: main, gesture, component creation, then controls.
  const overlayPixels = await page.locator('.konvajs-content canvas').nth(3).evaluate((element) => { const canvas = element as HTMLCanvasElement; return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.some((value) => value !== 0); });
  expect(overlayPixels).toBe(false);
});
