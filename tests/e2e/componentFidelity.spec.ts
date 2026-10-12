import type { Project } from '../../src/domain/types';
import { menuCommand } from './menuHelpers';
import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

async function model(page: Page) { return page.evaluate(async () => (await import('/src/' + 'state/documentStore.ts')).getProject()); }
async function assertIcon(page: Page, label: string, id: string | string[], preservePose=false) {
  await expect(page.locator('.library-item').filter({ hasText: label }).locator('canvas')).toHaveAttribute('data-ready', 'true');
  const result = await page.locator('.library-item').filter({ hasText: label }).locator('canvas').evaluate(async (icon, options) => {
    const {id,preservePose}=options;
    const { getProject } = await import('/src/' + 'state/documentStore.ts'), { drawPage } = await import('/src/' + 'render/drawScene.ts'), { polyBounds } = await import('/src/' + 'geometry/polygon.ts'), { effectGeometryFor } = await import('/src/' + 'text/effectBounds.ts');
    await document.fonts.ready; await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    // Use the actually deployed document tree; no factory or template draft is involved.
    const project = structuredClone(getProject()), ids = Array.isArray(id) ? id : [id], layer: any = project.layers[ids[0]], pageId = layer.pageId;
    for (const key of ids) { if(!preservePose)project.layers[key].matrix = [1,0,0,1,0,0]; project.layers[key].parentId = null; } project.pages[pageId].roots = [...project.pages[pageId].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...ids];
    const {layerWorldBounds}=await import('/src/'+'interaction/layerBounds.ts'),{unionBounds}=await import('/src/'+'geometry/bounds.ts');
    const box = preservePose?unionBounds(ids.map(key=>layerWorldBounds(project,key)))!:layer.type === 'panel' ? polyBounds(ids.flatMap(key => project.layers[key].geometry)) : layer.type === 'text' ? effectGeometryFor(layer)?.bounds??layer.box : layer.type === 'bubbleTail' ? (await import('/src/'+'bubbles/tailBounds.ts')).tailControlBounds(layer) : layer.type === 'decoration' ? { x: 0, y: 0, width: layer.spec.width, height: layer.spec.height } : { x: 0, y: 0, width: layer.width, height: layer.height };
    // Independently pose the actual deployed subtree on a positive paper so
    // negative-coordinate ink is compared in full rather than clipped at zero.
    const margin=260;for (const key of ids) {const l=project.layers[key];l.matrix=preservePose?[l.matrix[0],l.matrix[1],l.matrix[2],l.matrix[3],l.matrix[4]+margin-box.x,l.matrix[5]+margin-box.y]:[1,0,0,1,margin-box.x,margin-box.y];}Object.assign(project.pages[pageId],{width:Math.ceil(box.width+2*margin),height:Math.ceil(box.height+2*margin)});
    const canvas = document.createElement('canvas'); canvas.width = 68; canvas.height = 64; const ctx = canvas.getContext('2d')!;
    const scale = Math.min(30 / box.width, 27 / box.height), tx = (34 - box.width * scale) / 2 - margin * scale, ty = (32 - box.height * scale) / 2 - margin * scale;
    ctx.scale(2, 2); ctx.translate(tx, ty); ctx.scale(scale, scale); drawPage(ctx, project, pageId, new Map(), ids, false);
    const actual = ctx.getImageData(0, 0, 68, 64).data, preview = (icon as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 68, 64).data;
    let mismatches = 0; for (let i = 0; i < actual.length; i++) if (actual[i] !== preview[i]) mismatches++;
    const debug = mismatches ? { actual: canvas.toDataURL(), icon: (icon as HTMLCanvasElement).toDataURL(), spec: layer.spec, font: ctx.font } : null;
    canvas.width = canvas.height = 0; return { mismatches, nonempty: actual.some((value) => value !== 0), debug };
  }, {id,preservePose});
  if (result.debug) { await writeFile(test.info().outputPath('actual.png'), Buffer.from(result.debug.actual.split(',')[1], 'base64')); await writeFile(test.info().outputPath('icon.png'), Buffer.from(result.debug.icon.split(',')[1], 'base64')); }
  expect({ mismatches: result.mismatches, nonempty: result.nonempty }, `${label}: ${JSON.stringify(result.debug?.spec)}`).toEqual({ mismatches: 0, nonempty: true });
}

