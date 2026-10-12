import { test, expect, type Page } from '@playwright/test';
import type { PanelLayer, Project } from '../../src/domain/types';

async function fixture(page: Page) {
  await page.goto('/'); await expect(page.getByRole('toolbar', { name: '绘图工具' })).toBeVisible();
  return page.evaluate(async () => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts'), { replaceDocument, execute, clearHistory } = await import('/src/' + 'history/commandBus.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts');
    const p = createProject(), pid = p.pageOrder[0]; Object.assign(p.pages[pid], { width: 1000, height: 800 }); if (!replaceDocument(p).ok) throw Error('replace');
    const layers = [0,1,2].map(i => { const q = createLayer('panel', pid) as PanelLayer; q.geometry = [{x:0,y:0},{x:400,y:0},{x:400,y:300},{x:0,y:300}]; q.matrix = [1,0,0,1,i ? 550 : 40,i ? i * 340 : 40]; return q; });
    const r = execute({ label: '测试已有1、2、3', defaultNamedPanelIds: layers.map(l=>l.id), context: {pageId:pid,selection:[]}, mutate(d: Project) { for(const l of layers) { d.layers[l.id]=l; d.pages[pid].roots.push(l.id); } } }); if (!r.ok) throw Error(JSON.stringify(r));
    if(!clearHistory(true).ok)throw Error('clear test history'); sessionStore.setState({activePageId:pid,selection:[],scopeId:null,toolMode:'select',viewportByPage:{[pid]:{zoom:1,pan:{x:10,y:10}}}}); return { pid, ids: layers.map(l=>l.id) };
  });
}
async function project(page: Page): Promise<Project> { return page.evaluate(async()=>structuredClone((await import('/src/'+'state/documentStore.ts')).getProject())); }
async function draw(page: Page, a: [number,number], b: [number,number]) {
  const bounds=(await page.getByRole('application',{name:'页面编辑画布'}).boundingBox())!;
  await page.mouse.move(bounds.x+10+a[0],bounds.y+10+a[1]); await page.mouse.down(); await page.mouse.move(bounds.x+10+b[0],bounds.y+10+b[1],{steps:8}); await page.mouse.up();
}
test('two real K cuts insert sequential numbers and retain later frames and one history step per cut', async({page})=>{
  const f=await fixture(page), before=await project(page); await page.getByRole('application',{name:'页面编辑画布'}).focus(); await page.keyboard.press('k');
  await draw(page,[50,200],[450,200]); await expect.poll(async()=>Object.values((await project(page)).layers).filter(l=>l.type==='panel').length).toBe(4);
  let p=await project(page); expect((p.layers[f.ids[1]] as PanelLayer).editorNumber).toBe(3); expect((p.layers[f.ids[2]] as PanelLayer).editorNumber).toBe(4);
  // Escape returns to point selection. Rearm K and cut the top result again;
  // the lower result shifts to 3, without introducing an unrelated move action.
  await page.keyboard.press('Escape'); await page.keyboard.press('k');
  await expect(page.getByRole('button',{name:'分镜切割',exact:true})).toHaveAttribute('aria-pressed','true');
  await draw(page,[230,60],[230,210]); await expect.poll(async()=>Object.values((await project(page)).layers).filter(l=>l.type==='panel').length).toBe(5);
  const after=await project(page), panels=Object.values(after.layers).filter((l):l is PanelLayer=>l.type==='panel');
  expect(panels.map(l=>l.editorNumber).sort()).toEqual([1,2,3,4,5]); expect((after.layers[f.ids[1]] as PanelLayer).name).toBe('分镜 4'); expect((after.layers[f.ids[2]] as PanelLayer).name).toBe('分镜 5');
  expect(panels.every(l=>l.role==='leaf'&&l.parentId===null)).toBe(true); expect(after.layers[f.ids[1]].matrix).toEqual(before.layers[f.ids[1]].matrix);
  const entries=await page.evaluate(async()=>(await import('/src/'+'state/documentStore.ts')).getDocument().history.past.map((e:{label:string;forward:unknown})=>({label:e.label,patches:e.forward})));
  await test.info().attach('cut-history-diagnostic',{body:JSON.stringify(entries,null,2),contentType:'application/json'});
  expect(entries.map((e:{label:string})=>e.label)).toEqual(['生成独立分镜','生成独立分镜']);
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); expect(await project(page)).toEqual(before); await page.keyboard.press('Control+Shift+z'); await page.keyboard.press('Control+Shift+z'); expect(await project(page)).toEqual(after);
});
test('three-piece replacement displays new 1/2/3 and old 4/5, preserving custom names and roundtrip', async({page})=>{
  const f=await fixture(page);
  const result=await page.evaluate(async f=>{
    const {renameLayer}=await import('/src/'+'layers/visibility.ts'); if(!renameLayer(f.ids[2],'特写').ok)throw Error('rename');
    const {makeGrid}=await import('/src/'+'panels/presets.ts'),{applyIndependentLayout}=await import('/src/'+'panels/independentLayout.ts'); const tree=makeGrid({x:0,y:0,width:400,height:300},1,3,8,8); if(!tree.ok)throw Error('grid'); const r=applyIndependentLayout(f.pid,tree.value,f.ids[0]); if(!r.ok)throw Error(JSON.stringify(r)); return r.value;
  },f);
  const p=await project(page); expect(result.map((id:string)=>(p.layers[id] as PanelLayer).editorNumber)).toEqual([3,2,1]); expect((p.layers[f.ids[1]] as PanelLayer).editorNumber).toBe(4); expect((p.layers[f.ids[2]] as PanelLayer).editorNumber).toBe(5); expect(p.layers[f.ids[2]].name).toBe('特写');
  for(const n of [1,2,3,4])await expect(page.locator('.layer-name').filter({hasText:new RegExp(`^分镜 ${n}$`)})).toBeVisible(); await expect(page.locator('.layer-name').filter({hasText:'特写'})).toBeVisible();
  const saved=await page.evaluate(async()=>{ const {getProject}=await import('/src/'+'state/documentStore.ts'),{encodeProject,decodeProject}=await import('/src/'+'storage/codec.ts'),{runtimeStore}=await import('/src/'+'state/runtimeStore.ts'); const r=await encodeProject(getProject(),runtimeStore.getState().blobs); if(!r.ok)throw Error('save'); const loaded=await decodeProject(new File([r.value],'插号.Comia')); if(!loaded.ok)throw Error(JSON.stringify(loaded)); return loaded.value.project; }); expect(saved).toEqual(p);
});
test('cancelled K preview leaves all names and numbers intact, then delete tail reuses live maximum', async({page})=>{
  const f=await fixture(page), before=await project(page); await page.getByRole('button',{name:'分镜切割',exact:true}).click(); const bounds=(await page.getByRole('application',{name:'页面编辑画布'}).boundingBox())!;
  await page.mouse.move(bounds.x+60,bounds.y+210); await page.mouse.down(); await page.mouse.move(bounds.x+460,bounds.y+210,{steps:8}); expect(await project(page)).toEqual(before); await page.keyboard.press('Escape'); await page.mouse.up(); expect(await project(page)).toEqual(before);
  const next=await page.evaluate(async f=>{ const {sessionStore}=await import('/src/'+'state/sessionStore.ts'),{deleteSelected,addObject}=await import('/src/'+'app/actions.ts'); sessionStore.setState({selection:[f.ids[2]],toolMode:'select'}); if(!deleteSelected().ok)throw Error('delete'); const r=addObject('rect-panel',f.pid,{x:20,y:20}); if(!r.ok)throw Error('add'); return r.value; },f);
  const p=await project(page); expect((p.layers[next] as PanelLayer).editorNumber).toBe(3); expect(p.layers[next].name).toBe('分镜 3');
});
