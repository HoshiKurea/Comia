import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { InkSample, InkStroke, Mat, Point, Rect, Result } from '../domain/types';
import { newId } from '../domain/id';
import { FocusDialog } from '../app/FocusDialog';
import { apply, inverse, multiply, scaling, translation } from '../geometry/matrix';
import { documentStore } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { DRAWING_LIMITS } from './model';
import { recordDrawingInput, recordDrawingFrame, recordDrawingCommit } from './metrics';
import { paintInkStroke, replayMaterial } from './material';
import { commitDrawingSession, prepareDrawingCommit } from './commit';
import { addDrawingObject, cancelDrawingWindow, commitDrawingStroke, currentDrawingSession, deleteDrawingObject, drawingWindowStore, selectDrawingObject, sessionCurrent, setDrawingBoard, travelDrawingHistory, updateDrawingObject, type DrawingObject } from './session';
import './drawingWindow.css';

type PaintTool='pen'|'eraser'|'move';
interface View { scale:number;x:number;y:number;width:number;height:number }
interface Gesture {pointerId:number;object:DrawingObject;start:Point;stroke:InkStroke;mode:'ink';matrix:Mat|null;resize:boolean;bounds:Rect;time:number;view:View;smoothing:number}
function NumberField({label,value,min=0,max=4096,step=1,apply:accept}:{label:string;value:number;min?:number;max?:number;step?:number;apply:(n:number)=>void}){
  const [draft,setDraft]=useState(String(value));useEffect(()=>setDraft(String(Math.round(value*1000)/1000)),[value]);
  return <label className="drawing-field"><span>{label}</span><input aria-label={label} type="number" min={min} max={max} step={step} value={draft} onChange={e=>setDraft(e.target.value)} onBlur={()=>{const n=Number(draft);if(draft.trim()&&Number.isFinite(n)&&n>=min&&n<=max)accept(n);else setDraft(String(value));}} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}if(e.key==='Escape'){e.stopPropagation();setDraft(String(value));e.currentTarget.blur();}}}/></label>;
}
function ColorField({label,value,apply:accept}:{label:string;value:string;apply:(s:string)=>void}){
  const [draft,setDraft]=useState(value);useEffect(()=>setDraft(value),[value]);
  return <div className="drawing-color"><label>{label}<input aria-label={label} type="color" value={draft.slice(0,7)} onChange={e=>setDraft(e.target.value.toUpperCase()+draft.slice(7))} onBlur={()=>accept(draft)}/></label><NumberField label={`${label}透明度 %`} value={parseInt(draft.slice(7),16)/255*100} max={100} apply={n=>{const next=draft.slice(0,7)+Math.round(n*255/100).toString(16).padStart(2,'0').toUpperCase();setDraft(next);accept(next);}}/></div>;
}
function objectBounds(o:DrawingObject):Rect{return{x:0,y:0,width:o.source.width,height:o.source.height};}
export function DrawingWindow(){
  const session=useStore(drawingWindowStore,s=>s.active);if(!session)return null;
  return <DrawingWindowContent key={`${session.projectId}-${session.targetId??'new'}-${session.stateId}`}/>;
}
function DrawingWindowContent(){
  const a=useStore(drawingWindowStore,s=>s.active)!,active=a.objects.find(o=>o.id===a.activeId);
  const [tool,setTool]=useState<PaintTool>('pen'),[width,setWidth]=useState(24),[opacity,setOpacity]=useState(100),[color,setColor]=useState('#202020FF'),[smooth,setSmooth]=useState(.25),[error,setError]=useState(''),[busy,setBusy]=useState(false),[zoom,setZoom]=useState(1),[stale,setStale]=useState(false),[confirmCancel,setConfirmCancel]=useState(false),[offset,setOffset]=useState({x:0,y:0});
  const host=useRef<HTMLDivElement>(null),base=useRef<HTMLCanvasElement>(null),live=useRef<HTMLCanvasElement>(null),above=useRef<HTMLCanvasElement>(null),preview=useRef<HTMLCanvasElement>(null),liveBase=useRef<HTMLCanvasElement|null>(null),scratch=useRef<HTMLCanvasElement|null>(null),view=useRef<View>({scale:1,x:0,y:0,width:1,height:1}),gesture=useRef<Gesture|null>(null),raf=useRef(0),controller=useRef<AbortController|null>(null),materialCache=useRef(new Map<object,HTMLCanvasElement>()),dragWindow=useRef<{x:number;y:number;offset:Point}|null>(null);
  const report=(r:Result<unknown>)=>{if(!r.ok)setError(r.problems.map(p=>p.message).join('；'));else setError('');};
  const clearStroke=()=>{gesture.current=null;drawObjects();preview.current?.getContext('2d')?.clearRect(0,0,preview.current.width,preview.current.height);};
  const close=()=>{if(gesture.current){clearStroke();return;}if(busy){controller.current?.abort();return;}if(currentDrawingSession()?.dirty){setConfirmCancel(true);return;}cancelDrawingWindow();};
  useEffect(()=>{gesture.current=null;drawObjects();setTool('pen');requestDraw();},[active?.id]);
  useEffect(()=>{const check=()=>setStale(!sessionCurrent(a));const first=documentStore.subscribe(check),second=sessionStore.subscribe(check);return()=>{first();second();};},[a.projectId,a.epoch,a.stateId,a.pageId]);
  useEffect(()=>{const blur=()=>{gesture.current=null;drawObjects();requestDraw();};window.addEventListener('blur',blur);return()=>{window.removeEventListener('blur',blur);cancelAnimationFrame(raf.current);raf.current=0;controller.current?.abort();for(const c of [...materialCache.current.values(),liveBase.current,scratch.current])if(c)c.width=c.height=0;materialCache.current.clear();};},[]);
  function drawObjects(){
    const canvas=base.current;if(!canvas||!above.current||!live.current)return;const background=canvas.getContext('2d'),foreground=above.current.getContext('2d');if(!background||!foreground)return;const v=view.current,dpr=devicePixelRatio||1,s=currentDrawingSession();if(!s)return;
    if(!liveBase.current)liveBase.current=document.createElement('canvas');liveBase.current.width=canvas.width;liveBase.current.height=canvas.height;const isolated=liveBase.current.getContext('2d')!;
    for(const ctx of [background,foreground,isolated]){ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.setTransform(dpr*v.scale,0,0,dpr*v.scale,dpr*v.x,dpr*v.y);ctx.save();ctx.beginPath();ctx.rect(0,0,s.width,s.height);ctx.clip();}
    live.current.getContext('2d')!.clearRect(0,0,canvas.width,canvas.height);const splitting=!!gesture.current&&!gesture.current.matrix;let passed=false;
    for(const original of s.objects){if(!original.visible)continue;const selected=splitting&&original.id===s.activeId,ctx=selected?isolated:passed?foreground:background;if(selected)passed=true;const o=gesture.current?.object.id===original.id&&gesture.current.matrix?{...original,matrix:gesture.current.matrix}:original;ctx.save();ctx.transform(...o.matrix);
        let cache=materialCache.current.get(o.source);if(!cache){let bytes=[...materialCache.current.values()].reduce((n,c)=>n+c.width*c.height*4,0);for(const [key,c] of materialCache.current){if(bytes+o.source.width*o.source.height*4<=64*1024*1024)break;bytes-=c.width*c.height*4;materialCache.current.delete(key);c.width=c.height=0;}cache=document.createElement('canvas');cache.width=o.source.width;cache.height=o.source.height;const replay=replayMaterial(o.source,cache);if(replay.ok){materialCache.current.set(o.source,cache);}else{cache.width=cache.height=0;ctx.restore();continue;}}
        ctx.drawImage(cache,0,0);

      ctx.restore();
    }
    for(const ctx of [background,foreground,isolated])ctx.restore();background.strokeStyle='#7E8A85';background.lineWidth=1/v.scale;background.strokeRect(0,0,s.width,s.height);
    let cacheBytes=[...materialCache.current.values()].reduce((n,c)=>n+c.width*c.height*4,0);for(const [key,c] of materialCache.current){if(cacheBytes<=64*1024*1024)break;if(key===s.objects.find(o=>o.id===s.activeId)?.source)continue;cacheBytes-=c.width*c.height*4;materialCache.current.delete(key);c.width=c.height=0;}
  }
  function drawPreview(){
    const canvas=preview.current;if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;const dpr=devicePixelRatio||1,v=view.current,s=currentDrawingSession();if(!s)return;
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.setTransform(dpr*v.scale,0,0,dpr*v.scale,dpr*v.x,dpr*v.y);
    const o=s.objects.find(o=>o.id===s.activeId);if(o){ctx.save();ctx.transform(...(gesture.current?.matrix??o.matrix));const b=objectBounds(o);ctx.strokeStyle='#C4522B';ctx.lineWidth=1/v.scale;ctx.setLineDash([4/v.scale,3/v.scale]);ctx.strokeRect(b.x,b.y,b.width,b.height);ctx.setLineDash([]);ctx.fillStyle='#FFFFFF';ctx.fillRect(b.x+b.width-4/v.scale,b.y+b.height-4/v.scale,8/v.scale,8/v.scale);ctx.strokeRect(b.x+b.width-4/v.scale,b.y+b.height-4/v.scale,8/v.scale,8/v.scale);
      ctx.restore();}
    const g=gesture.current,layer=live.current,original=liveBase.current;if(g&&!g.matrix&&layer&&original){const paint=layer.getContext('2d')!;paint.setTransform(1,0,0,1,0,0);paint.clearRect(0,0,layer.width,layer.height);paint.drawImage(original,0,0);
      if(!scratch.current)scratch.current=document.createElement('canvas');const ink=scratch.current;if(ink.width!==layer.width||ink.height!==layer.height){ink.width=layer.width;ink.height=layer.height;}const brush=ink.getContext('2d')!;brush.setTransform(1,0,0,1,0,0);brush.clearRect(0,0,ink.width,ink.height);brush.setTransform(dpr*v.scale,0,0,dpr*v.scale,dpr*v.x,dpr*v.y);brush.save();brush.beginPath();brush.rect(0,0,s.width,s.height);brush.clip();brush.transform(...g.object.matrix);brush.beginPath();brush.rect(0,0,g.object.source.width,g.object.source.height);brush.clip();const erasing=g.stroke.tool==='eraser',color=g.stroke.color;paintInkStroke(brush,{...g.stroke,color:erasing?'#000000FF':color.slice(0,7)+'FF'});brush.restore();paint.save();paint.globalAlpha=g.stroke.opacity*(erasing?1:parseInt(color.slice(7),16)/255);paint.globalCompositeOperation=erasing?'destination-out':'source-over';paint.drawImage(ink,0,0);paint.restore();}
  }
  function requestDraw(){if(!raf.current)raf.current=requestAnimationFrame(()=>{raf.current=0;const start=performance.now();if(gesture.current?.matrix)drawObjects();drawPreview();recordDrawingFrame(start);});}
  useLayoutEffect(()=>{const node=host.current;if(!node)return;const resize=()=>{gesture.current=null;const rect=node.getBoundingClientRect(),fit=Math.max(.02,Math.min((rect.width-32)/a.width,(rect.height-32)/a.height)),scale=fit*zoom,dpr=devicePixelRatio||1;view.current={scale,x:(rect.width-a.width*scale)/2,y:(rect.height-a.height*scale)/2,width:rect.width,height:rect.height};for(const c of [base.current,live.current,above.current,preview.current])if(c){c.width=Math.round(rect.width*dpr);c.height=Math.round(rect.height*dpr);}drawObjects();drawPreview();};const observer=new ResizeObserver(resize);observer.observe(node);resize();return()=>observer.disconnect();},[a.width,a.height,zoom]);
  useEffect(()=>{drawObjects();drawPreview();},[a.objects,a.activeId]);
  const boardPoint=(x:number,y:number,v=view.current)=>{const r=host.current!.getBoundingClientRect();return{x:(x-r.left-v.x)/v.scale,y:(y-r.top-v.y)/v.scale};};
  const start=(e:React.PointerEvent<HTMLDivElement>)=>{
    if(e.button!==0||busy||stale||gesture.current||!active)return;if(!active.visible){setError('请先显示当前绘画对象再绘制');return;}const p=boardPoint(e.clientX,e.clientY);if(p.x<0||p.y<0||p.x>a.width||p.y>a.height)return;
    const inv=inverse(active.matrix);if(!inv.ok){report(inv);return;}const local=apply(inv.value,p),b=objectBounds(active);if(tool==='move'&&(local.x<b.x||local.x>b.x+b.width||local.y<b.y||local.y>b.y+b.height))return;
    const pressure=e.pointerType==='pen'&&e.pressure>0?e.pressure:.5;
    const stroke:InkStroke={id:newId(),tool:tool==='eraser'?'eraser':'pen',points:[{...local,pressure,dt:0}],width,color,opacity:opacity/100,pressureMode:e.pointerType==='pen'&&e.pressure>0?'pen':'fixed'};
    gesture.current={pointerId:e.pointerId,object:active,start:p,stroke,mode:'ink',matrix:tool==='move'?active.matrix:null,resize:tool==='move'&&Math.hypot(local.x-b.x-b.width,local.y-b.y-b.height)*view.current.scale<12,bounds:b,time:performance.now(),view:{...view.current},smoothing:smooth};
    setError('');e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();drawObjects();requestDraw();
  };
  const appendSamples=(e:React.PointerEvent<HTMLDivElement>)=>{
    const began=performance.now();
    const g=gesture.current;if(!g||g.pointerId!==e.pointerId)return;const p=boardPoint(e.clientX,e.clientY,g.view);
    if(g.matrix){if(g.resize){const inv=inverse(g.object.matrix);if(!inv.ok)return;const end=apply(inv.value,p),b=g.bounds;g.matrix=multiply(multiply(multiply(g.object.matrix,translation(b.x,b.y)),scaling(Math.max(.02,(end.x-b.x)/b.width),Math.max(.02,(end.y-b.y)/b.height))),translation(-b.x,-b.y));}else g.matrix=multiply(translation(p.x-g.start.x,p.y-g.start.y),g.object.matrix);requestDraw();return;}
    const inv=inverse(g.object.matrix);if(!inv.ok)return;
    const samples=e.nativeEvent.getCoalescedEvents?.()??[],events=samples.length?samples:[e.nativeEvent];
    for(const ev of events){if(g.stroke.points.length>=DRAWING_LIMITS.strokePoints){gesture.current=null;setError('单笔超过8192点，未保存这一笔；请缩短笔迹');requestDraw();return;}
      const local=apply(inv.value,boardPoint(ev.clientX,ev.clientY,g.view)),last=g.stroke.points.at(-1)!,alpha=1-.75*g.smoothing,q={x:alpha*local.x+(1-alpha)*last.x,y:alpha*local.y+(1-alpha)*last.y},delta=apply([g.object.matrix[0]*g.view.scale,g.object.matrix[1]*g.view.scale,g.object.matrix[2]*g.view.scale,g.object.matrix[3]*g.view.scale,0,0],{x:q.x-local.x,y:q.y-local.y}),length=Math.hypot(delta.x,delta.y),factor=length?Math.min(1,2*g.smoothing/length):1;
      const next:InkSample={x:local.x+(q.x-local.x)*factor,y:local.y+(q.y-local.y)*factor,pressure:ev.pressure>0?ev.pressure:last.pressure,dt:Math.max(0,performance.now()-g.time)};
      next.x=Math.max(0,Math.min(g.object.source.width,next.x));next.y=Math.max(0,Math.min(g.object.source.height,next.y));
      if(Math.hypot(next.x-last.x,next.y-last.y)>1e-6)g.stroke.points.push(next);
    }requestDraw();recordDrawingInput(began);
  };
  const finish=(e:React.PointerEvent<HTMLDivElement>)=>{
    const began=performance.now();
    const g=gesture.current;if(!g||g.pointerId!==e.pointerId)return;if(currentDrawingSession()?.activeId!==g.object.id){clearStroke();return;}appendSamples(e);if(!gesture.current)return;gesture.current=null;
    if(g.matrix)report(updateDrawingObject(g.object.id,{matrix:g.matrix}));
    else report(commitDrawingStroke(g.stroke,'ink'));
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);drawObjects();requestDraw();recordDrawingCommit(began);
  };
  const applySession=async()=>{if(busy||stale||gesture.current)return;setBusy(true);setError('');for(const c of [...materialCache.current.values(),liveBase.current,scratch.current])if(c)c.width=c.height=0;materialCache.current.clear();const reserved=[base.current,live.current,above.current,preview.current].reduce((n,c)=>n+(c?c.width*c.height*4:0),0);const signal=new AbortController();controller.current=signal;const result=await prepareDrawingCommit(currentDrawingSession()!,signal.signal,reserved);if(result.ok)report(commitDrawingSession(result.value));else report(result);setBusy(false);if(currentDrawingSession()){drawObjects();drawPreview();}};
  return <FocusDialog title="自由绘画窗口" onCancel={close} className="drawing-window"><div className="drawing-shell" style={{transform:`translate(${offset.x}px,${offset.y}px)`}} onKeyDown={e=>{if(e.nativeEvent.isComposing||e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement)return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopPropagation();if(!busy){clearStroke();travelDrawingHistory(e.shiftKey?'redo':'undo');}}}}>
    <header className="drawing-heading" onPointerDown={e=>{if((e.target as HTMLElement).closest('button'))return;dragWindow.current={x:e.clientX,y:e.clientY,offset};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{const d=dragWindow.current;if(d){const bounds=e.currentTarget.parentElement!.getBoundingClientRect(),maxX=Math.max(0,(innerWidth-bounds.width)/2-8),maxY=Math.max(0,(innerHeight-bounds.height)/2-8);setOffset({x:Math.max(-maxX,Math.min(maxX,d.offset.x+e.clientX-d.x)),y:Math.max(-maxY,Math.min(maxY,d.offset.y+e.clientY-d.y))});}}} onPointerUp={()=>{dragWindow.current=null;}}><strong>自由绘画</strong><span>{a.targetId?'编辑手绘素材':'手绘素材'}</span><button aria-label="关闭绘画窗口" onClick={close}>×</button></header>
    <div className="drawing-options" role="toolbar" aria-label="绘画窗口工具"><button disabled={busy||!!a.targetId} onClick={()=>report(addDrawingObject('material'))}>＋ 新素材</button><span className="drawing-divider"/>{[['pen','画笔'],['eraser','橡皮'],['move','移动／缩放']].map(([id,label])=><button key={id} disabled={!active||busy} aria-pressed={tool===id} onClick={()=>{clearStroke();setTool(id as PaintTool);}}>{label}</button>)}<button disabled={busy||!a.past.length} onClick={()=>{clearStroke();travelDrawingHistory('undo');}}>撤销</button><button disabled={busy||!a.future.length} onClick={()=>{clearStroke();travelDrawingHistory('redo');}}>重做</button><label>视图<select aria-label="绘画视图缩放" value={zoom} onChange={e=>{clearStroke();setZoom(Number(e.target.value));}}>{[.5,1,1.5,2,3].map(v=><option key={v} value={v}>{v===1?'适应窗口':`${v*100}%`}</option>)}</select></label></div>
    <div className="drawing-content" {...(busy?{inert:""}:{})}><aside className="drawing-object-list"><strong>绘画对象</strong>{a.objects.map(o=><div key={o.id}><button className={o.id===a.activeId?'active':''} aria-pressed={o.id===a.activeId} onClick={()=>{clearStroke();selectDrawingObject(o.id);}}>✎ {o.name}</button><button aria-label={`切换${o.name}可见性`} onClick={()=>report(updateDrawingObject(o.id,{visible:!o.visible}))}>{o.visible?'◉':'○'}</button></div>)}{!a.objects.length&&<p>创建素材后直接绘制。</p>}</aside>
      <div ref={host} className="drawing-board" aria-label="绘画画板" onPointerDown={start} onPointerMove={appendSamples} onPointerUp={finish} onPointerCancel={()=>{gesture.current=null;drawObjects();requestDraw();}} onLostPointerCapture={()=>{if(gesture.current){gesture.current=null;drawObjects();requestDraw();}}}><canvas ref={base} aria-label="已完成的绘画"/><canvas ref={live} aria-label="实时笔刷绘画"/><canvas ref={above} aria-label="上方绘画对象"/><canvas ref={preview} aria-label="当前笔迹与操作边框"/>{!active&&<div className="drawing-board-empty">点击“新素材”开始绘画</div>}</div>
      <aside className="drawing-properties"><strong>笔刷</strong><NumberField label="笔宽" value={width} min={1} max={512} apply={setWidth}/><NumberField label="笔刷平滑" value={smooth} max={1} step={.05} apply={setSmooth}/>{<><ColorField label="笔刷颜色" value={color} apply={setColor}/><NumberField label="笔刷透明度 %" value={opacity} max={100} apply={setOpacity}/></>}
        {!a.objects.length&&<><strong>画板</strong><NumberField label="画板宽" value={a.width} min={16} max={4096} apply={n=>report(setDrawingBoard(n,a.height))}/><NumberField label="画板高" value={a.height} min={16} max={4096} apply={n=>report(setDrawingBoard(a.width,n))}/></>}
        {active&&<><strong>对象属性</strong><label className="drawing-field"><span>名称</span><input key={active.id+active.name} aria-label="绘画对象名称" defaultValue={active.name} maxLength={80} onBlur={e=>report(updateDrawingObject(active.id,{name:e.target.value}))}/></label><NumberField label="绘画对象 X" value={active.matrix[4]} min={-8192} max={8192} apply={n=>report(updateDrawingObject(active.id,{matrix:[active.matrix[0],active.matrix[1],active.matrix[2],active.matrix[3],n,active.matrix[5]]}))}/><NumberField label="绘画对象 Y" value={active.matrix[5]} min={-8192} max={8192} apply={n=>report(updateDrawingObject(active.id,{matrix:[active.matrix[0],active.matrix[1],active.matrix[2],active.matrix[3],active.matrix[4],n]}))}/><NumberField label="对象横向倍率" value={Math.hypot(active.matrix[0],active.matrix[1])} min={.02} max={20} step={.1} apply={n=>{const factor=n/Math.hypot(active.matrix[0],active.matrix[1]);report(updateDrawingObject(active.id,{matrix:[active.matrix[0]*factor,active.matrix[1]*factor,active.matrix[2],active.matrix[3],active.matrix[4],active.matrix[5]]}));}}/><NumberField label="对象纵向倍率" value={Math.hypot(active.matrix[2],active.matrix[3])} min={.02} max={20} step={.1} apply={n=>{const factor=n/Math.hypot(active.matrix[2],active.matrix[3]);report(updateDrawingObject(active.id,{matrix:[active.matrix[0],active.matrix[1],active.matrix[2]*factor,active.matrix[3]*factor,active.matrix[4],active.matrix[5]]}));}}/>

          <button disabled={!!a.targetId||busy} onClick={()=>report(deleteDrawingObject(active.id))}>删除绘画对象</button></>}
      </aside></div>
    <footer className="drawing-footer"><div role="status">{stale?'作品已变化。草稿仍保留，请取消后重新打开。':error||'窗口内逐笔撤销；应用到漫画只生成一次历史。'}</div><button onClick={close}>{busy?'取消应用':'取消'}</button><button className="primary" disabled={busy||stale||!a.objects.length} onClick={()=>void applySession()}>{busy?'正在准备…':'应用到画布'}</button></footer>
    {confirmCancel&&<div className="drawing-discard" role="alertdialog" aria-label="放弃绘画草稿"><p>放弃窗口内尚未应用的绘画？</p><button onClick={()=>setConfirmCancel(false)}>继续绘画</button><button onClick={cancelDrawingWindow}>放弃草稿</button></div>}
  </div></FocusDialog>;
}
