import {sessionStore} from '../state/sessionStore';
import { FloatingEditPanel } from '../app/FloatingEditPanel';
import { useEffect, useRef } from 'react';
import { RangeNumberValue } from '../ui/RangeNumberField';
import { useStore } from 'zustand';
import type { Point, Viewport } from '../domain/types';
import { apply, inverse, pageToScreen, worldMatrix } from '../geometry/matrix';
import { distanceToSegment } from '../geometry/simplePolygon';
import { pushNotice } from '../state/sessionStore';
import { cancelDrawing, commitDrawing, correctDrawing, currentDrawing, drawingStore, finishDrawing, setDrawingGeometry, setRawDrawing } from './drawingController';
import './tools.css';

export function DrawingSurface({ viewport }: { viewport: Viewport }) {
  const toolMode=useStore(sessionStore,s=>s.toolMode);
  const active = useStore(drawingStore, s => s.active), svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef(viewport); viewportRef.current = viewport;
  const pointer = useRef<{ id: number; index: number | null; raw: Point[]; viewport:Viewport } | null>(null), frame = useRef<number | null>(null);
  const notify = (result: { ok: boolean; problems?: { message: string }[] }) => { if (!result.ok) pushNotice('error', result.problems?.[0]?.message ?? '分格操作失败'); };
  const screen = (p: Point): Point => {
    const session = currentDrawing()!; return pageToScreen(session.targetId ? apply(worldMatrix(session.base, session.targetId), p) : p, viewport);
  };
  const local = (event: { clientX: number; clientY: number }): Point | null => {
    const rect = svgRef.current?.getBoundingClientRect(), session = currentDrawing(); if (!rect || !session) return null;
    const p = { x: (event.clientX - rect.left - viewport.pan.x) / viewport.zoom, y: (event.clientY - rect.top - viewport.pan.y) / viewport.zoom };
    if (!session.targetId) return p; const inv = inverse(worldMatrix(session.base, session.targetId)); return inv.ok ? apply(inv.value, p) : null;
  };
  const effectiveZoom = () => {
    const s = currentDrawing(); if (!s?.targetId) return viewportRef.current.zoom;
    const m = worldMatrix(s.base, s.targetId), trace = m[0] ** 2 + m[1] ** 2 + m[2] ** 2 + m[3] ** 2, det = m[0] * m[3] - m[1] * m[2];
    return viewportRef.current.zoom * Math.sqrt((trace + Math.sqrt(Math.max(0, trace * trace - 4 * det * det))) / 2);
  };
  const flush = () => { const s = currentDrawing(), p = pointer.current; if (!s || !p) return;
    if (p.index !== null) setDrawingGeometry(p.raw); else setRawDrawing(p.raw, effectiveZoom());
  };
  const release = () => { const p = pointer.current; pointer.current = null; if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; if (p && svgRef.current?.hasPointerCapture(p.id)) svgRef.current.releasePointerCapture(p.id); };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!currentDrawing() || e.isComposing || e.keyCode === 229 || document.getElementById('expanded-tool-options') || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); release(); cancelDrawing(); }
      else if (e.key === 'Enter' && currentDrawing()?.phase === 'drawing') { e.preventDefault(); e.stopImmediatePropagation(); notify(finishDrawing()); }
      else if (e.key === 'Backspace' && currentDrawing()?.kind === 'polygon' && currentDrawing()?.phase === 'drawing') { e.preventDefault(); e.stopImmediatePropagation(); const s = currentDrawing()!; setRawDrawing(s.raw.slice(0, -1), effectiveZoom()); }
    };
    const cancel = () => { release(); cancelDrawing(); };
    window.addEventListener('keydown', key, true); window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel); release(); };
  }, []);
  useEffect(() => { if (!active) release(); }, [Boolean(active)]);
  useEffect(() => { const p=pointer.current;if(p&&(p.viewport.zoom!==viewport.zoom||p.viewport.pan.x!==viewport.pan.x||p.viewport.pan.y!==viewport.pan.y)){release();cancelDrawing();} },[viewport.zoom,viewport.pan.x,viewport.pan.y]);
  if (!active) return null;
  const path = (points: Point[]) => points.map((p, i) => { const q = screen(p); return `${i ? 'L' : 'M'}${q.x},${q.y}`; }).join(' ') + (active.phase === 'review' || active.kind === 'edit' ? ' Z' : '');
  return <>
    <svg ref={svgRef} className="panel-drawing-surface" aria-label="分格绘制区域" tabIndex={0}
      onPointerDown={e => {
        e.stopPropagation(); if (e.button !== 0) return; e.preventDefault(); e.currentTarget.focus();
        if (e.pointerType === 'touch' && !e.isPrimary) { release(); cancelDrawing(); return; }
        if (pointer.current && pointer.current.id !== e.pointerId) { release(); cancelDrawing(); return; }
        const p = local(e); if (!p) return; const s = currentDrawing()!;
        if (s.phase === 'review') {
          const pos = screen(p); let index = s.points.findIndex(q => { const v = screen(q); return Math.hypot(v.x - pos.x, v.y - pos.y) <= 9; });
          if (e.altKey && index >= 0) { if (s.points.length <= 3) pushNotice('error', '分格至少保留三个顶点'); else notify(setDrawingGeometry(s.points.filter((_, i) => i !== index))); return; }
          let points = s.points;
          if (index < 0) { const edge = points.findIndex((q, i) => distanceToSegment(pos, screen(q), screen(points[(i + 1) % points.length])) <= 7); if (edge >= 0) { if (points.length >= 256) { pushNotice('error', '最多256个顶点'); return; } points = [...points.slice(0, edge + 1), p, ...points.slice(edge + 1)]; index = edge + 1; notify(setDrawingGeometry(points)); } }
          if (index < 0) return; pointer.current = { id: e.pointerId, index, raw: structuredClone(points), viewport:structuredClone(viewport) }; e.currentTarget.setPointerCapture(e.pointerId); return;
        }
        if (s.kind === 'polygon') { if (s.raw.length >= 3 && Math.hypot(screen(s.raw[0]).x - screen(p).x, screen(s.raw[0]).y - screen(p).y) <= 12) notify(finishDrawing()); else setRawDrawing([...s.raw, p], effectiveZoom()); return; }
        pointer.current = { id: e.pointerId, index: null, raw: [p], viewport:structuredClone(viewport) }; setRawDrawing([p], effectiveZoom()); e.currentTarget.setPointerCapture(e.pointerId);
      }} onPointerMove={e => {
        e.stopPropagation(); const owner = pointer.current, s = currentDrawing(); if (!owner || owner.id !== e.pointerId || !s) return;
        const coalesced = e.nativeEvent.getCoalescedEvents?.();
        for (const event of coalesced?.length ? coalesced : [e.nativeEvent]) {
          const p = local(event); if (!p) continue;
          if (owner.index !== null) owner.raw[owner.index] = p;
          else if (s.kind === 'line') owner.raw = [owner.raw[0], p];
          else if (owner.raw.length < 4096) { const a = screen(p), b = screen(owner.raw.at(-1)!); if (Math.hypot(a.x - b.x, a.y - b.y) >= 1.5) owner.raw.push(p); }
        }
        if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; flush(); });
      }} onPointerUp={e => {
        e.stopPropagation(); const owner = pointer.current; if (!owner || owner.id !== e.pointerId) return; const p = local(e);
        if (p && owner.index === null) { if (currentDrawing()?.kind === 'line') owner.raw = [owner.raw[0], p]; else if (owner.raw.length < 4096) owner.raw.push(p); }
        flush(); const editing = owner.index !== null; release(); if (!editing) notify(finishDrawing());
      }} onPointerCancel={e => { e.stopPropagation(); release(); cancelDrawing(); }} onLostPointerCapture={() => { if (pointer.current) { release(); cancelDrawing(); } }}
      onWheel={e => { e.stopPropagation(); release(); cancelDrawing(); }}
      onDoubleClick={e => { e.preventDefault(); e.stopPropagation(); if (currentDrawing()?.phase === 'drawing' && currentDrawing()?.kind === 'polygon') notify(finishDrawing()); }}>
      {active.kind === 'edit' && active.targetId && <path d={path((active.base.layers[active.targetId] as { geometry: Point[] }).geometry)} className="panel-original-outline" />}
      {active.pieces.map((poly, i) => <path key={i} d={path(poly) + ' Z'} className="panel-cut-piece" />)}
      <path d={path(active.points)} className="panel-draft-outline" fill={active.kind === 'line' || active.phase === 'drawing' ? 'none' : '#3985be12'} />
      {active.phase === 'review' && active.points.map((p, i) => { const q = screen(p); return <circle key={i} cx={q.x} cy={q.y} r={4} className="panel-contour-point" />; })}
    </svg>
    {!(active.kind==='line'&&toolMode==='panel-cut')&&<FloatingEditPanel title="分格修正"><div className="panel-drawing-toolbar" role="region" aria-label="分格修正">
      <strong>{active.kind === 'line' ? '直线切割' : active.kind === 'polygon' ? '多边形分格' : active.kind === 'edit' ? '修正分格' : '手绘分格'}</strong>
      <span>{active.phase === 'review' ? `${active.points.length}点 · 拖动顶点，点边加点，Alt点顶点删除` : active.kind === 'line' ? '拖动穿过分镜的线段，松开切割' : active.kind === 'polygon' ? '逐点点击 · Enter/双击闭合 · Backspace撤回' : '按下绘制轮廓，松开修正'}</span>
      {active.kind !== 'line' && active.phase === 'review' && <>
        <select aria-label="轮廓修正方式" value={active.options.mode} onChange={e => notify(correctDrawing({ ...active.options, mode: e.target.value as typeof active.options.mode }))}><option value="contour">保留轮廓</option><option value="smooth">平滑轮廓</option><option value="straighten">规整直线</option></select>
        <label>强度 <RangeNumberValue label="轮廓修正强度" value={active.options.toleranceScreenPx} min={.5} max={8} step={.5} unit="px" apply={n=>correctDrawing({...active.options,toleranceScreenPx:n})}/><input aria-label="轮廓修正强度" type="range" min="0.5" max="8" step="0.5" value={active.options.toleranceScreenPx} onChange={e => notify(correctDrawing({ ...active.options, toleranceScreenPx: Number(e.target.value) }))} /></label>
        <button onClick={() => notify(commitDrawing())} disabled={Boolean(active.error)}>闭合并应用</button>
      </>}
      {active.kind === 'line' && <label>间隙 <input aria-label="直线切割间隙" type="number" min="0" max="256" value={Number.isFinite(active.gap) ? active.gap : ''} onChange={e => drawingStore.setState({ active: { ...active, gap: e.target.value.trim() ? Number(e.target.value) : NaN } })} /></label>}
      <button onClick={() => { release(); cancelDrawing(); }}>取消分格</button>
      {active.error && <span role="alert">{active.error}</span>}
      {active.phase === 'review' && active.kind !== 'line' && <small>自由分格保存为Comia v2，旧版软件无法读取。</small>}
    </div></FloatingEditPanel>}
  </>;
}
