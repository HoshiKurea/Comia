import { expect, test } from '@playwright/test';
import type { BubbleLayer } from '../../src/domain/types';
import { mkdir, writeFile } from 'node:fs/promises';
import { canvasInk, handArc, handState, initHandBubble, scenePixel } from './handBubbleHelpers';
import { menuCommand } from './menuHelpers';
test('open hand contour closes on release, selects one independent bubble and one undo restores the original project', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await initHandBubble(page); const before = await handState(page);
  await page.getByRole('button', { name: '手绘气泡', exact: true }).click(); await canvasInk(page, handArc());
  const made = await handState(page), b = made.project.layers[made.selection[0]] as BubbleLayer;
  expect(b).toMatchObject({ type: 'bubble', shape: 'freehand', parentId: null, contour: null, freehandSource: { version: 2, ink: [] } }); expect(b.freehandSource!.baseRing.length).toBeGreaterThan(32);
  expect(made.past).toBe(before.past + 1); expect(made.mode).toBe('select'); expect(await scenePixel(page, 200, 170)).toEqual([255, 255, 255, 255]);
  await expect(page.getByRole('button', { name: '完成手绘气泡', exact: true })).toHaveCount(0); await expect(page.getByLabel('笔刷气泡节点1', { exact: true })).toHaveCount(0);
  await (await menuCommand(page, '撤销')).click(); expect((await handState(page)).project).toEqual(before.project); await (await menuCommand(page, '重做')).click(); expect((await handState(page)).project).toEqual(made.project); expect(errors).toEqual([]);
});
test('detail ink, bilingual dialogue and strokes render in real 2x/4x PNG and PDF without editor overlays', async ({ page }) => {
  test.setTimeout(90000); await initHandBubble(page); await page.keyboard.press('b'); await canvasInk(page, handArc()); const id = (await handState(page)).selection[0];
  await page.getByRole('button', { name: '画细节', exact: true }).click();
  await page.evaluate(async () => { (await import('/src/' + 'bubbles/brushController.ts')).setBubbleInkOptions({ color: '#2244FFFF', opacity: 1, width: 12 }); });
  await canvasInk(page, [{ x: 160, y: 210 }, { x: 240, y: 210 }]); await page.keyboard.press('v');
  await page.evaluate(async id => {
    const text = await import('/src/' + 'text/editController.ts'); const started = text.beginBubbleTextEdit(id); if (!started.ok) throw Error(JSON.stringify(started)); text.updateTextInput('Hi 你好', 5, 5); const r = text.commitTextEdit(); if (!r.ok) throw Error(JSON.stringify(r));
    const style = (await import('/src/' + 'bubbles/commands.ts')).setBubbleStyle(id, { outerStroke: { enabled: true, width: 4, color: '#003366FF' }, innerStroke: { enabled: true, width: 2, color: '#99CCFFFF' } }); if (!style.ok) throw Error(JSON.stringify(style));
    (await import('/src/' + 'state/sessionStore.ts')).setSelection([id]);
  }, id);
  const baseline = await handState(page);
  for (const scale of [2, 4]) {
    const files = await page.evaluate(async scale => {
      const p = (await import('/src/' + 'state/documentStore.ts')).getProject(), images = (await import('/src/' + 'state/runtimeStore.ts')).runtimeStore.getState().images, e = await import('/src/' + 'export/exportFiles.ts');
      const png = await e.exportPng(p, p.pageOrder[0], images, undefined, { scale }), pdf = await e.exportPdf(p, images, undefined, { scale }); if (!png.ok || !pdf.ok) throw Error(JSON.stringify({ png, pdf }));
      const bitmap = await createImageBitmap(png.value), c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height; const ctx = c.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
      return { png: [...new Uint8Array(await png.value.arrayBuffer())], pdf: [...new Uint8Array(await pdf.value.arrayBuffer())], width: c.width, height: c.height, ink: [...ctx.getImageData(200 * scale, 210 * scale, 1, 1).data], empty: [...ctx.getImageData(10 * scale, 10 * scale, 1, 1).data] };
    }, scale);
    expect(files.width).toBe(640 * scale); expect(files.height).toBe(480 * scale); expect(files.ink).toEqual([34, 68, 255, 255]); expect(files.empty).toEqual([0, 0, 0, 0]); expect(Buffer.from(files.pdf).subarray(0, 4).toString()).toBe('%PDF');
    await mkdir('output/hand-bubble', { recursive: true }); await writeFile(`output/hand-bubble/delivery-${scale}x-dpr${await page.evaluate(() => devicePixelRatio)}.png`, Buffer.from(files.png)); await writeFile(`output/hand-bubble/delivery-${scale}x-dpr${await page.evaluate(() => devicePixelRatio)}.pdf`, Buffer.from(files.pdf));
  }
  expect((await handState(page)).project).toEqual(baseline.project); expect((await handState(page)).past).toBe(baseline.past);
  await page.screenshot({ path: `output/hand-bubble/editor-dpr${await page.evaluate(() => devicePixelRatio)}.png` });
});
test('canvas detail pen and eraser preserve bubble fill/border, stay attached during movement and roundtrip', async ({ page }) => {
  await initHandBubble(page); await page.keyboard.press('b'); await canvasInk(page, handArc()); const created = await handState(page), id = created.selection[0], initial = created.project.layers[id] as BubbleLayer;
  await page.getByRole('button', { name: '画细节', exact: true }).click();
  await page.evaluate(async () => { const r = (await import('/src/' + 'bubbles/brushController.ts')).setBubbleInkOptions({ color: '#FF0000FF', width: 12, opacity: .5 }); if (!r.ok) throw Error(JSON.stringify(r)); });
  await canvasInk(page, [{ x: 160, y: 170 }, { x: 240, y: 170 }]); const painted = await handState(page); expect(await scenePixel(page, 200, 170)).toEqual([255, 127, 127, 255]);
  await page.getByLabel('手绘气泡操作').selectOption('erase-ink'); await page.getByLabel('气泡画笔透明度 %', { exact: true }).fill('100'); await page.getByLabel('气泡画笔透明度 %', { exact: true }).press('Enter');
  await canvasInk(page, [{ x: 200, y: 150 }, { x: 200, y: 190 }]); expect(await scenePixel(page, 200, 170)).toEqual([255, 255, 255, 255]); const erased = await handState(page), b = erased.project.layers[id] as BubbleLayer;
  expect(b.freehandSource!.baseRing).toEqual(initial.freehandSource!.baseRing); expect(b.style).toEqual(initial.style); expect(erased.past).toBe(painted.past + 1);
  await page.keyboard.press('v'); await (await menuCommand(page, '撤销')).click(); expect((await handState(page)).project).toEqual(painted.project); await (await menuCommand(page, '重做')).click(); expect((await handState(page)).project).toEqual(erased.project);
  await page.getByLabel('对象X', { exact: true }).fill(String(b.matrix[4] + 30)); await page.getByLabel('对象X', { exact: true }).press('Enter'); expect((await scenePixel(page, 200, 170))[0]).toBe(255); expect(await scenePixel(page, 190, 170)).toEqual([255, 127, 127, 255]);
  const roundtrip = await page.evaluate(async () => { const p = (await import('/src/' + 'state/documentStore.ts')).getProject(), codec = await import('/src/' + 'storage/codec.ts'), encoded = await codec.encodeProject(p, (await import('/src/' + 'state/runtimeStore.ts')).runtimeStore.getState().blobs); if (!encoded.ok) throw Error(JSON.stringify(encoded)); const decoded = await codec.decodeProject(new File([encoded.value], 'hand-bubble.Comia.json')); if (!decoded.ok) throw Error(JSON.stringify(decoded)); return { original: p, loaded: decoded.value.project }; }); expect(roundtrip.loaded).toEqual(roundtrip.original);
});
test('shape brush changes the contour and a hole is refused atomically', async ({ page }) => {
  await initHandBubble(page); await page.keyboard.press('b'); await canvasInk(page, handArc()); const initial = await handState(page), id = initial.selection[0];
  await page.getByRole('button', { name: '补画', exact: true }).click(); await canvasInk(page, [{ x: 100, y: 170 }, { x: 85, y: 170 }]); const expanded = await handState(page); expect(expanded.past).toBe(initial.past + 1); expect((expanded.project.layers[id] as BubbleLayer).freehandSource!.edits).toHaveLength(1);
  await page.getByLabel('手绘气泡操作').selectOption('subtract-shape'); await canvasInk(page, [{ x: 175, y: 165 }, { x: 180, y: 165 }]); expect((await handState(page)).project).toEqual(expanded.project); expect((await handState(page)).past).toBe(expanded.past);
  await page.keyboard.press('v'); await (await menuCommand(page, '撤销')).click(); expect((await handState(page)).project).toEqual(initial.project);
});

