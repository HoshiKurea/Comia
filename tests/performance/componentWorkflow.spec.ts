import {test,expect,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import type {Project,PanelLayer,ImageLayer} from '../../src/domain/types';
interface PerfData {pending:number;trusted:number;samples:number[];twoRaf:number[];held:boolean}
declare global {interface Window {__componentPerf:PerfData;__stopComponentPerf:()=>void}}
async function scene(page:Page){await page.goto('/');return page.evaluate(async()=>{
  const {createProject,createLayer}=await import('/src/'+'domain/factories.ts'),{replaceDocument,execute}=await import('/src/'+'history/commandBus.ts'),{sessionStore}=await import('/src/'+'state/sessionStore.ts'),{decodeImage}=await import('/src/'+'assets/importImage.ts'),{addLibraryAssets}=await import('/src/'+'assets/libraryCommands.ts'),{capturePanelTemplate}=await import('/src/'+'library/templates.ts');
  const p=createProject(),pid=p.pageOrder[0];Object.assign(p.pages[pid],{width:900,height:1300});if(!replaceDocument(p).ok)throw Error('project');sessionStore.setState({activePageId:pid,viewportByPage:{[pid]:{zoom:.5,pan:{x:30,y:20}}}});
  const c=document.createElement('canvas');c.width=80;c.height=60;const ctx=c.getContext('2d')!;ctx.fillStyle='#c67550';ctx.fillRect(0,0,80,60);const blob=await new Promise<Blob>(r=>c.toBlob(b=>r(b!),'image/png'));const decoded=await decodeImage(new File([blob],'性能素材.png',{type:'image/png'}),new AbortController().signal);if(!decoded.ok)throw Error('decode');const assets=addLibraryAssets([decoded.value]);if(!assets.ok)throw Error('asset');const aid=assets.value[0],ids:string[]=[];
  const built=execute({label:'性能场景',context:{pageId:pid,selection:[]},mutate(d:Project){for(let i=0;i<50;i++){const panel=createLayer('panel',pid) as PanelLayer;panel.geometry=[{x:0,y:0},{x:130,y:0},{x:130,y:90},{x:0,y:90}];panel.matrix=[1,0,0,1,20+i%5*150,20+Math.floor(i/5)*110];ids.push(panel.id);d.layers[panel.id]=panel;d.pages[pid].roots.push(panel.id);for(let j=0;j<2;j++){const image=createLayer('image',pid) as ImageLayer;image.assetId=aid;image.width=80;image.height=60;image.parentId=panel.id;image.matrix=[.5,0,0,.5,10+j*35,15];d.layers[image.id]=image;panel.children.push(image.id);}}}});if(!built.ok)throw Error(built.problems[0].message);
  for(let i=0;i<20;i++){const r=capturePanelTemplate(ids[i],`性能预设 ${i}`);if(!r.ok)throw Error(r.problems[0].message);}
  const {createAssetFolder,moveLibraryAssets}=await import('/src/'+'assets/folderCommands.ts');const a=createAssetFolder('场景',null);if(!a.ok)throw Error('folder');const b=createAssetFolder('背景',a.value);if(!b.ok)throw Error('subfolder');moveLibraryAssets([aid],b.value);sessionStore.setState({selection:[ids[0]],toolMode:'select'});await document.fonts.ready;return{pid,id:ids[0]};
});}
async function start(page:Page,kind:'node'|'pointer'|'hover'){
  await page.evaluate(async kind=>{const {resetRenderStats}=await import('/src/'+'state/runtimeStore.ts');await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));resetRenderStats();const d:PerfData={pending:0,trusted:0,samples:[],twoRaf:[],held:kind==='pointer'};window.__componentPerf=d;
    const capture=(e:Event)=>{if(!e.isTrusted)return;if(kind==='node'&&(!(e instanceof KeyboardEvent)||e.key!=='ArrowRight'||!e.ctrlKey))return;if(kind!=='node'&&!(e instanceof PointerEvent))return;if(kind==='pointer'&&!(e as PointerEvent).buttons)return;if(kind==='hover'&&(e as PointerEvent).buttons)return;const now=performance.now();d.trusted++;d.pending=now;requestAnimationFrame(()=>requestAnimationFrame(()=>{d.twoRaf.push(performance.now()-now);if(kind==='hover'){d.samples.push(performance.now()-now);d.pending=0;}}));};
    const contexts=Array.from(document.querySelectorAll<HTMLCanvasElement>('.konvajs-content canvas')).slice(1,3).map(c=>c.getContext('2d')).filter((c):c is CanvasRenderingContext2D=>!!c);
    const originals=contexts.map(c=>c.restore);
    contexts.forEach((c,i)=>{c.restore=function(){originals[i].call(c);if(kind!=='hover'&&d.pending)queueMicrotask(()=>{if(d.pending){d.samples.push(performance.now()-d.pending);d.pending=0;}});};});
    window.addEventListener(kind==='node'?'keydown':'pointermove',capture,true);window.__stopComponentPerf=()=>{contexts.forEach((c,i)=>{c.restore=originals[i];});window.removeEventListener(kind==='node'?'keydown':'pointermove',capture,true);};
  },kind);
}
async function finish(page:Page,name:string,historyBefore:number){const result=await page.evaluate(async()=>{window.__stopComponentPerf();const {runtimeStore}=await import('/src/'+'state/runtimeStore.ts'),{getDocument}=await import('/src/'+'state/documentStore.ts');return{...window.__componentPerf,stats:runtimeStore.getState().renderStats,historyAfter:getDocument().history.past.length,dpr:devicePixelRatio,userAgent:navigator.userAgent};});const sorted=[...result.samples].sort((a,b)=>a-b);await mkdir('output/audit/component-performance',{recursive:true});await writeFile(`output/audit/component-performance/${name}-dpr${result.dpr}.json`,JSON.stringify({...result,historyBefore,p50:sorted[49],p95:sorted[94],maximum:Math.max(...sorted),rafMaximum:Math.max(...result.twoRaf),scene:'50 independent panels, 100 real decoded image instances, 20 scene presets and nested material folders; 1440x900',metric:name==='hover'?'native pointermove capture to two rAF after coalesced hover hit processing; reference intentional dwell180ms excluded':'native input capture to microtask after gesture/creation Canvas restore and synchronous drawing complete; two rAF separate; excludes RPC and GPU scanout',warmup:'one gesture/cache preparation before recorded100 inputs; not included in these samples'},null,2));expect(result.trusted).toBe(100);expect(sorted).toHaveLength(100);expect(result.twoRaf).toHaveLength(100);expect(Math.max(...sorted)).toBeLessThan(100);expect(result.stats.mainDraws).toBe(0);if(name==='hover')expect(result.stats).toEqual({mainDraws:0,gestureDraws:0,overlayDraws:0});expect(result.historyAfter).toBe(historyBefore);}
test('100 trusted held node micro-edits preserve other vertices and do not redraw the main layer',async({page})=>{
  const f=await scene(page);await page.keyboard.press('g');await page.keyboard.down('Control');await page.keyboard.down('ArrowRight');await page.waitForTimeout(50);const before=await page.evaluate(async()=>(await import('/src/'+'state/documentStore.ts')).getDocument().history.past.length);await start(page,'node');
  for(let i=0;i<100;i++){await page.keyboard.down('ArrowRight');await page.waitForFunction(n=>window.__componentPerf.samples.length===n&&window.__componentPerf.twoRaf.length===n,i+1);}
  await finish(page,'node',before);await page.keyboard.up('ArrowRight');await page.keyboard.up('Control');expect(await page.evaluate(async(id)=>{const {getDocument}=await import('/src/'+'state/documentStore.ts');const l=getDocument().project.layers[id];return l.type==='panel'?l.geometry[0].x:-1;},f.id)).toBe(101);
});
test('100 trusted vertex drag previews keep main layer and history untouched',async({page})=>{
  await scene(page);const box=(await page.getByRole('application',{name:'页面编辑画布'}).boundingBox())!;const point={x:box.x+40,y:box.y+30};await page.keyboard.down('Control');await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+8,point.y+4);await page.waitForTimeout(50);const before=await page.evaluate(async()=>(await import('/src/'+'state/documentStore.ts')).getDocument().history.past.length);await start(page,'pointer');
  for(let i=0;i<100;i++){await page.mouse.move(point.x+8+(i%8),point.y+4+(i%3));await page.waitForFunction(n=>window.__componentPerf.samples.length===n&&window.__componentPerf.twoRaf.length===n,i+1);}
  await finish(page,'vertex',before);await page.mouse.up();await page.keyboard.up('Control');expect(await page.evaluate(async()=>(await import('/src/'+'state/documentStore.ts')).getDocument().history.past.length)).toBe(before+1);
});
test('100 trusted slider changes use only preview layers',async({page})=>{
  await scene(page);const range=page.getByLabel('填充色透明度',{exact:true});await range.scrollIntoViewIfNeeded();const box=(await range.boundingBox())!;await page.mouse.move(box.x+12,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+25,box.y+box.height/2);await page.waitForTimeout(60);const before=await page.evaluate(async()=>(await import('/src/'+'state/documentStore.ts')).getDocument().history.past.length);await start(page,'pointer');
  for(let i=0;i<100;i++){await page.mouse.move(box.x+18+(i%20)*3,box.y+box.height/2);await page.waitForFunction(n=>window.__componentPerf.samples.length===n&&window.__componentPerf.twoRaf.length===n,i+1);}
  await finish(page,'opacity',before);await page.mouse.up();expect(await page.evaluate(async()=>(await import('/src/'+'state/documentStore.ts')).getDocument().history.past.length)).toBe(before+1);
});
test('100 trusted component preview moves preserve painting order and main layer',async({page})=>{
  await scene(page);const tile=page.getByRole('button',{name:'矩形分镜',exact:true}),b=(await tile.boundingBox())!,canvas=(await page.getByRole('application',{name:'页面编辑画布'}).boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(canvas.x+200,canvas.y+180);await page.waitForTimeout(60);const before=await page.evaluate(async()=>(await import('/src/'+'state/documentStore.ts')).getDocument().history.past.length);await start(page,'pointer');
  for(let i=0;i<100;i++){await page.mouse.move(canvas.x+205+(i%9)*2,canvas.y+180+(i%4));await page.waitForFunction(n=>window.__componentPerf.samples.length===n&&window.__componentPerf.twoRaf.length===n,i+1);}
  await finish(page,'component',before);await page.keyboard.press('Escape');await page.mouse.up();expect(await page.evaluate(async()=>(await import('/src/'+'state/documentStore.ts')).getDocument().history.past.length)).toBe(before);
});
test('100 trusted hover samples cause no Canvas drawing',async({page})=>{
  await scene(page);const b=(await page.getByRole('application',{name:'页面编辑画布'}).boundingBox())!,x=b.x+65,y=b.y+50;await page.mouse.move(x,y);await expect(page.getByRole('region',{name:'快捷键参考',exact:true})).toBeVisible();const before=await page.evaluate(async()=>(await import('/src/'+'state/documentStore.ts')).getDocument().history.past.length);await start(page,'hover');
  for(let i=0;i<100;i++){await page.mouse.move(x+(i%3),y+(i%2));await page.waitForFunction(n=>window.__componentPerf.samples.length===n&&window.__componentPerf.twoRaf.length===n,i+1);}
  await finish(page,'hover',before);
});

test('first input includes preview activation and cache preparation',async({page})=>{
  const results:Record<string,number>={},commits:Record<string,number>={};
  for(const kind of ['node','vertex','opacity','component']as const){
    await scene(page);const canvas=(await page.getByRole('application',{name:'页面编辑画布'}).boundingBox())!;
    if(kind==='node'){await page.keyboard.press('g');await page.keyboard.down('Control');}
    if(kind==='vertex'){await page.keyboard.down('Control');await page.mouse.move(canvas.x+40,canvas.y+30);}
    if(kind==='opacity'){await page.getByLabel('填充色透明度',{exact:true}).scrollIntoViewIfNeeded();const b=(await page.getByLabel('填充色透明度',{exact:true}).boundingBox())!;await page.mouse.move(b.x+18,b.y+b.height/2);}
    if(kind==='component'){const b=(await page.getByRole('button',{name:'矩形分镜',exact:true}).boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);}
    await page.evaluate(async kind=>{
      const runtime=(await import('/src/'+'state/runtimeStore.ts')).runtimeStore,{currentCreation}=await import('/src/'+'library/creationController.ts');
      const data={start:0,elapsed:0,trusted:0},context=document.querySelectorAll<HTMLCanvasElement>('.konvajs-content canvas')[kind==='component'?2:1].getContext('2d')!,original=context.restore,eventName=kind==='node'?'keydown':'pointerdown';
      const capture=(e:Event)=>{if(!e.isTrusted||data.start||kind==='node'&&(!(e instanceof KeyboardEvent)||e.key!=='ArrowRight'))return;data.start=performance.now();data.trusted++;};
      context.restore=function(){original.call(context);if(data.start&&!data.elapsed&&(kind==='component'?!!currentCreation():!!runtime.getState().previewProject))queueMicrotask(()=>{if(!data.elapsed)data.elapsed=performance.now()-data.start;});};
      (window as any).__coldComponent={data,stop:()=>{context.restore=original;window.removeEventListener(eventName,capture,true);}};window.addEventListener(eventName,capture,true);
    },kind);
    if(kind==='node')await page.keyboard.down('ArrowRight');else{await page.mouse.down();if(kind==='vertex')await page.mouse.move(canvas.x+48,canvas.y+34);if(kind==='opacity'){const b=(await page.getByLabel('填充色透明度',{exact:true}).boundingBox())!;await page.mouse.move(b.x+28,b.y+b.height/2);}if(kind==='component')await page.mouse.move(canvas.x+200,canvas.y+180);}
    await page.waitForFunction(()=>(window as any).__coldComponent.data.elapsed>0);const result=await page.evaluate(()=>{const state=(window as any).__coldComponent;state.stop();return state.data;});expect(result.trusted).toBe(1);expect(result.elapsed).toBeLessThan(100);results[kind]=result.elapsed;
    await page.evaluate(kind=>{
      const data={start:0,elapsed:0,trusted:0},context=document.querySelectorAll<HTMLCanvasElement>('.konvajs-content canvas')[0].getContext('2d')!,original=context.restore,eventName=kind==='node'?'keyup':'pointerup';
      const capture=(e:Event)=>{if(!e.isTrusted||data.start||kind==='node'&&(!(e instanceof KeyboardEvent)||e.key!=='ArrowRight'))return;data.start=performance.now();data.trusted++;};
      context.restore=function(){original.call(context);if(data.start&&!data.elapsed)queueMicrotask(()=>{if(!data.elapsed)data.elapsed=performance.now()-data.start;});};
      (window as any).__commitComponent={data,stop:()=>{context.restore=original;window.removeEventListener(eventName,capture,true);}};window.addEventListener(eventName,capture,true);
    },kind);
    if(kind==='node'){await page.keyboard.up('ArrowRight');await page.keyboard.up('Control');}else{await page.mouse.up();if(kind==='vertex')await page.keyboard.up('Control');}
    await page.waitForFunction(()=>(window as any).__commitComponent.data.elapsed>0);const committed=await page.evaluate(()=>{const state=(window as any).__commitComponent;state.stop();return state.data;});expect(committed.trusted).toBe(1);expect(committed.elapsed).toBeLessThan(100);commits[kind]=committed.elapsed;
  }
  const dpr=await page.evaluate(()=>devicePixelRatio);await mkdir('output/audit/component-performance',{recursive:true});await writeFile(`output/audit/component-performance/activation-dpr${dpr}.json`,JSON.stringify({dpr,results,commits,metric:'first trusted keydown/pointerdown through activation and actual preview Canvas drawing completion; commits measure trusted keyup/pointerup to main Canvas drawing completion, separately; no warm cache exclusion; pointer activation includes the interval before the first automated pointermove; browser performance.now clock, excluding outer tool-call duration and GPU scanout'},null,2));
});
