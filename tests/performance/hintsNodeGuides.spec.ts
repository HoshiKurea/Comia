import {test,expect,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import type {Project,PanelLayer,ImageLayer} from '../../src/domain/types';
interface GuidePerf {pending:number;trusted:number;samples:number[];twoRaf:number[];nativeLatency:number[];updateStart:number;lastLabel:string}
declare global {interface Window {__guidePerf:GuidePerf;__stopGuidePerf:()=>void}}
async function scene(page:Page){await page.goto('/');return page.evaluate(async()=>{
  const {createProject,createLayer}=await import('/src/'+'domain/factories.ts'),{replaceDocument,execute}=await import('/src/'+'history/commandBus.ts'),{sessionStore}=await import('/src/'+'state/sessionStore.ts'),{decodeImage}=await import('/src/'+'assets/importImage.ts'),{addLibraryAssets}=await import('/src/'+'assets/libraryCommands.ts'),{capturePanelTemplate}=await import('/src/'+'library/templates.ts');
  const p=createProject(),pid=p.pageOrder[0];Object.assign(p.pages[pid],{width:900,height:1300});if(!replaceDocument(p).ok)throw Error('project');sessionStore.setState({activePageId:pid,viewportByPage:{[pid]:{zoom:.5,pan:{x:30,y:20}}}});
  const c=document.createElement('canvas');c.width=80;c.height=60;const ctx=c.getContext('2d')!;ctx.fillStyle='#c67550';ctx.fillRect(0,0,80,60);const blob=await new Promise<Blob>(r=>c.toBlob(b=>r(b!),'image/png'));const decoded=await decodeImage(new File([blob],'性能素材.png',{type:'image/png'}),new AbortController().signal);if(!decoded.ok)throw Error('decode');const assets=addLibraryAssets([decoded.value]);if(!assets.ok)throw Error('asset');const aid=assets.value[0],ids:string[]=[];
  const built=execute({label:'性能场景',context:{pageId:pid,selection:[]},mutate(d:Project){for(let i=0;i<50;i++){const panel=createLayer('panel',pid) as PanelLayer;panel.geometry=[{x:0,y:0},{x:130,y:0},{x:130,y:90},{x:0,y:90}];panel.matrix=[1,0,0,1,20+i%5*150,20+Math.floor(i/5)*110];ids.push(panel.id);d.layers[panel.id]=panel;d.pages[pid].roots.push(panel.id);for(let j=0;j<2;j++){const image=createLayer('image',pid) as ImageLayer;image.assetId=aid;image.width=80;image.height=60;image.parentId=panel.id;image.matrix=[.5,0,0,.5,10+j*35,15];d.layers[image.id]=image;panel.children.push(image.id);}}}});if(!built.ok)throw Error(built.problems[0].message);
  for(let i=0;i<20;i++){const r=capturePanelTemplate(ids[i],`性能预设 ${i}`);if(!r.ok)throw Error(r.problems[0].message);}
  const {createAssetFolder,moveLibraryAssets}=await import('/src/'+'assets/folderCommands.ts');const a=createAssetFolder('场景',null);if(!a.ok)throw Error('folder');const b=createAssetFolder('背景',a.value);if(!b.ok)throw Error('subfolder');moveLibraryAssets([aid],b.value);sessionStore.setState({selection:[ids[0]],toolMode:'select'});await document.fonts.ready;return{pid,id:ids[0]};
});}
async function start(page:Page,kind:'node'|'hover'|'layout'){
  await page.evaluate(async kind=>{
    const {resetRenderStats}=await import('/src/'+'state/runtimeStore.ts');await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));resetRenderStats();
    const d:GuidePerf={pending:0,trusted:0,samples:[],twoRaf:[],nativeLatency:[],updateStart:0,lastLabel:''};window.__guidePerf=d;
    const capture=(e:Event)=>{if(!e.isTrusted||!(e instanceof PointerEvent))return;if(kind==='hover'){const tile=(e.target as Element).closest('.library-tile');if(!tile)return;const label=tile.getAttribute('aria-label')??'';if(!label||label===d.lastLabel)return;d.lastLabel=label;}else if(!e.buttons)return;
      const now=performance.now();d.trusted++;d.pending=now;if(kind!=='hover')requestAnimationFrame(()=>requestAnimationFrame(()=>d.twoRaf.push(performance.now()-now)));
    };
    const name=kind==='hover'?'pointerover':'pointermove';window.addEventListener(name,capture,true);
    const stop:(()=>void)[]=[()=>window.removeEventListener(name,capture,true)];
    if(kind==='node'){
      const contexts=Array.from(document.querySelectorAll<HTMLCanvasElement>('.konvajs-content canvas')).slice(1,3).map(c=>c.getContext('2d')!);
      for(const c of contexts){const old=c.restore;c.restore=function(){old.call(c);if(d.pending)queueMicrotask(()=>{if(d.pending){d.samples.push(performance.now()-d.pending);d.pending=0;}});};stop.push(()=>{c.restore=old;});}
    }else if(kind==='layout'){
      const ghost=document.querySelector('[data-testid=panel-drag-ghost]')!;
      const observer=new MutationObserver(()=>{if(d.pending){d.samples.push(performance.now()-d.pending);d.pending=0;}});observer.observe(ghost,{attributes:true,attributeFilter:['style']});stop.push(()=>observer.disconnect());
    }else{
      const {hintReferenceStore}=await import('/src/'+'app/ElementHintPanel.tsx'),old=hintReferenceStore.setState;
      hintReferenceStore.setState=((...args:Parameters<typeof old>)=>{d.updateStart=performance.now();old(...args);}) as typeof old;
      stop.push(()=>{hintReferenceStore.setState=old;});
      const root=document.querySelector('[aria-label="快捷键参考"]')!;
      const observer=new MutationObserver(()=>{const label=root.querySelector('.element-hint-heading strong')?.textContent;if(d.pending&&d.updateStart&&label===d.lastLabel){const now=performance.now(),begin=d.updateStart;d.samples.push(now-begin);d.nativeLatency.push(now-d.pending);d.pending=0;d.updateStart=0;requestAnimationFrame(()=>requestAnimationFrame(()=>d.twoRaf.push(performance.now()-begin)));}});observer.observe(root,{subtree:true,childList:true,characterData:true});stop.push(()=>observer.disconnect());
    }
    window.__stopGuidePerf=()=>stop.forEach(fn=>fn());
  },kind);
}
async function history(page:Page){return page.evaluate(async()=>(await import('/src/'+'state/documentStore.ts')).getDocument().history.past.length);}
async function finish(page:Page,name:'node'|'hover'|'layout',before:number){
  const result=await page.evaluate(async()=>{window.__stopGuidePerf();return{...window.__guidePerf,stats:(await import('/src/'+'state/runtimeStore.ts')).runtimeStore.getState().renderStats,historyAfter:(await import('/src/'+'state/documentStore.ts')).getDocument().history.past.length,dpr:devicePixelRatio,userAgent:navigator.userAgent};});
  const sorted=[...result.samples].sort((a,b)=>a-b);await mkdir('output/audit/hints-node-performance',{recursive:true});await writeFile(`output/audit/hints-node-performance/${name}-dpr${result.dpr}.json`,JSON.stringify({...result,historyBefore:before,p50:sorted[49],p95:sorted[94],maximum:Math.max(...sorted),rafMaximum:Math.max(...result.twoRaf),scene:'50 independent panels, 100 real decoded image instances, 20 scene presets, nested material folders; 1440x900',metric:name==='hover'?'actual reference store update start to MutationObserver after matching heading/rows update; nativeLatency separately includes intentional180ms dwell; two rAF measured from same store update start':name==='layout'?'trusted native pointermove to MutationObserver after drag ghost style update; two rAF separate':'trusted native pointermove to microtask after gesture/overlay Canvas restore and synchronous drawing complete; two rAF separate',warmup:'actual gesture/reference/cache activation before100 distinct measured events; cold input and release measured separately; no RPC or GPU scanout timing'},null,2));
  expect(result.trusted).toBe(100);expect(sorted).toHaveLength(100);expect(result.twoRaf).toHaveLength(100);expect(Math.max(...sorted)).toBeLessThan(100);expect(Math.max(...result.twoRaf)).toBeLessThan(100);expect(result.stats.mainDraws).toBe(0);if(name!=='node')expect(result.stats).toEqual({mainDraws:0,gestureDraws:0,overlayDraws:0});expect(result.historyAfter).toBe(before);if(name==='hover'){expect(result.nativeLatency).toHaveLength(100);expect(Math.min(...result.nativeLatency)).toBeGreaterThanOrEqual(170);}
}
test('100 native magnetic node previews preserve paint order and atomic history',async({page})=>{
  const f=await scene(page),box=(await page.getByRole('application',{name:'页面编辑画布'}).boundingBox())!,point={x:box.x+40,y:box.y+30};
  const original=await page.evaluate(async id=>structuredClone((await import('/src/'+'state/documentStore.ts')).getDocument().project.layers[id]),f.id);
  await page.keyboard.down('Control');await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+8,point.y+4);await page.waitForFunction(async()=>(await import('/src/'+'state/runtimeStore.ts')).runtimeStore.getState().previewProject!==null);const before=await history(page);await start(page,'node');
  for(let i=0;i<100;i++){await page.mouse.move(point.x+8+i%8,point.y+4+i%3);await page.waitForFunction(n=>window.__guidePerf.samples.length===n&&window.__guidePerf.twoRaf.length===n,i+1);}
  await finish(page,'node',before);await page.mouse.up();await page.keyboard.up('Control');expect(await history(page)).toBe(before+1);const after=await page.evaluate(async id=>structuredClone((await import('/src/'+'state/documentStore.ts')).getDocument().project.layers[id]),f.id);if(after.type!=='panel'||original.type!=='panel')throw Error('panel');expect(after.geometry.slice(1)).toEqual(original.geometry.slice(1));expect(after.geometry[0].y).toBe(0);
});
test('100 distinct native hovers update the docked reference without drawing Canvas',async({page})=>{
  await scene(page);await page.getByRole('button',{name:'矩形分镜',exact:true}).hover();await expect(page.getByRole('region',{name:'快捷键参考'})).toContainText('矩形分镜');const before=await history(page);await start(page,'hover');
  for(let i=0;i<100;i++){await page.getByRole('button',{name:i%2?'矩形分镜':'圆角分镜',exact:true}).hover();await page.waitForFunction(n=>window.__guidePerf.samples.length===n&&window.__guidePerf.twoRaf.length===n,i+1);}
  await finish(page,'hover',before);
});
test('100 native reference panel drag previews keep layout/document unchanged until release',async({page})=>{
  await scene(page);const tab=(await page.getByRole('tab',{name:'快捷键提示',exact:true}).boundingBox())!,root=(await page.locator('.panel-workspace').boundingBox())!;const layout=await page.evaluate(async()=>structuredClone((await import('/src/'+'workspacePanels/panelLayoutStore.ts')).panelLayoutStore.getState().layout));
  await page.mouse.move(tab.x+20,tab.y+15);await page.mouse.down();await page.mouse.move(root.x+510,root.y+148);await expect(page.getByTestId('panel-drag-ghost')).toBeVisible();const before=await history(page);await start(page,'layout');
  for(let i=0;i<100;i++){await page.mouse.move(root.x+520+i%9*2,root.y+150+i%4);await page.waitForFunction(n=>window.__guidePerf.samples.length===n&&window.__guidePerf.twoRaf.length===n,i+1);}
  await finish(page,'layout',before);expect(await page.evaluate(async()=>(await import('/src/'+'workspacePanels/panelLayoutStore.ts')).panelLayoutStore.getState().layout)).toEqual(layout);await page.keyboard.press('Escape');await page.mouse.up();expect(await history(page)).toBe(before);expect(await page.evaluate(async()=>(await import('/src/'+'workspacePanels/panelLayoutStore.ts')).panelLayoutStore.getState().layout)).toEqual(layout);
});
test('first magnetic preview and panel activation and actual releases are measured separately',async({page})=>{
  const readings:Record<string,{trusted:number;elapsed:number}>={};
  for(const kind of ['node','layout']as const){
    await scene(page);const canvas=(await page.getByRole('application',{name:'页面编辑画布'}).boundingBox())!,tab=(await page.getByRole('tab',{name:'快捷键提示',exact:true}).boundingBox())!,root=(await page.locator('.panel-workspace').boundingBox())!;
    if(kind==='node')await page.keyboard.down('Control');await page.mouse.move(kind==='node'?canvas.x+40:tab.x+20,kind==='node'?canvas.y+30:tab.y+15);
    await page.evaluate(async kind=>{
      const d={start:0,elapsed:0,trusted:0},release={start:0,elapsed:0,trusted:0},capture=(e:PointerEvent)=>{if(e.isTrusted&&!d.start){d.start=performance.now();d.trusted++;}},up=(e:PointerEvent)=>{if(e.isTrusted&&!release.start){release.start=performance.now();release.trusted++;}};window.addEventListener('pointerdown',capture,true);window.addEventListener('pointerup',up,true);(window as any).__guideRelease={d:release,stop:()=>window.removeEventListener('pointerup',up,true)};let stop=()=>{};
      if(kind==='node'){const {runtimeStore}=await import('/src/'+'state/runtimeStore.ts');const c=document.querySelectorAll<HTMLCanvasElement>('.konvajs-content canvas')[1].getContext('2d')!,old=c.restore;c.restore=function(){old.call(c);if(d.start&&!d.elapsed&&runtimeStore.getState().previewProject)queueMicrotask(()=>{if(!d.elapsed)d.elapsed=performance.now()-d.start;});};stop=()=>{c.restore=old;};}
      else{const observer=new MutationObserver(()=>{const ghost=document.querySelector<HTMLElement>('[data-testid=panel-drag-ghost]');if(ghost&&!ghost.hidden&&d.start&&!d.elapsed)d.elapsed=performance.now()-d.start;});observer.observe(document.querySelector('.panel-workspace')!,{subtree:true,childList:true,attributes:true,attributeFilter:['style','hidden']});stop=()=>observer.disconnect();}
      (window as any).__guideCold={d,stop:()=>{stop();window.removeEventListener('pointerdown',capture,true);}};
    },kind);
    await page.mouse.down();await page.mouse.move(kind==='node'?canvas.x+48:root.x+520,kind==='node'?canvas.y+34:root.y+150);await page.waitForFunction(()=>(window as any).__guideCold.d.elapsed>0);readings[`${kind}Activation`]=await page.evaluate(()=>{const p=(window as any).__guideCold;p.stop();return p.d;});
    await page.evaluate(async kind=>{
      const registered=(window as any).__guideRelease,d=registered.d as {start:number;elapsed:number;trusted:number};let stop=()=>{};
      if(kind==='node'){const c=document.querySelectorAll<HTMLCanvasElement>('.konvajs-content canvas')[0].getContext('2d')!,old=c.restore;c.restore=function(){old.call(c);if(d.start&&!d.elapsed)queueMicrotask(()=>{if(!d.elapsed)d.elapsed=performance.now()-d.start;});};stop=()=>{c.restore=old;};}
      else{const {panelLayoutStore}=await import('/src/'+'workspacePanels/panelLayoutStore.ts');stop=panelLayoutStore.subscribe(()=>{if(d.start&&!d.elapsed)queueMicrotask(()=>{if(!d.elapsed)d.elapsed=performance.now()-d.start;});});}
      (window as any).__guideCold={d,stop:()=>{stop();registered.stop();}};
    },kind);
    await page.mouse.up();if(kind==='node')await page.keyboard.up('Control');await page.waitForFunction(()=>(window as any).__guideCold.d.elapsed>0);readings[`${kind}Release`]=await page.evaluate(()=>{const p=(window as any).__guideCold;p.stop();return p.d;});
  }
  const dpr=await page.evaluate(()=>devicePixelRatio);await mkdir('output/audit/hints-node-performance',{recursive:true});await writeFile(`output/audit/hints-node-performance/activation-dpr${dpr}.json`,JSON.stringify({dpr,readings,metric:'trusted pointerdown to actual gesture Canvas draw or panel ghost DOM update; release pointerup to main Canvas draw/node or committed layout store notification/panel; first movement interval included; no RPC or GPU scanout'},null,2));for(const value of Object.values(readings)){expect(value.trusted).toBe(1);expect(value.elapsed).toBeGreaterThan(0);expect(value.elapsed).toBeLessThan(100);}
});
