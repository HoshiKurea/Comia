import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { Point, Viewport } from '../domain/types';
import { pushNotice, sessionStore } from '../state/sessionStore';
import { beginComicDraw, appendComicDraw, currentComicDraw, finishComicDraw, cancelComicDraw } from './controller';

export function ComicDrawSurface({viewport}:{viewport:Viewport}) {
  const space=useStore(sessionStore,s=>s.spacePan),mode=useStore(sessionStore,s=>s.toolMode),svg=useRef<SVGSVGElement>(null),owner=useRef<number|null>(null),pending=useRef<(Point&{pressure:number})[]>([]),raf=useRef<number|null>(null);
  const clear=()=>{if(raf.current!==null)cancelAnimationFrame(raf.current);raf.current=null;pending.current=[];const old=owner.current;owner.current=null;if(old!==null&&svg.current?.hasPointerCapture(old))svg.current.releasePointerCapture(old);};
  const cancel=()=>{clear();cancelComicDraw();};
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.isComposing||e.keyCode===229||(e.target as Element)?.closest('input,textarea,select'))return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancel();}if(e.code==='Space')cancel();};window.addEventListener('keydown',key,true);window.addEventListener('blur',cancel);window.addEventListener('resize',cancel);return()=>{window.removeEventListener('keydown',key,true);window.removeEventListener('blur',cancel);window.removeEventListener('resize',cancel);cancel();};},[]);
  useEffect(cancel,[viewport.zoom,viewport.pan.x,viewport.pan.y]);
  const flush=()=>{raf.current=null;const samples=pending.current;pending.current=[];if(owner.current===null||!currentComicDraw())return;const r=appendComicDraw(samples);if(!r.ok)pushNotice('info',r.problems[0].message);};
  return <svg ref={svg} className="speed-brush-surface" aria-label={mode==='flash-bubble'?'效果线气泡绘制区域':'绘画图层绘制区域'} tabIndex={0} style={{pointerEvents:space?'none':'auto'}} onPointerDown={e=>{
    if(owner.current!==null||e.button!==0||space||e.pointerType==='touch'&&!e.isPrimary)return;e.preventDefault();e.stopPropagation();const b=e.currentTarget.getBoundingClientRect(),r=beginComicDraw({x:e.clientX,y:e.clientY},{x:b.x,y:b.y,width:b.width,height:b.height},viewport,e.pointerType==='pen',e.pointerType==='pen'?e.pressure:.5);
    if(!r.ok){pushNotice('info',r.problems[0].message);return;}owner.current=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);e.currentTarget.focus({preventScroll:true});
  }} onPointerMove={e=>{if(owner.current!==e.pointerId)return;e.stopPropagation();const list=e.nativeEvent.getCoalescedEvents?.();pending.current.push(...(list?.length?list:[e.nativeEvent]).map(ev=>({x:ev.clientX,y:ev.clientY,pressure:ev.pointerType==='pen'?ev.pressure:.5})));if(raf.current===null)raf.current=requestAnimationFrame(flush);}} onPointerUp={e=>{
    if(owner.current!==e.pointerId)return;e.stopPropagation();pending.current.push({x:e.clientX,y:e.clientY,pressure:e.pointerType==='pen'?e.pressure:.5});if(raf.current!==null)cancelAnimationFrame(raf.current);flush();clear();const r=finishComicDraw();if(!r.ok)pushNotice('info',r.problems[0].message);
  }} onPointerCancel={cancel} onLostPointerCapture={()=>{if(owner.current!==null)cancel();}} onWheel={cancel}/>;
}
