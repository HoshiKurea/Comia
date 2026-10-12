import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { Id, Mat, Point, Project, Viewport } from '../domain/types';
import { ok } from '../domain/types';
import type { ShapePath } from '../geometry/types';
import { apply, clientToPage, inverse, pageToScreen, worldMatrix } from '../geometry/matrix';
import { mangaEditStore, currentMangaEdit, cancelMangaEdit, commitMangaEdit } from './mangaEditController';
import { editableContour, updateBubbleContour } from './shapeController';
import { beginTailEdit, updateTailEdit } from './tailEditController';
import { tailAnchors } from './tailGeometry';
import { moveTailAnchor, moveTailTipLayer } from './tailEditGeometry';
import { mangaBodyPath } from './handDrawn';
import { composeBubble } from './composeBubble';
import { editorGeometryTarget } from './editorTarget';
import { reportManga } from './MangaFields';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { pushNotice } from '../state/sessionStore';
import { buildContourPath } from './handDrawn';
import { closestPathPoint } from '../geometry/closestPathPoint';
import './manga.css';

type Kind='node'|'base'|'tip'|'knot'|'c1'|'c2';
interface Drag {pointerId:number;kind:Kind;index:number;world:Mat;nodes:Point[];autoCommit:boolean}
function svgPath(path:ShapePath,world:Mat,vp:Viewport):string{
  const point=(p:Point)=>{const s=pageToScreen(apply(world,p),vp);return`${s.x} ${s.y}`;};
  return path.ops.map(op=>op.op==='Z'?'Z':op.op==='M'||op.op==='L'?`${op.op}${point(op.p)}`:op.op==='Q'?`Q${point(op.control)} ${point(op.p)}`:`C${point(op.c1)} ${point(op.c2)} ${point(op.p)}`).join(' ');
}
export function MangaGeometryEditor({id,project,viewport}:{id:Id;project:Project;viewport:Viewport}){
  const active=useStore(mangaEditStore,s=>s.active?.id===id?s.active:null),svg=useRef<SVGSVGElement>(null),drag=useRef<Drag|null>(null),pending=useRef<Point|null>(null),frame=useRef<number|null>(null),keyboardAuto=useRef(false);
  const p=active?.preview??project,target=p.layers[id],flags=effectiveLayerFlags(p,id),world=target?worldMatrix(p,id):[1,0,0,1,0,0] as const;
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{if(e.isComposing||e.keyCode===229)return;if(e.key==='Escape'&&currentMangaEdit()&&!(e.target as Element)?.closest('input,textarea,select')){e.preventDefault();e.stopImmediatePropagation();cancelMangaEdit();drag.current=null;pending.current=null;if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;}};
    window.addEventListener('keydown',key,true);return()=>{window.removeEventListener('keydown',key,true);if(frame.current!==null)cancelAnimationFrame(frame.current);drag.current=null;pending.current=null;};
  },[id]);
  if(!target||flags.locked||!flags.visible||target.type!=='bubble'&&target.type!=='bubbleTail')return null;
  const contour=target.type==='bubble'?(target.contour?ok(target.contour):editableContour(target)):null;
  if(target.type==='bubble'&&(!active||active.kind!=='shape'||!contour?.ok))return null;
  const owner=target.parentId?p.layers[target.parentId]:undefined,anchors=target.type==='bubbleTail'?tailAnchors(target,owner?.type==='bubble'?owner:undefined):null;
  const screen=(point:Point)=>pageToScreen(apply(world,point),viewport);
  const applyPoint=(kind:Kind,index:number,q:Point,nodes?:Point[])=>{
    const state=currentMangaEdit();if(!state||state.id!==id)return;
    const source=state.preview.layers[id];
    if(source.type==='bubble'&&kind==='node'){
      const c=editableContour(source);if(!c.ok){reportManga(c);return;}const values=(nodes??c.value.nodes).map((v,i)=>i===index?{x:q.x/source.width,y:q.y/source.height}:{...v});reportManga(updateBubbleContour(values));
    }else if(source.type==='bubbleTail'){
      if(kind==='tip'){const next=moveTailTipLayer(state.preview,id,q);reportManga(next.ok?updateTailEdit({tip:next.value.tip}):next);}
      else if(kind==='base'){
        if(source.attachment.mode==='bubble'){const next=moveTailAnchor(state.preview,id,q);reportManga(next.ok?updateTailEdit({attachment:next.value.attachment}):next);}
        else{const a=source.attachment.baseA,b=source.attachment.baseB,dx=q.x-(a.x+b.x)/2,dy=q.y-(a.y+b.y)/2;reportManga(updateTailEdit({attachment:{mode:'free',baseA:{x:a.x+dx,y:a.y+dy},baseB:{x:b.x+dx,y:b.y+dy}}}));}
      }else if(kind==='knot'&&source.route.kind==='polyline')reportManga(updateTailEdit({route:{kind:'polyline',knots:source.route.knots.map((v,i)=>i===index?q:v)}}));
      else if((kind==='c1'||kind==='c2')&&source.route.kind==='spline')reportManga(updateTailEdit({route:{...source.route,[kind]:q}}));
    }
  };
  const point=(e:React.PointerEvent|React.MouseEvent):Point=>clientToPage({x:e.clientX,y:e.clientY},svg.current!.getBoundingClientRect(),viewport);
  const flush=()=>{frame.current=null;const d=drag.current,page=pending.current;pending.current=null;if(!d||!page)return;const inv=inverse(d.world);if(inv.ok)applyPoint(d.kind,d.index,apply(inv.value,page),d.nodes);};
  const begin=(e:React.PointerEvent,kind:Kind,index=0)=>{
    if(e.button!==0||drag.current)return;e.preventDefault();e.stopPropagation();const was=!!currentMangaEdit();
    if(target.type==='bubbleTail'){const result=beginTailEdit(id);if(!result.ok){reportManga(result);return;}}
    const state=currentMangaEdit();if(!state||state.id!==id)return;
    const layer=state.preview.layers[id],nodes=layer.type==='bubble'?editableContour(layer):null;
    drag.current={pointerId:e.pointerId,kind,index,world:worldMatrix(state.preview,id),nodes:nodes?.ok?nodes.value.nodes:[],autoCommit:target.type==='bubbleTail'&&!was};svg.current!.setPointerCapture(e.pointerId);
  };
  const stop=(e:React.PointerEvent<SVGSVGElement>,commit:boolean)=>{
    const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;e.preventDefault();e.stopPropagation();if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;
    if(commit){pending.current=point(e);flush();}else cancelMangaEdit();drag.current=null;pending.current=null;
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
    if(commit&&d.autoCommit)reportManga(commitMangaEdit());
  };
  const key=(e:React.KeyboardEvent,kind:Kind,index:number,local:Point)=>{
    if(drag.current||e.nativeEvent.isComposing||e.nativeEvent.keyCode===229||!e.key.startsWith('Arrow'))return;e.preventDefault();e.stopPropagation();
    if(target.type==='bubbleTail'&&!currentMangaEdit()){const result=beginTailEdit(id);if(!result.ok){reportManga(result);return;}keyboardAuto.current=true;}
    const live=currentMangaEdit()?.preview,layer=live?.layers[id];if(layer?.type==='bubble'&&kind==='node'){const c=editableContour(layer);if(c.ok)local={x:c.value.nodes[index].x*layer.width,y:c.value.nodes[index].y*layer.height};}else if(layer?.type==='bubbleTail'){if(kind==='tip')local=layer.tip;else if(kind==='c1'&&layer.route.kind==='spline')local=layer.route.c1;else if(kind==='c2'&&layer.route.kind==='spline')local=layer.route.c2;else if(kind==='knot'&&layer.route.kind==='polyline')local=layer.route.knots[index];else if(kind==='base'){const owner=layer.parentId?live?.layers[layer.parentId]:null,a=tailAnchors(layer,owner?.type==='bubble'?owner:undefined);if(a.ok)local=a.value.base;}}
    const step=e.shiftKey?10:1;applyPoint(kind,index,{x:local.x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),y:local.y+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0)});
  };
  const handles:{kind:Kind;index:number;point:Point;label:string}[]=[];
  if(target.type==='bubble'&&contour?.ok)contour.value.nodes.forEach((v,index)=>handles.push({kind:'node',index,point:{x:v.x*target.width,y:v.y*target.height},label:`气泡轮廓节点 ${index+1}`}));
  if(target.type==='bubbleTail'&&anchors?.ok){handles.push({kind:'base',index:0,point:anchors.value.base,label:'尾巴底座'},{kind:'tip',index:0,point:target.tip,label:'尾巴尖端'});if(target.route.kind==='polyline')target.route.knots.forEach((v,index)=>handles.push({kind:'knot',index,point:v,label:`尾巴折点 ${index+1}`}));else if(target.route.kind==='spline')handles.push({kind:'c1',index:0,point:target.route.c1,label:'尾巴曲线控制点 1'},{kind:'c2',index:0,point:target.route.c2,label:'尾巴曲线控制点 2'});}
  const compiled=target.type==='bubble'?composeBubble(p,id,editorGeometryTarget(p,id)):null,body=compiled?.ok?{ok:true as const,value:compiled.value.body}:target.type==='bubble'?mangaBodyPath(target):null;
  return <svg ref={svg} className="manga-geometry-overlay" aria-label={target.type==='bubble'?'气泡轮廓编辑覆盖层':'独立尾巴手柄'} onPointerMove={e=>{if(drag.current?.pointerId!==e.pointerId)return;e.stopPropagation();pending.current=point(e);if(frame.current===null)frame.current=requestAnimationFrame(flush);}} onPointerUp={e=>stop(e,true)} onPointerCancel={e=>stop(e,false)} onLostPointerCapture={e=>{if(drag.current?.pointerId===e.pointerId)stop(e,false);}}>
    {target.type==='bubble'&&body?.ok&&<><path className="manga-geometry-outline" style={{pointerEvents:'none'}} d={svgPath(body.value,world,viewport)}/><path className="manga-geometry-curve-hit" style={{fill:'none',stroke:'transparent',strokeWidth:10,pointerEvents:'stroke',cursor:'copy'}} d={svgPath(body.value,world,viewport)} onDoubleClick={e=>{e.preventDefault();e.stopPropagation();if(!contour?.ok)return;if(contour.value.nodes.length>=32){pushNotice('error','轮廓最多32个节点');return;}const inv=inverse(world);if(!inv.ok)return;const local=apply(inv.value,point(e)),nodes=contour.value.nodes;const path=buildContourPath(contour.value,target.width,target.height,target.shape==='spiky');if(!path.ok){reportManga(path);return;}const projected=closestPathPoint(path.value,local,editorGeometryTarget(p,id));if(!projected.ok){reportManga(projected);return;}const at=projected.value.afterIndex,position=projected.value.point;const next=[...nodes];next.splice(at+1,0,{x:position.x/target.width,y:position.y/target.height});reportManga(updateBubbleContour(next));}}/></>}
    {target.type==='bubbleTail'&&target.route.kind==='spline'&&anchors?.ok&&[[anchors.value.base,target.route.c1],[target.tip,target.route.c2]].map(([a,b],i)=>{const p=screen(a),q=screen(b);return<line key={i} className="manga-control-line" x1={p.x} y1={p.y} x2={q.x} y2={q.y}/>;})}
    {handles.map(h=>{const p=screen(h.point);return<circle className="manga-hit" key={`${h.kind}-${h.index}`} role="button" tabIndex={0} aria-label={h.label} cx={p.x} cy={p.y} r={h.kind==='node'?5:6} fill={h.kind==='base'?'#d8eae3':'#fffaf6'} stroke={h.kind==='node'?'#527b6e':'#d1744a'} strokeWidth={1.5} onPointerDown={e=>begin(e,h.kind,h.index)} onKeyDown={e=>key(e,h.kind,h.index,h.point)} onKeyUp={e=>{if(e.key.startsWith('Arrow')&&keyboardAuto.current){e.preventDefault();e.stopPropagation();keyboardAuto.current=false;reportManga(commitMangaEdit());}}} onContextMenu={e=>{if(h.kind!=='node')return;e.preventDefault();e.stopPropagation();if(contour?.ok){if(contour.value.nodes.length<=8)pushNotice('error','轮廓至少保留8个节点');else reportManga(updateBubbleContour(contour.value.nodes.filter((_,i)=>i!==h.index)));}}}/>;})}
  </svg>;
}
