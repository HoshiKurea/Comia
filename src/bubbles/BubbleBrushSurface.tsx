import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { Point, Viewport } from '../domain/types';
import { apply, inverse, pageToScreen } from '../geometry/matrix';
import { pushNotice, sessionStore } from '../state/sessionStore';
import { appendBubbleBrushSamples, beginBubbleBrush, bubbleBrushStore, cancelBubbleBrush, currentBubbleBrush, finishBubbleBrush } from './brushController';
export function BubbleBrushSurface({ viewport }: { viewport: Viewport }) {
  const active = useStore(bubbleBrushStore, s => s.active), space = useStore(sessionStore, s => s.spacePan), svg = useRef<SVGSVGElement>(null), owner = useRef<number | null>(null), pending = useRef<(Point & { pressure: number })[]>([]), raf = useRef<number | null>(null);
  const clear = () => { if (raf.current !== null) cancelAnimationFrame(raf.current); raf.current = null; pending.current = []; const old = owner.current; owner.current = null; if (old !== null && svg.current?.hasPointerCapture(old)) svg.current.releasePointerCapture(old); };
  const cancel = () => { clear(); cancelBubbleBrush(); };
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.isComposing || e.keyCode === 229 || (e.target as Element)?.closest('input,textarea,select')) return; if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); } if (e.code === 'Space') cancel(); };
    window.addEventListener('keydown', key, true); window.addEventListener('blur', cancel); window.addEventListener('resize', cancel);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); cancel(); };
  }, []);
  useEffect(cancel, [viewport.zoom, viewport.pan.x, viewport.pan.y]);
  const flush = () => { raf.current = null; const points = pending.current; pending.current = []; if (owner.current === null || !points.length || !currentBubbleBrush()) return; const r = appendBubbleBrushSamples(points); if (!r.ok) pushNotice('info', r.problems[0].message); };
  const screen = (p: Point) => { if (!active) return p; const world = inverse(active.inverse); return world.ok ? pageToScreen(apply(world.value, p), viewport) : p; };
  return <svg ref={svg} className="speed-brush-surface" aria-label="手绘气泡绘制区域" tabIndex={0} style={{ pointerEvents: space ? 'none' : 'auto' }} onPointerDown={e => {
    e.preventDefault(); e.stopPropagation(); if (owner.current !== null || e.button !== 0 || space || e.pointerType === 'touch' && !e.isPrimary) return;
    const box = e.currentTarget.getBoundingClientRect(), r = beginBubbleBrush({ x: e.clientX, y: e.clientY }, e.pointerId, { x: box.x, y: box.y, width: box.width, height: box.height }, viewport, e.pointerType === 'pen' ? e.pressure : .5, e.pointerType==='pen');
    if (!r.ok) { pushNotice('info', r.problems[0].message); return; } owner.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.focus({ preventScroll: true });
  }} onPointerMove={e => { if (owner.current !== e.pointerId) return; e.stopPropagation(); const samples = e.nativeEvent.getCoalescedEvents?.(); pending.current.push(...(samples?.length ? samples : [e.nativeEvent]).map(ev => ({ x: ev.clientX, y: ev.clientY, pressure: ev.pointerType === 'pen' ? ev.pressure : .5 }))); if (raf.current === null) raf.current = requestAnimationFrame(flush); }} onPointerUp={e => {
    if (owner.current !== e.pointerId) return; e.stopPropagation(); pending.current.push({ x: e.clientX, y: e.clientY, pressure: e.pointerType === 'pen' ? e.pressure : .5 }); if (raf.current !== null) cancelAnimationFrame(raf.current); flush(); clear(); const r = finishBubbleBrush(); if (!r.ok) pushNotice('info', r.problems[0].message);
  }} onPointerCancel={cancel} onLostPointerCapture={() => { if (owner.current !== null) cancel(); }} onWheel={cancel}>
    {active?.mode === 'contour' && <polyline points={active.raw.map(p => { const q = screen(p); return `${q.x},${q.y}`; }).join(' ')} fill="none" stroke="#e77748" strokeWidth="2" />}
  </svg>;
}
