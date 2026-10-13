import { expect, test } from '@playwright/test';
import os from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { initHandBubble } from './handBubbleHelpers';

test('paint preview keeps 1000 static panels cached, history unchanged and native tile memory bounded',async({page})=>{
  test.setTimeout(180000);await initHandBubble(page);await page.evaluate(async()=>{
    const f=await import('/src/'+'domain/factories.ts'),p=f.createProject(),pid=p.pageOrder[0];Object.assign(p.pages[pid],{width:1024,height:768,dpi:72});
    for(let i=0;i<1000;i++){const l=f.createLayer('panel',pid);if(l.type!=='panel')throw Error('panel');const x=(i%40)*25,y=Math.floor(i/40)*25;l.geometry=[{x,y},{x:x+20,y},{x:x+20,y:y+20},{x,y:y+20}];p.layers[l.id]=l;p.pages[pid].roots.push(l.id);}
    const n=(await import('/src/'+'panels/numbering.ts')).assignNewPanelNumbers(p,p.pages[pid].roots.filter((id:string)=>p.layers[id].type==='panel'));if(!n.ok)throw Error(JSON.stringify(n));const r=(await import('/src/'+'history/commandBus.ts')).replaceDocument(p);if(!r.ok)throw Error(JSON.stringify(r));
    (await import('/src/'+'state/sessionStore.ts')).sessionStore.setState({activePageId:pid,selection:[],scopeId:null,toolMode:'select',viewportByPage:{[pid]:{zoom:.75,pan:{x:20,y:20}}}});
    const create=(await import('/src/'+'comicDrawing/commands.ts')).createComicLayer('raster');if(!create.ok)throw Error(JSON.stringify(create));
  });
  const v=await page.evaluate(async()=>{const s=(await import('/src/'+'state/sessionStore.ts')).sessionStore.getState(),r=document.querySelector('.canvas-viewport')!.getBoundingClientRect();return {...s.viewportByPage[s.activePageId],x:r.x,y:r.y};});
  const at=(x:number,y:number)=>({x:v.x+v.pan.x+x*v.zoom,y:v.y+v.pan.y+y*v.zoom});const first=at(100,650);await page.mouse.move(first.x,first.y);await page.mouse.down();
  await page.evaluate(async()=>{(await import('/src/'+'freehand/metrics.ts')).resetDrawingMetrics();(await import('/src/'+'state/runtimeStore.ts')).resetRenderStats();(window as any).__comicBaseline=(await import('/src/'+'state/documentStore.ts')).getDocument();});
  for(let i=1;i<=120;i++){const p=at(100+i*3,650+20*Math.sin(i/10));await page.mouse.move(p.x,p.y);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));}
  const measured=await page.evaluate(async()=>{const m=(await import('/src/'+'freehand/metrics.ts')).drawingMetrics,r=(await import('/src/'+'state/runtimeStore.ts')).runtimeStore.getState(),d=(await import('/src/'+'state/documentStore.ts')).getDocument(),b=(window as any).__comicBaseline,c=(await import('/src/'+'comicDrawing/paint.ts')).paintCacheStats();return{inputs:[...m.inputs],frames:[...m.frames],stats:r.renderStats,stable:d.project===b.project&&d.history.stateId===b.history.stateId,cache:c,dpr:devicePixelRatio,ua:navigator.userAgent};});
  await page.mouse.up();const commits=await page.evaluate(async()=>[...(await import('/src/'+'freehand/metrics.ts')).drawingMetrics.commits]);const p95=(a:number[])=>a.slice(10).sort((a,b)=>a-b)[Math.ceil((a.length-10)*.95)-1];
  await mkdir('output/comic-drawing',{recursive:true});await writeFile(`output/comic-drawing/performance-dpr${measured.dpr}.json`,JSON.stringify({...measured,commits,p95:{input:p95(measured.inputs),preview:p95(measured.frames)},device:{os:`${os.platform()} ${os.release()}`,cpu:os.cpus()[0].model,memoryBytes:os.totalmem()},scene:'1000 independent panels + paper + native raster drawing; 1024x768 page; 1440x900 viewport; 120 trusted moves',metric:'JS input + ordered preview draw, excludes IPC/GPU; first ten samples warm up'},null,2));
  expect(measured.stable).toBe(true);expect(measured.stats.mainDraws).toBe(0);expect(measured.stats.gestureDraws).toBeGreaterThanOrEqual(100);expect(measured.inputs.length).toBeGreaterThanOrEqual(100);expect(measured.cache.bytes).toBeLessThanOrEqual(64*1024*1024);expect(commits).toHaveLength(1);expect(p95(measured.frames)).toBeLessThan(16.7);
});
