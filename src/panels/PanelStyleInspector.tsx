import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PanelLayer, Result } from '../domain/types';
import { firstMessage } from '../domain/types';
import { pushNotice } from '../state/sessionStore';
import { cancelPanelStyle, commitPanelStyle, currentPanelStyle, effectivePanelRadius, previewPanelColor, previewPanelStyle, setPanelStyle } from './style';
import './style.css';
import { RangeNumberValue } from '../ui/RangeNumberField';

const notify = (result: Result<unknown>) => { if (!result.ok) pushNotice('error', firstMessage(result)); };
function shared<T>(values: T[]): T | undefined { return values.every((value) => value === values[0]) ? values[0] : undefined; }
function useStyleOwner(suppressLateInput = false) {
  const token = useRef<number | null>(null);
  const suppressed = useRef(false);
  const start = () => { suppressed.current = false; notify(commitPanelStyle()); token.current = null; };
  const startKey = () => { if (token.current === null || token.current !== currentPanelStyle()?.token) start(); };
  const preview = (compute: () => Result<void>) => {
    if (suppressLateInput && suppressed.current) return;
    if (token.current !== null && currentPanelStyle()?.token !== token.current) { suppressed.current = true; token.current = null; return; }
    const result = compute(); notify(result); if (result.ok) token.current = currentPanelStyle()?.token ?? null;
  };
  const finish = () => {
    suppressed.current = true;
    const owned = token.current; token.current = null;
    if (owned !== null && currentPanelStyle()?.token === owned) notify(commitPanelStyle());
  };
  const cancel = () => {
    suppressed.current = true;
    const owned = token.current; token.current = null;
    if (owned !== null && currentPanelStyle()?.token === owned) cancelPanelStyle();
  };
  return { preview, finish, cancel, start, startKey };
}

function PreviewRange({ label, min, max, value, valueText, preview }: { label: string; min: number; max: number; value: number; valueText: string; preview: (value: number) => Result<void> }) {
  const owner = useStyleOwner(true), node = useRef<HTMLInputElement>(null);
  const pointer = useRef<{ id: number; left: number; width: number } | null>(null);
  const pending = useRef<number | null>(null), frame = useRef<number | null>(null);
  const apply = useRef(preview); apply.current = preview;
  const flush = () => { const next = pending.current; pending.current = null; if (next !== null) owner.preview(() => apply.current(next)); };
  const stop = (commit: boolean) => {
    if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null;
    if (commit) flush(); else pending.current = null;
    const captured = pointer.current; pointer.current = null;
    if (commit) owner.finish(); else owner.cancel();
    if (captured && node.current?.hasPointerCapture(captured.id)) node.current.releasePointerCapture(captured.id);
  };
  const queue = (clientX: number) => {
    const drag = pointer.current; if (!drag) return;
    const ratio = drag.width > 16 ? Math.max(0, Math.min(1, (clientX - drag.left - 8) / (drag.width - 16))) : 0;
    pending.current = Math.round(min + (max - min) * ratio);
    if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; flush(); });
  };
  useEffect(() => () => stop(false), []);
  return <input ref={node} className="preview-range" aria-label={label} type="range" min={min} max={max} step="1" value={value} aria-valuetext={valueText}
    onPointerDown={(event) => {
      if (event.button !== 0 || pointer.current) return;
      // Own pointer input instead of competing with the browser's native thumb
      // drag. Keep the native range's keyboard and accessibility semantics.
      event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); owner.start();
      const rect = event.currentTarget.getBoundingClientRect(); pointer.current = { id: event.pointerId, left: rect.left, width: rect.width };
      // Establish the controller's epoch/token and cancellation registration
      // before a queued frame, including a document replacement in this task.
      owner.preview(() => apply.current(value));
      event.currentTarget.setPointerCapture(event.pointerId); queue(event.clientX);
    }} onPointerMove={(event) => { if (pointer.current?.id === event.pointerId) queue(event.clientX); }}
    onPointerUp={(event) => { if (pointer.current?.id === event.pointerId) { queue(event.clientX); stop(true); } }}
    onPointerCancel={(event) => { if (pointer.current?.id === event.pointerId) stop(false); }}
    onLostPointerCapture={(event) => { if (pointer.current?.id === event.pointerId) stop(false); }}
    onInput={(event) => { if (!pointer.current) { const next = Number(event.currentTarget.value); owner.preview(() => apply.current(next)); } }}
    onBlur={() => stop(true)} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); stop(false); }
      else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
        if (pointer.current) event.preventDefault(); else owner.startKey();
      }
    }} onKeyUp={(event) => { if (!pointer.current && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) owner.finish(); }} />;
}
function NumberProperty({ panels, field, label, max }: { panels: PanelLayer[]; field: 'borderRadius' | 'borderWidth'; label: string; max: number }) {
  const value = shared(panels.map((panel) => panel.style[field])), ids = panels.map((panel) => panel.id), key = ids.join(',');
  const [draft, setDraft] = useState(value === undefined ? '' : String(value)), editing = useRef(false), cancelled = useRef(false);
  useLayoutEffect(() => { if (!editing.current) setDraft(value === undefined ? '' : String(value)); }, [value, key]);
  const commit = () => {
    editing.current = false;
    if (!cancelled.current && draft.trim()) { const number = Number(draft); notify(setPanelStyle(ids, { [field]: number })); }
    else if (!cancelled.current && value !== undefined) pushNotice('error', `${label}不能为空`);
    setDraft(value === undefined ? '' : String(value));
  };
  return <div className="panel-style-number"><label className="field"><span>{label}</span><input aria-label={`对象${label}`} type="number" min="0" max={max} placeholder="—" value={draft} onFocus={() => { editing.current = true; cancelled.current = false; }} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled.current = true; event.currentTarget.blur(); }
  }} /></label><PreviewRange label={`${label}滑块`} min={0} max={max} value={value ?? 0} valueText={value === undefined ? '混合值' : String(value)} preview={(number) => previewPanelStyle(ids, { [field]: number })} />
  </div>;
}