for (const [key, mode] of [['1','connector'], ['2','fused'], ['3','overlap']] as const) test(`${mode} dialogue retains coloured details and erasers never punch through the body`, async ({page}) => {
  await initHandBubble(page); await page.keyboard.press('b'); await canvasInk(page,handArc()); const first=(await handState(page)).selection[0];
  await page.getByRole('button',{name:'画细节',exact:true}).click(); await page.evaluate(async()=>{(await import('/src/'+'bubbles/brushController.ts')).setBubbleInkOptions({color:'#FF0000FF',opacity:1,width:12});}); await canvasInk(page,[{x:160,y:170},{x:220,y:170}]);
  await page.keyboard.press('b'); await canvasInk(page,handArc(330,170)); const second=(await handState(page)).selection[0];
  await page.evaluate(async ids=>(await import('/src/'+'state/sessionStore.ts')).sessionStore.setState({selection:ids}),[first,second]); await page.keyboard.press('Control+Alt+'+key);
  const grouped=await handState(page); expect(grouped.project.layers[grouped.selection[0]]).toMatchObject({type:'group',dialogue:{mode}}); const red=await scenePixel(page,180,170); expect(red[0]).toBe(255);expect(red[1]).toBe(0);
  await page.evaluate(async id=>{(await import('/src/'+'state/sessionStore.ts')).sessionStore.setState({selection:[id]});},first); await page.getByRole('button',{name:'擦细节',exact:true}).click(); await canvasInk(page,[{x:180,y:150},{x:180,y:190}]); const blank=await scenePixel(page,180,170); expect(blank.slice(0,3)).toEqual([255,255,255]);expect(blank[3]).toBeGreaterThan(0);
});
