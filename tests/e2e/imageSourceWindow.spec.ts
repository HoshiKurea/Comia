import { test, expect } from '@playwright/test';
import type { ImageLayer, Project } from '../../src/domain/types';
test('source-window painting crops real pixels, keeps the library source and restores original bounds', async({page})=>{
  await page.goto('/'); await expect(page.getByRole('toolbar',{name:'绘图工具'})).toBeVisible();
  const f=await page.evaluate(async()=>{
    const {createProject,createLayer}=await import('/src/'+'domain/factories.ts'),{replaceDocument,execute,clearHistory}=await import('/src/'+'history/commandBus.ts'),{sessionStore}=await import('/src/'+'state/sessionStore.ts'),{decodeImage}=await import('/src/'+'assets/importImage.ts'),{addLibraryAssets}=await import('/src/'+'assets/libraryCommands.ts');
    const p=createProject(),pid=p.pageOrder[0]; Object.assign(p.pages[pid],{width:400,height:300}); if(!replaceDocument(p).ok)throw Error('replace');
    const c=document.createElement('canvas'); c.width=100;c.height=80;const ctx=c.getContext('2d')!;ctx.fillStyle='#ff0000';ctx.fillRect(0,0,50,80);ctx.fillStyle='#0000ff';ctx.fillRect(50,0,50,80);const b=await new Promise<Blob>(r=>c.toBlob(b=>r(b!),'image/png'));const d=await decodeImage(new File([b],'原始红蓝.png',{type:'image/png'}),new AbortController().signal);if(!d.ok)throw Error('decode');const added=addLibraryAssets([d.value]);if(!added.ok)throw Error('library');
    const image=createLayer('image',pid) as ImageLayer;image.assetId=added.value[0];image.width=100;image.height=80;image.matrix=[1,0,0,1,40,40];
    const r=execute({label:'素材实例',context:{pageId:pid,selection:[]},mutate(p:Project){p.layers[image.id]=image;p.pages[pid].roots.push(image.id);}});if(!r.ok)throw Error('place');if(!clearHistory(true).ok)throw Error('clear test history');sessionStore.setState({activePageId:pid,selection:[],toolMode:'select',scopeId:null,viewportByPage:{[pid]:{zoom:1,pan:{x:10,y:10}}}});return{pid,id:image.id,asset:image.assetId};
  });
  await page.evaluate(async f=>{const {execute}=await import('/src/'+'history/commandBus.ts'),{trimImage}=await import('/src/'+'images/trimGeometry.ts');const r=execute({label:'保留红色一半',context:{pageId:f.pid,selection:[f.id]},mutate(p:Project){const t=trimImage(p,f.id,{x:0,y:0,width:50,height:80});if(!t.ok)throw Error('trim');p.layers[f.id]=t.value;}});if(!r.ok)throw Error(JSON.stringify(r));},f);
  async function pixels(){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));return page.locator('.konvajs-content canvas').first().evaluate((c:HTMLCanvasElement)=>{const x=c.getContext('2d')!;return[Array.from(x.getImageData(70,70,1,1).data),Array.from(x.getImageData(120,70,1,1).data)];});}
  expect(await pixels()).toEqual([[255,0,0,255],[255,255,255,255]]);
  const state=await page.evaluate(async f=>{const p=(await import('/src/'+'state/documentStore.ts')).getProject();return{image:p.layers[f.id],asset:p.assets[f.asset],library:p.libraryAssetIds};},f);expect(state.image).toMatchObject({width:50,height:80,sourceRect:{x:0,y:0,width:50,height:80}});expect(state.asset.width).toBe(100);expect(state.library).toContain(f.asset);
  await page.evaluate(async f=>{const {execute}=await import('/src/'+'history/commandBus.ts'),{restoreImageSourceWindow}=await import('/src/'+'images/trimGeometry.ts');const r=execute({label:'恢复原素材',context:{pageId:f.pid,selection:[]},mutate(p:Project){const t=restoreImageSourceWindow(p,f.id);if(!t.ok)throw Error('restore');p.layers[f.id]=t.value;}});if(!r.ok)throw Error(JSON.stringify(r));},f);
  expect(await pixels()).toEqual([[255,0,0,255],[0,0,255,255]]);
});
