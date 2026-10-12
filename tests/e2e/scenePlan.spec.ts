import { expect, test } from '@playwright/test';

test('normal paint, gesture replay, page thumbnail and PNG export preserve nested clips, transparency and container paint order', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts');
    const { drawPage } = await import('/src/' + 'render/drawScene.ts');
    const { beginGestureRuns, drawGestureRuns, disposeGestureRuns } = await import('/src/' + 'render/gestureRuns.ts');
    const { scheduleThumbnail, subscribeThumbnailState, invalidatePage } = await import('/src/' + 'pages/thumbnails.ts');
    const { exportPng } = await import('/src/' + 'export/exportFiles.ts');
    const { decodeImage } = await import('/src/' + 'assets/importImage.ts');
    const { awaitFonts } = await import('/src/' + 'text/fonts.ts');
    const project = createProject({ background: false }), pageId = project.pageOrder[0]; Object.assign(project.pages[pageId], { width: 240, height: 180 });
    const source = document.createElement('canvas'); source.width = 60; source.height = 60; const sourceCtx = source.getContext('2d')!; sourceCtx.fillStyle = '#ff000080'; sourceCtx.fillRect(0, 0, 60, 60);
    const blob = await new Promise<Blob>((resolve) => source.toBlob((b) => resolve(b!), 'image/png'));
    const decoded = await decodeImage(new File([blob], 'semi-transparent.png', { type: 'image/png' }), new AbortController().signal); if (!decoded.ok) throw Error(decoded.problems[0].message);
    project.assets[decoded.value.meta.id] = decoded.value.meta; const images = new Map([[decoded.value.meta.renderHash, decoded.value.bitmap]]);
    const group = createLayer('group', pageId), outer = createLayer('panel', pageId), inner = createLayer('panel', pageId), image = createLayer('image', pageId), bubble = createLayer('bubble', pageId), text = createLayer('text', pageId), upper = createLayer('panel', pageId);
    group.children = [outer.id, bubble.id]; group.matrix = [1, .15, .08, 1, 35, 20];
    outer.parentId = group.id; outer.role = 'split'; outer.children = [inner.id]; outer.geometry = [{ x: 0, y: 0 }, { x: 140, y: 0 }, { x: 140, y: 115 }, { x: 0, y: 115 }]; outer.style = { borderRadius: 22, borderWidth: 2, borderColor: '#000000FF', fill: '#FFFFFF00' };
    inner.parentId = outer.id; inner.children = [image.id]; inner.matrix = [1, 0, 0, 1, -18, -14]; inner.geometry = [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 145, y: 125 }, { x: 30, y: 125 }]; inner.style = { borderRadius: 12, borderWidth: 0, borderColor: '#000000FF', fill: '#FFFFFF00' };
    image.parentId = inner.id; image.assetId = decoded.value.meta.id; image.width = 60; image.height = 60; image.crop = { focus: { u: .5, v: .5 }, zoom: 1.3 };
    bubble.parentId = group.id; bubble.width = 80; bubble.height = 60; bubble.shape = 'rect'; bubble.style = { fill: '#00FF00FF', borderWidth: 1, borderColor: '#000000FF', radius: 0 }; bubble.matrix = [1, 0, 0, 1, 60, 30]; bubble.children = [text.id];
    text.parentId = bubble.id; text.box = { x: 8, y: 8, width: 64, height: 44 }; text.text.content = '字'; text.text.font.size = 16;
    upper.geometry = [{ x: 0, y: 0 }, { x: 35, y: 0 }, { x: 35, y: 35 }, { x: 0, y: 35 }]; upper.style = { borderRadius: 0, borderWidth: 0, borderColor: '#000000FF', fill: '#0000FFFF' }; upper.matrix = [1, 0, 0, 1, 85, 60];
    for (const layer of [group, outer, inner, image, bubble, text, upper]) project.layers[layer.id] = layer; project.pages[pageId].roots = [...project.pages[pageId].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...([group.id, upper.id])];
    const fonts = await awaitFonts(project); if (!fonts.ok) throw Error(fonts.problems[0].message);
    const canvas = () => { const value = document.createElement('canvas'); value.width = 240; value.height = 180; return value; };
    const normal = canvas(), normalCtx = normal.getContext('2d')!; drawPage(normalCtx, project, pageId, images);
    const pixels = (c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const equal = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.length === b.length && a.every((value, index) => value === b[index]);
    const replay = canvas(), cache = beginGestureRuns(project, pageId, [image.id], { zoom: 1, pan: { x: 0, y: 0 } }, { width: 240, height: 180 }, images); drawGestureRuns(replay.getContext('2d')!, cache, project, images); disposeGestureRuns(cache);
    const png = await exportPng(project, pageId, images); if (!png.ok) throw Error(png.problems[0].message);
    const decodedPng = await createImageBitmap(png.value), exported = canvas(); exported.getContext('2d')!.drawImage(decodedPng, 0, 0); decodedPng.close();
    const thumbnailUrl = await new Promise<string>((resolve, reject) => {
      const off = subscribeThumbnailState(pageId, (state: any) => { if (state.status === 'ready') { off(); resolve(state.url); } else if (state.status === 'error') { off(); reject(Error(state.message)); } });
      scheduleThumbnail(pageId, 'scene-test', project, images, 240);
    });
    const thumbnailBitmap = await createImageBitmap(await (await fetch(thumbnailUrl)).blob()), thumbnail = canvas(); thumbnail.getContext('2d')!.drawImage(thumbnailBitmap, 0, 0); thumbnailBitmap.close(); invalidatePage(pageId);
    const sample = (x: number, y: number) => [...normalCtx.getImageData(x, y, 1, 1).data];
    const visible = { clipCorner: sample(35, 20), center: sample(70, 70), upper: sample(105, 75), outside: sample(10, 10) };
    const hidden = structuredClone(project); hidden.layers[group.id].visible = false; const hiddenCanvas = canvas(); drawPage(hiddenCanvas.getContext('2d')!, hidden, pageId, images);
    const hiddenCenter = [...hiddenCanvas.getContext('2d')!.getImageData(70, 70, 1, 1).data];
    // Compare all file paths through the same PNG decode/color-management boundary;
    // comparing raw canvas pixels to decoded PNG conflates the renderer with browser codec rounding.
    const normalBlob = await new Promise<Blob>((resolve) => normal.toBlob((value) => resolve(value!), 'image/png'));
    const normalBitmap = await createImageBitmap(normalBlob), encodedNormal = canvas(); encodedNormal.getContext('2d')!.drawImage(normalBitmap, 0, 0); normalBitmap.close();
    const comparison = { replay: equal(pixels(normal), pixels(replay)), png: equal(pixels(encodedNormal), pixels(exported)), thumbnail: equal(pixels(encodedNormal), pixels(thumbnail)) };
    decoded.value.bitmap.close(); source.width = 0; source.height = 0;
    return { comparison, visible, hiddenCenter };
  });
  expect(result.comparison).toEqual({ replay: true, png: true, thumbnail: true });
  expect(result.visible.clipCorner).toEqual([0, 0, 0, 0]); expect(result.visible.outside).toEqual([0, 0, 0, 0]);
  expect(result.visible.center).toEqual([255, 0, 0, 128]); expect(result.visible.upper).toEqual([0, 0, 255, 255]); expect(result.hiddenCenter).toEqual([0, 0, 0, 0]);
});
