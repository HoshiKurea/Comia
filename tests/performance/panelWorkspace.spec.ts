import { expect,test } from '@playwright/test';
import { mkdir,writeFile } from 'node:fs/promises';
import type { Project } from '../../src/domain/types';
for(const kind of ['tab','floating-move','floating-resize','column'] as const)test(`100 trusted ${kind} previews with 50 panels keep comic history and canvas unchanged`,async({page})=>{
 await page.goto('/');await page.evaluate(async()=>{
  const {createProject,createLayer}=await import('/src/'+'domain/factories.ts'),{replaceDocument,execute}=await import('/src/'+'history/commandBus.ts');const p=createProject(),pid=p.pageOrder[0];if(!replaceDocument(p).ok)throw Error('fixture');
  const r=execute({label:'50分镜',context:{pageId:pid,selection:[]},mutate(d:Project){for(let i=0;i<50;i++){const l=createLayer('panel',pid);l.matrix=[1,0,0,1,i%5*150,Math.floor(i/5)*100];d.layers[l.id]=l;d.pages[pid].roots.push(l.id);}}});if(!r.ok)throw Error('panels');await document.fonts.ready;
 });
 const body=(await page.locator('.panel-workspace').boundingBox())!;
 if(kind.startsWith('floating')){const tab=(await page.getByRole('tab',{name:'素材库',exact:true}).boundingBox())!;await page.mouse.move(tab.x+20,tab.y+12);await page.mouse.down();await page.mouse.move(body.x+450,body.y+80,{steps:15});await page.mouse.up();await expect(page.locator('.panel-floating')).toBeVisible();}
 const source=kind==='tab'?page.getByRole('tab',{name:'素材库',exact:true}):kind==='floating-move'?page.getByLabel('移动素材库面板组',{exact:true}):kind==='floating-resize'?page.getByLabel('调整素材库面板大小',{exact:true}):page.getByLabel('调整左侧栏宽度',{exact:true});
 const rect=(await source.boundingBox())!,x=rect.x+rect.width/2,y=rect.y+rect.height/2;
 const before=await page.evaluate(async()=>({doc:(await import('/src/'+'state/documentStore.ts')).getDocument(),layout:(await import('/src/'+'workspacePanels/panelLayoutStore.ts')).panelLayoutStore.getState().layout}));
 await page.mouse.move(x,y);await page.mouse.down();await page.evaluate(async()=>{
  await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));const {resetRenderStats}=await import('/src/'+'state/runtimeStore.ts');resetRenderStats();
  const data={trusted:0,pending:0,samples:[] as number[],twoRaf:[] as number[]};(window as any).__panelPerf=data;
  const input=(e:PointerEvent)=>{if(!e.isTrusted||!(e.target instanceof Element)||!e.target.hasPointerCapture(e.pointerId))return;data.trusted++;const start=performance.now();data.pending=start;requestAnimationFrame(()=>requestAnimationFrame(()=>data.twoRaf.push(performance.now()-start)));};
  const drawn=()=>{if(data.pending){document.querySelector('.panel-drag-ghost')?.getBoundingClientRect();data.samples.push(performance.now()-data.pending);data.pending=0;}};
  window.addEventListener('pointermove',input,true);document.querySelector('.panel-workspace')!.addEventListener('comia:panel-preview',drawn);
  (window as any).__stopPanelPerf=()=>{window.removeEventListener('pointermove',input,true);document.querySelector('.panel-workspace')!.removeEventListener('comia:panel-preview',drawn);};
 });
 for(let i=1;i<=100;i++){
  const dx=kind==='tab'?300+i*.6:4+i*.6,dy=kind==='floating-resize'?-4-i*.5:kind==='column'?0:10+12*Math.sin(i/30);
  await page.mouse.move(x+dx,y+dy);await page.waitForFunction(n=>(window as any).__panelPerf.samples.length===n&&(window as any).__panelPerf.twoRaf.length===n,i);
 }
 const result=await page.evaluate(async()=>{(window as any).__stopPanelPerf();return{...(window as any).__panelPerf,stats:(await import('/src/'+'state/runtimeStore.ts')).runtimeStore.getState().renderStats,doc:(await import('/src/'+'state/documentStore.ts')).getDocument(),layout:(await import('/src/'+'workspacePanels/panelLayoutStore.ts')).panelLayoutStore.getState().layout,dpr:devicePixelRatio,userAgent:navigator.userAgent};});
 await page.mouse.up();const after=await page.evaluate(async()=>({doc:(await import('/src/'+'state/documentStore.ts')).getDocument(),layout:(await import('/src/'+'workspacePanels/panelLayoutStore.ts')).panelLayoutStore.getState().layout}));
 const sorted=[...result.samples].sort((a:number,b:number)=>a-b),maximum=Math.max(...sorted),rafMaximum=Math.max(...result.twoRaf);
 await mkdir('output/audit/panel-performance',{recursive:true});await writeFile(`output/audit/panel-performance/${kind}-dpr${result.dpr}.json`,JSON.stringify({...result,doc:undefined,layout:undefined,scene:'50 independent panels; 1440x900; 100 trusted pointer inputs; layout draft only',metric:'native pointermove capture to DOM preview style/layout completion plus two-rAF approximation; excludes automation RPC and GPU scanout',p50:sorted[49],p95:sorted[94],maximum,rafMaximum,historyBefore:before.doc.history.past.length,historyAfter:after.doc.history.past.length,layoutBefore:before.layout.revision,layoutAfter:after.layout.revision},null,2));
 expect(result.trusted).toBe(100);expect(result.samples).toHaveLength(100);expect(result.twoRaf).toHaveLength(100);expect(result.doc).toEqual(before.doc);expect(result.layout).toEqual(before.layout);expect(result.stats).toEqual({mainDraws:0,gestureDraws:0,overlayDraws:0});expect(after.doc).toEqual(before.doc);expect(after.layout.revision).toBeGreaterThan(before.layout.revision);expect(maximum).toBeLessThan(100);expect(rafMaximum).toBeLessThan(100);
});
