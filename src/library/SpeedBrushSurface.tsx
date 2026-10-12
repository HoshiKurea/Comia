import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { Point, SpeedBrushOptions, Viewport } from '../domain/types';
import { sessionStore, pushNotice } from '../state/sessionStore';
import { FloatingEditPanel } from '../app/FloatingEditPanel';
import { openPresetDialog } from './PresetDialog';
import { appendSpeedSamples, beginSpeedStroke, cancelSpeedStroke, commitSpeedStroke, currentSpeedStroke, previewSpeedStroke, setSpeedBrushOptions, speedBrushStore } from './speedBrushController';
import { SPEED_BRUSH } from './speedBrushGeometry';
import './speedBrush.css';

export function SpeedBrushIcon() {
  return <svg className="speed-brush-icon" viewBox="0 0 64 48" aria-hidden="true"><g fill="currentColor">
    <path d="M4 7 58 4 61 5 18 9Z M2 20 55 17 49 20 12 22Z M9 30 62 27 59 30 21 33Z M1 42 46 38 55 39 12 44Z" />
  </g><path d="m45 41 10-12 4 4-10 12-6 2Z" fill="var(--surface,#fffdf8)" stroke="currentColor" strokeWidth="1.5" /></svg>;
}
function BrushNumber({ field, label, value }: { field: 'radius' | 'density' | 'strokeWidth' | 'irregularity'; label: string; value: number }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const number = draft.trim() ? Number(draft) : NaN;
    const result = setSpeedBrushOptions({ ...speedBrushStore.getState().options, [field]: number });
    if (!result.ok) { pushNotice('error', result.problems[0].message); setDraft(String(speedBrushStore.getState().options[field])); }
  };
  return <label>{label}<input type="number" aria-label={`笔刷${label}`} min={SPEED_BRUSH[field][0]} max={SPEED_BRUSH[field][1]}
    step={field === 'density' || field === 'radius' ? 1 : field === 'strokeWidth' ? .25 : .05} value={draft}
    onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
      if (e.key === 'Escape') { e.stopPropagation(); setDraft(String(value)); }
    }} /></label>;
}

