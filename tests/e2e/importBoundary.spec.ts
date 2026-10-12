import { waitForProjectIO } from './menuHelpers';
import { menuCommand } from './menuHelpers';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('invalid cycle, missing image, excessive depth/count and nonfinite matrix imports report paths and preserve document, history and visible pixels', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  const snapshot = () => page.evaluate(async () => {
    const { getDocument } = await import('/src/' + 'state/documentStore.ts');
    const doc = getDocument(), canvas = document.querySelector<HTMLCanvasElement>('.konvajs-content canvas')!;
    return { project: doc.project, history: doc.history, epoch: doc.epoch, pixels: canvas.toDataURL() };
  });
  const saved = page.waitForEvent('download'); await (await menuCommand(page, '保存')).click();
  const initial = JSON.parse(await readFile((await (await saved).path())!, 'utf8'));
  const cases = await page.evaluate(async (envelope) => {
    const { createLayer } = await import('/src/' + 'domain/factories.ts');
    const result: { kind: string; payload: string; path: string }[] = [], pageId = envelope.project.pageOrder[0];
    const add = (kind: string, mutate: (project: any) => void, path: string) => { const value = structuredClone(envelope); mutate(value.project); result.push({kind,payload:JSON.stringify(value),path}); };
    add('cycle', (p) => { const group = createLayer('group',pageId); group.parentId=group.id; group.children=[group.id]; p.layers={[group.id]:group};p.pages[pageId].roots=[group.id]; }, 'pages.');
    add('missing image', (p) => { const image = createLayer('image',pageId); image.assetId=crypto.randomUUID();p.layers={[image.id]:image};p.pages[pageId].roots=[image.id]; }, 'pages.');
    add('depth', (p) => { p.layers={};p.pages[pageId].roots=[];let parent:any=null;for(let i=0;i<17;i++){const group=createLayer('group',pageId);p.layers[group.id]=group;if(parent){parent.children=[group.id];group.parentId=parent.id;}else p.pages[pageId].roots=[group.id];parent=group;} }, 'pages.');
    add('count', (p) => { p.layers={};p.pages[pageId].roots=[];for(let i=0;i<5001;i++){const layer=createLayer('text',pageId);p.layers[layer.id]=layer;p.pages[pageId].roots.push(layer.id);} }, 'layers');
    add('nonfinite', (p) => { p.layers[p.pages[pageId].roots[0]].matrix[4]='NONFINITE_MARKER'; }, 'layers.');
    result.at(-1)!.payload=result.at(-1)!.payload.replace('"NONFINITE_MARKER"','1e999');
    add('duplicate child', (p) => p.pages[pageId].roots.push(p.pages[pageId].roots[0]), 'layers.');
    add('unknown layer', (p) => {p.layers[p.pages[pageId].roots[0]].type='unknown';}, 'layers.');
    return result;
  }, initial);
  const before = await snapshot();
  for (const item of cases) {
    await page.locator('input[type=file][accept*=json]').setInputFiles({ name: `${item.kind}.Comia.json`, mimeType: 'application/json', buffer: Buffer.from(item.payload) });
    
    await waitForProjectIO(page);
    await expect(page.locator('.notice-stack')).toContainText(item.path);
    expect(await snapshot(), item.kind).toEqual(before);
    // Failed reads leave the active comic and all its history intact, without creating a tab.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByLabel('对象宽', { exact: true })).toBeEnabled();
  }
});

test('factory project saves and opens as one page with a default background and no orphan foreground layers or altered dimensions', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
  await page.goto('/'); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(0);
  const saved = page.waitForEvent('download'); await (await menuCommand(page, '保存')).click();
  const bytes = await readFile((await (await saved).path())!), envelope = JSON.parse(bytes.toString());
  expect(envelope.project.pageOrder).toHaveLength(1); const layers = Object.values(envelope.project.layers) as { id: string; type: string; fill: string }[]; expect(layers).toHaveLength(1); expect(layers[0]).toMatchObject({ type: 'pageBackground', fill: '#FFFFFFFF' }); expect(envelope.project.pages[envelope.project.pageOrder[0]].roots).toEqual([layers[0].id]);
  await page.locator('input[type=file][accept*=json]').setInputFiles({ name: 'empty.Comia.json', mimeType: 'application/json', buffer: bytes });
  await expect(page.locator('.unsaved')).toContainText('已保存'); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(0);
  const reopened = await page.evaluate(async () => { const { getProject } = await import('/src/' + 'state/documentStore.ts'); return getProject(); });
  expect(reopened).toEqual(envelope.project);
});