test('all25 deployable built-in thumbnails exactly match the full rendered geometry and pixels of their deployed document objects', async ({ page }) => {
  await page.goto('/');
  const names = ['矩形分镜', '梯形分镜', '平行四边形', '对白气泡', '方框气泡', '圆形气泡', '云朵气泡', '尖刺气泡', '文字', '集中线', '音效字','柔和手绘气泡','粗糙速写气泡','不规则多边形气泡','波浪紧张气泡','短直尾','细线尾','弯曲长尾','多泡内心尾','锯齿喊叫尾','平头低语尾','重击声效字','裂响声效字','静默声效字','弧形呼喊声效字'];
  for (const label of names) {
    const item = page.locator('.library-item').filter({ hasText: label }); await item.click();
    const id = await page.evaluate(async () => (await import('/src/' + 'state/sessionStore.ts')).sessionStore.getState().selection[0]);
    await assertIcon(page, label, id);
    await (await menuCommand(page, '撤销')).click(); expect(Object.entries((await model(page)).layers).filter(([, layer]) => (layer as { type: string }).type !== 'pageBackground').map(([id]) => id)).toHaveLength(0);
  }
});

test('all twelve layout icons match the combined pixels of independently deployed frames', async ({ page }) => {
  await page.goto('/');
  for (const label of ['上下二格','左右二格','三横条','三竖条','四横条','四格','六格竖版','六格横版','上大下二','上二下大','左大右二','左二右大']) {
    const before = await model(page); await page.getByRole('button', { name: label, exact: true }).click();
    const after = await model(page), ids = Object.keys(after.layers).filter(id => !before.layers[id]);
    expect(ids.length).toBeGreaterThan(1); for (const id of ids) expect(after.layers[id]).toMatchObject({ type:'panel',role:'leaf',parentId:null });
    await assertIcon(page, label, ids); await (await menuCommand(page, '撤销')).click(); expect(await model(page)).toEqual(before);
  }
});