export function SpeedBrushSurface({ viewport }: { viewport: Viewport }) {
  const svg = useRef<SVGSVGElement>(null), circle = useRef<SVGCircleElement>(null);
  const owner = useRef<number | null>(null), frame = useRef<number | null>(null), cursor = useRef<Point | null>(null);
  const viewportRef = useRef(viewport); viewportRef.current = viewport;
  const options = useStore(speedBrushStore, s => s.options), error = useStore(speedBrushStore, s => s.active?.error ?? '');
  const active = useStore(speedBrushStore, s => s.active !== null), spacePan = useStore(sessionStore, s => s.spacePan);
  const optionsRef = useRef<SpeedBrushOptions>(options); optionsRef.current = options;
  const release = () => {
    const id = owner.current; owner.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null;
    if (id !== null && svg.current?.hasPointerCapture(id)) svg.current.releasePointerCapture(id);
  };
  const schedule = () => { if (frame.current === null) frame.current = requestAnimationFrame(() => {
    frame.current = null;
    if (owner.current !== null) previewSpeedStroke();
    const p = cursor.current, box = svg.current?.getBoundingClientRect();
    if (p && box && circle.current) {
      circle.current.setAttribute('cx', String(p.x - box.left)); circle.current.setAttribute('cy', String(p.y - box.top));
      circle.current.setAttribute('r', String(optionsRef.current.radius * viewportRef.current.zoom)); circle.current.style.display = '';
    }
  }); };
  const returnToSelection = () => { release(); cancelSpeedStroke(); sessionStore.setState({ toolMode: 'select' }); };
  useEffect(() => {
    const cancel = () => { release(); cancelSpeedStroke(); };
    const bounds = svg.current?.getBoundingClientRect();
    let previous = bounds ? [bounds.x, bounds.y, bounds.width, bounds.height] : null;
    const observer = new ResizeObserver(() => {
      const box = svg.current?.getBoundingClientRect(); if (!box) return;
      const next = [box.x, box.y, box.width, box.height];
      if (previous && next.some((value, i) => Math.abs(value - previous![i]) > .5)) cancel();
      previous = next;
    });
    if (svg.current) observer.observe(svg.current);
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || (event.target as Element)?.closest('input,textarea,select,[contenteditable=true]')) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (currentSpeedStroke()) cancel(); else returnToSelection();
      } else if (event.code === 'Space') cancel();
    };
    window.addEventListener('blur', cancel); window.addEventListener('resize', cancel); window.addEventListener('keydown', key, true);
    return () => { observer.disconnect(); window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); window.removeEventListener('keydown', key, true); cancel(); };
  }, []);
  useEffect(() => { if (!active) release(); }, [active]);
  useEffect(() => { release(); cancelSpeedStroke(); }, [viewport.zoom, viewport.pan.x, viewport.pan.y]);
  return <>
    <svg ref={svg} className="speed-brush-surface" aria-label="速度线笔刷绘制区域" tabIndex={0} style={{ pointerEvents: spacePan ? 'none' : 'auto' }}
      onPointerDown={event => {
        event.stopPropagation(); event.preventDefault();
        if ((owner.current !== null && owner.current !== event.pointerId) || event.pointerType === 'touch' && !event.isPrimary) { release(); cancelSpeedStroke(); return; }
        if (event.button !== 0 || spacePan) return;
        const box = event.currentTarget.getBoundingClientRect();
        const result = beginSpeedStroke({ x: event.clientX, y: event.clientY }, event.pointerId, { x: box.left, y: box.top, width: box.width, height: box.height }, viewportRef.current);
        if (!result.ok) { if (result.problems[0].code !== 'brush/outside') pushNotice('error', result.problems[0].message); return; }
        owner.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus({ preventScroll: true });
      }} onPointerMove={event => {
        event.stopPropagation(); cursor.current = { x: event.clientX, y: event.clientY };
        if (owner.current === event.pointerId) {
          const coalesced = event.nativeEvent.getCoalescedEvents?.();
          appendSpeedSamples((coalesced?.length ? coalesced : [event.nativeEvent]).map(p => ({ x: p.clientX, y: p.clientY })));
        }
        schedule();
      }} onPointerUp={event => {
        event.stopPropagation(); if (owner.current !== event.pointerId) return;
        appendSpeedSamples([{ x: event.clientX, y: event.clientY }]); release();
        const result = commitSpeedStroke(); if (!result.ok) pushNotice('error', result.problems[0].message);
      }} onPointerCancel={event => { event.stopPropagation(); release(); cancelSpeedStroke(); }}
      onLostPointerCapture={() => { if (owner.current !== null) { release(); cancelSpeedStroke(); } }}
      onPointerLeave={() => { if (circle.current) circle.current.style.display = 'none'; }}
      onWheel={() => { release(); cancelSpeedStroke(); }}>
      <circle ref={circle} className="speed-brush-cursor" style={{ display: 'none' }} />
    </svg>
    <FloatingEditPanel title="速度线笔刷"><div className="speed-brush-controls" role="region" aria-label="速度线笔刷设置">
      <span>拖动确定直线方向和长度 · 松手完成一笔</span>
      <BrushNumber field="radius" label="范围" value={options.radius} /><BrushNumber field="density" label="密度" value={options.density} />
      <BrushNumber field="strokeWidth" label="线宽" value={options.strokeWidth} /><BrushNumber field="irregularity" label="不规整度" value={options.irregularity} />
      <label>颜色<input type="color" aria-label="笔刷颜色" value={options.color.slice(0, 7)} onChange={e => setSpeedBrushOptions({ ...speedBrushStore.getState().options, color: `${e.target.value}FF` })} /></label>
      <button onClick={()=>{const r=openPresetDialog({brush:true});if(!r.ok)pushNotice('error',r.problems[0].message);}}>保存笔刷预设…</button><button onClick={returnToSelection}>返回选择</button><small>不规整度调节线距、长短和粗细；参数用于下一笔</small>
      {error && <span role="alert">{error}</span>}
    </div></FloatingEditPanel>
  </>;
}
