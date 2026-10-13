import { useEffect, useRef, useState } from 'react';
import { pushNotice } from '../state/sessionStore';
import './colorFields.css';

/** Native picker is uncontrolled: React must not reset its accepted value before change fires. */
export function RgbaColorField({ label, value, apply }: { label: string; value: string; apply: (color: string) => void }) {
  const [draft, setDraft] = useState(value), [alpha, setAlpha] = useState(String(Math.round(parseInt(value.slice(7), 16) / 255 * 100)));
  const picker = useRef<HTMLInputElement>(null), cancelled = useRef(false), accept = useRef(apply); accept.current = apply;
  useEffect(() => { setDraft(value); setAlpha(String(Math.round(parseInt(value.slice(7), 16) / 255 * 100))); }, [value]);
  useEffect(() => {
    const node = picker.current; if (!node) return;
    const changed = () => { const color = (node.value + value.slice(7)).toUpperCase(); if (color !== value.toUpperCase()) accept.current(color); };
    node.addEventListener('change', changed); return () => node.removeEventListener('change', changed);
  }, [value, label]);
  const finishHex = () => {
    if (cancelled.current) { setDraft(value); return; }
    let color = draft.trim().toUpperCase(); if (/^#[0-9A-F]{6}$/.test(color)) color += value.slice(7).toUpperCase();
    if (!/^#[0-9A-F]{8}$/.test(color)) { pushNotice('error', '请输入#RRGGBB或#RRGGBBAA颜色'); setDraft(value); return; }
    if (color !== value.toUpperCase()) accept.current(color); setDraft(color);
  };
  const finishAlpha = () => {
    const n = Number(alpha); if (cancelled.current) { setAlpha(String(Math.round(parseInt(value.slice(7), 16) / 255 * 100))); return; }
    if (!alpha.trim() || !Number.isFinite(n) || n < 0 || n > 100) { pushNotice('error', '颜色透明度必须在0～100%之间'); setAlpha(String(Math.round(parseInt(value.slice(7), 16) / 255 * 100))); return; }
    const color = (value.slice(0, 7) + Math.round(n / 100 * 255).toString(16).padStart(2, '0')).toUpperCase(); if (color !== value.toUpperCase()) accept.current(color);
  };
  const keys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelled.current = true; e.currentTarget.blur(); }
  };
  return <div className="panel-style-color rgba-color-field"><label className="color-field">{label}<input style={{opacity:parseInt(value.slice(7),16)/255}} key={`${label}:${value}`} ref={picker} aria-label={label} type="color" defaultValue={value.slice(0, 7)} /></label>
    <label className="field"><span>RGBA</span><input aria-label={`${label}RGBA`} value={draft} onFocus={() => { cancelled.current = false; }} onChange={e => setDraft(e.target.value)} onBlur={finishHex} onKeyDown={keys} /></label>
    <label className="field"><span>透明度 %</span><input type="number" min={0} max={100} step={1} aria-label={`${label}透明度 %`} value={alpha} onFocus={() => { cancelled.current = false; }} onChange={e => setAlpha(e.target.value)} onBlur={finishAlpha} onKeyDown={keys} /></label>
  </div>;
}