function ColorProperty({ panels, field, label }: { panels: PanelLayer[]; field: 'fill' | 'borderColor'; label: string }) {
  const ids = panels.map((panel) => panel.id), key = ids.join(','), value = shared(panels.map((panel) => panel.style[field]));
  const rgb = shared(panels.map((panel) => panel.style[field].slice(0, 7))), alpha = shared(panels.map((panel) => Math.round(parseInt(panel.style[field].slice(7), 16) / 255 * 100)));
  const alphaNumber=shared(panels.map(panel=>Math.round(parseInt(panel.style[field].slice(7),16)*1000/255)/10));
  const [draft, setDraft] = useState(value ?? ''), ref = useRef<HTMLInputElement>(null), editing = useRef(false), cancelled = useRef(false);
  const rgbOwner = useStyleOwner();
  useLayoutEffect(() => { if (!editing.current) setDraft(value ?? ''); }, [value, key]);
  // React's color onChange also receives intermediate input events. Native change
  // is the browser picker's final acceptance, while input only updates the draft.
  useEffect(() => { const node = ref.current; if (!node) return; const done = () => rgbOwner.finish(); node.addEventListener('change', done); return () => node.removeEventListener('change', done); }, []);
  const commit = () => { editing.current = false; if (!cancelled.current && draft.trim()) notify(setPanelStyle(ids, { [field]: draft.trim() })); else if (!cancelled.current && value !== undefined) pushNotice('error', `${label}不能为空`); setDraft(value ?? ''); };
  return <div className="panel-style-color"><label className="color-field">{label}<input ref={ref} aria-label={label} type="color" value={rgb ?? '#000000'} onPointerDown={rgbOwner.start} onInput={(event) => rgbOwner.preview(() => previewPanelColor(ids, field, 'rgb', event.currentTarget.value))} onBlur={rgbOwner.finish} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); rgbOwner.cancel(); } }} />{rgb === undefined && <small>混合</small>}</label>
    <label className="field"><span>RGBA</span><input aria-label={`${label}RGBA`} value={draft} placeholder="—" onFocus={() => { editing.current = true; cancelled.current = false; }} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled.current = true; event.currentTarget.blur(); } }} /></label>
    <label className="field"><span>透明度</span><RangeNumberValue label={`${label}透明度`} value={alphaNumber} min={0} max={100} step={.1} unit="%" apply={number=>{const result=previewPanelColor(ids,field,'alpha',number);return result.ok?commitPanelStyle():result;}}/><PreviewRange label={`${label}透明度`} min={0} max={100} value={alpha ?? 100} valueText={alpha === undefined ? '混合值' : `${alpha}%`} preview={(number) => previewPanelColor(ids, field, 'alpha', number)} /></label>
  </div>;
}

export function PanelStyleInspector({ panels, disabled = false }: { panels: PanelLayer[]; disabled?: boolean }) {
  const key = panels.map((panel) => panel.id).join(','); useEffect(() => () => cancelPanelStyle(), [key]);
  const actual = panels.map(effectivePanelRadius), requested = panels.map((panel) => panel.style.borderRadius), reduced = actual.some((radius, index) => radius < requested[index] - 1e-6);
  return <fieldset className="inspector-edit panel-style" disabled={disabled} aria-label="分镜样式"><div className="field-grid"><NumberProperty panels={panels} field="borderWidth" label="边框" max={256} />{panels.some(panel => panel.geometryMode === 'simple') ? <p className="hint">自由轮廓使用“修正分格”平滑边缘</p> : <NumberProperty panels={panels} field="borderRadius" label="圆角" max={4096} />}</div>
    {reduced && <p className="hint" role="status">保留请求圆角；几何限制后的有效半径 {shared(actual) === undefined ? `${Math.min(...actual).toFixed(1)}～${Math.max(...actual).toFixed(1)}` : actual[0].toFixed(1)} px</p>}
    <ColorProperty panels={panels} field="fill" label="填充色" /><ColorProperty panels={panels} field="borderColor" label="边框色" />
  </fieldset>;
}