test('saving an illustrated rotated split template undoes only the library entry, then deployment preserves child geometry without copying images', async ({ page }) => {
  await page.goto('/'); await page.locator('.library-item').filter({ hasText: '梯形分镜' }).click();
  const rect = (await page.locator('.canvas-viewport').boundingBox())!;
  await page.evaluate(async ({ x, y }) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16; canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png')); const transfer = new DataTransfer(); transfer.items.add(new File([blob], '旧图片.png', { type: 'image/png' }));
    document.querySelector('.canvas-viewport')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
  }, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  await expect.poll(async () => Object.values((await model(page)).layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter((layer: any) => layer.type === 'image').length).toBe(1);
  await page.locator('.layer-name:not(.layer-row[data-layer-type="pageBackground"] .layer-name)').filter({ hasText: '分镜' }).click(); const originalFrame = await page.evaluate(async()=>{const{getProject}=await import('/src/'+'state/documentStore.ts'),{sessionStore}=await import('/src/'+'state/sessionStore.ts');return getProject().layers[sessionStore.getState().selection[0]];}); await page.getByLabel('切割比例').fill('.4'); await page.getByLabel('切割间隙').fill('12'); await page.getByRole('button', { name: '垂直切割', exact: true }).click();
  // Explicit compatibility fixture: the revised cut tool never creates this old parent.
  await page.evaluate(async(originalFrame)=>{const{createLayer}=await import('/src/'+'domain/factories.ts'),{getProject}=await import('/src/'+'state/documentStore.ts'),{execute}=await import('/src/'+'history/commandBus.ts');const p=getProject(),pageId=p.pageOrder[0],leaves=Object.values(p.layers as Project['layers']).filter(l=>l.type==='panel'),root=createLayer('panel',pageId);Object.assign(root,{geometry:originalFrame.geometry,style:originalFrame.style,matrix:originalFrame.matrix,role:'split',children:leaves.map(l=>l.id)});const r=execute({label:'既有带图分格',context:{pageId,selection:[]},afterSelection:[root.id],mutate(d:Project){d.layers[root.id]=root;d.pages[pageId].roots=d.pages[pageId].roots.filter(id=>!leaves.some(l=>l.id===id));d.pages[pageId].roots.push(root.id);for(const leaf of leaves){d.layers[leaf.id].parentId=root.id;d.layers[leaf.id].matrix=[1,0,0,1,0,0];}}});if(!r.ok)throw Error(JSON.stringify(r));},originalFrame);
  await page.getByLabel('对象旋转').fill('37'); await page.getByLabel('对象旋转').press('Enter'); const before = await model(page);
  await page.getByRole('button', { name: '存为组件', exact: true }).click();const presetDialog=page.getByRole('dialog',{name:'保存组件预设',exact:true});await presetDialog.getByLabel('预设名称').fill('带图双格');await expect(presetDialog.getByRole('status')).toContainText('不包含 2 张图片');await presetDialog.getByRole('button',{name:'保存预设',exact:true}).click();
  const item = page.locator('.library-item').filter({ hasText: '自定义 · 带图双格' }); await expect(item).toBeVisible();
  const saved = await model(page), template: any = Object.values(saved.templates)[0];
  expect(template.recipe.kind).toBe('scene');expect(template.recipe.roots).toHaveLength(2);expect(Object.values(template.recipe.nodes).every((n:any)=>n.type==='panel'&&n.role==='leaf'&&n.parentId===null)).toBe(true);expect(JSON.stringify(template)).not.toMatch(/assetId|originalHash|renderHash|editorNumber|旧图片/); expect(saved.layers).toEqual(before.layers);
  await (await menuCommand(page, '撤销')).click(); await expect(item).toHaveCount(0); expect(await model(page)).toEqual(before);
  await (await menuCommand(page, '重做')).click(); await item.scrollIntoViewIfNeeded(); const box = (await item.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(rect.x + rect.width / 2 + 50, rect.y + rect.height / 2 + 30, { steps: 12 }); await page.mouse.up();
  const result = await page.evaluate(async (before) => {
    const { getProject } = await import('/src/' + 'state/documentStore.ts'); const project = getProject() as Project;
    const made = Object.values(project.layers).filter(l => l.type === 'panel' && !before.layers[l.id]);
    return { ids: made.map(l=>l.id), leaves: made.map(l=>l.type==='panel'?{geometry:l.geometry,style:l.style,children:l.children}:null), matrices: made.map(l=>l.matrix), parents:made.map(l=>l.parentId),project };
  }, before);
  expect(result.leaves).toEqual(template.recipe.roots.map((id:string)=>{const n=template.recipe.nodes[id];return{geometry:n.geometry,style:n.style,children:[]};}));expect(result.parents).toEqual([null,null]);const sourceRoot=Object.values(before.layers).find((l:any)=>l.type==='panel'&&l.role==='split')!;for(const matrix of result.matrices)expect(matrix.slice(0,4)).toEqual((sourceRoot as any).matrix.slice(0,4));
  expect(Object.values(result.project.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').filter((layer: any) => layer.type === 'image')).toHaveLength(2); expect(result.project.assets).toEqual(before.assets);
  for (const id of Object.entries(before.layers).filter(([, layer]) => (layer as { type: string }).type !== 'pageBackground').map(([id]) => id)) expect(result.project.layers[id]).toEqual(before.layers[id]);
  await assertIcon(page, '自定义 · 带图双格', result.ids,true);
  await page.getByRole('button', { name: '删除预设 带图双格', exact: true }).click(); await expect(item).toHaveCount(0); expect((await model(page)).layers).toEqual(result.project.layers);
});
