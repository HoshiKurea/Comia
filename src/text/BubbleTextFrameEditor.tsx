import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { Id, Point, Project, Viewport } from '../domain/types';
import { apply, inverse, pageToScreen, worldMatrix } from '../geometry/matrix';
import { rectHandle } from '../interaction/resize';
import { bubbleFrameBounds } from './bubbleFrameBounds';
import { currentTextEdit, textEditStore } from './editController';
import { beginBubbleFrameDrag, cancelBubbleFrameDrag, commitBubbleFrameDrag, previewBubbleFrameDrag } from './bubbleTextFrameController';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { pushNotice } from '../state/sessionStore';

export function BubbleTextFrameEditor({id,project,viewport}:{id:Id;project:Project;viewport:Viewport}){
  const edit=useStore(textEditStore,s=>s.active?.layerId===id?s.active:null),svg=useRef<SVGSVGElement>(null),pointer=useRef<number|null>(null),pending=useRef<{point:Point;shift:boolean}|null>(null),raf=useRef<number|null>(null),start=useRef<Point|null>(null),moved=useRef(false);
  const source=edit?.preview??project,l=source.layers[id],bounds=bubbleFrameBounds(source,id);
  const clear=()=>{if(raf.current!==null)cancelAnimationFrame(raf.current);raf.current=null;pending.current=null;const old=pointer.current;pointer.current=null;start.current=null;if(old!==null&&svg.current?.hasPointerCapture(old))svg.current.releasePointerCapture(old);};
  const cancel=()=>{clear();cancelBubbleFrameDrag();};
  useEffect(()=>{cancel();},[viewport.zoom,viewport.pan.x,viewport.pan.y,id]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(pointer.current!==null&&e.key==='Escape'&&!e.isComposing&&!document.getElementById('expanded-tool-options')){e.preventDefault();e.stopImmediatePropagation();cancel();}};window.addEventListener('keydown',key,true);window.addEventListener('blur',cancel);return()=>{window.removeEventListener('keydown',key,true);window.removeEventListener('blur',cancel);cancel();};},[]);
  if(l?.type!=='text'||!l.parentId||source.layers[l.parentId]?.type!=='bubble'||!bounds||effectiveLayerFlags(source,id).locked)return null;
  const world=worldMatrix(source,l.parentId),inv=inverse(world);if(!inv.ok)return null;
  const hs=Array.from({length:8},(_,i)=>pageToScreen(apply(world,rectHandle(bounds.box,i)),viewport));
  const point=(e:React.PointerEvent)=>{const r=svg.current!.getBoundingClientRect();return apply(inv.value,{x:(e.clientX-r.left-viewport.pan.x)/viewport.zoom,y:(e.clientY-r.top-viewport.pan.y)/viewport.zoom});};
  const flush=()=>{raf.current=null;const q=pending.current;pending.current=null;if(q&&pointer.current!==null){const r=previewBubbleFrameDrag(q.point,q.shift);if(!r.ok)pushNotice('error',r.problems[0].message);}};
  return <svg ref={svg} className="bubble-frame-editor" aria-label="对白文字框调整" data-text-edit-preserve style={{position:'absolute',inset:0,width:'100%',height:'100%',zIndex:5,pointerEvents:'none',touchAction:'none'}} onPointerMove={e=>{if(pointer.current!==e.pointerId)return;e.stopPropagation();if(!moved.current&&start.current&&Math.hypot(e.clientX-start.current.x,e.clientY-start.current.y)<3)return;moved.current=true;pending.current={point:point(e),shift:e.shiftKey};if(raf.current===null)raf.current=requestAnimationFrame(flush);}} onPointerUp={e=>{if(pointer.current!==e.pointerId)return;e.stopPropagation();if(!moved.current){cancel();return;}pending.current={point:point(e),shift:e.shiftKey};if(raf.current!==null)cancelAnimationFrame(raf.current);flush();clear();const r=commitBubbleFrameDrag();if(!r.ok)pushNotice('error',r.problems[0].message);}} onPointerCancel={cancel} onLostPointerCapture={()=>{if(pointer.current!==null)cancel();}}>
    <polygon points={[0,2,4,6].map(i=>`${hs[i].x},${hs[i].y}`).join(' ')} fill="none" stroke="#2679c9" strokeWidth="1" strokeDasharray="4 3"/>
    {hs.map((p,i)=><rect key={i} x={p.x-5} y={p.y-5} width="10" height="10" fill="#fff" stroke="#2679c9" style={{pointerEvents:edit?.composing?'none':'all',cursor:'nwse-resize'}} aria-label={`对白框手柄${i}`} onPointerDown={e=>{if(e.button!==0||pointer.current!==null||currentTextEdit()?.composing)return;e.preventDefault();e.stopPropagation();const r=beginBubbleFrameDrag(id,i,bounds.box,bounds.safe);if(!r.ok){pushNotice('error',r.problems[0].message);return;}pointer.current=e.pointerId;start.current={x:e.clientX,y:e.clientY};moved.current=false;svg.current!.setPointerCapture(e.pointerId);}}/>)}
  </svg>;
}
