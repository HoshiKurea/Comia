import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { PageBackgroundLayer, Result } from '../domain/types';
import { firstMessage } from '../domain/types';
import { getProject } from '../state/documentStore';
import { pushNotice, setSelection } from '../state/sessionStore';
import { deleteSelected } from '../app/actions';
import { backgroundEditStore, currentBackgroundEdit, previewPageBackground, commitBackgroundEdit, cancelBackgroundEdit } from './backgroundController';
import { backgroundTemplates } from './backgroundTemplates';
import { backgroundFrames, type BackgroundValues } from './backgroundGeometry';
import './background.css';
import { RangeNumberValue } from '../ui/RangeNumberField';

const notify = (result: Result<unknown>) => { if (!result.ok) pushNotice('error', firstMessage(result)); };
function NumberField({ label, value, min, max, update }: { label: string; value: number; min: number; max: number; update: (n: number) => Result<void> }) {
  const [draft, setDraft] = useState(String(value)), focused = useRef(false), cancelled = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(String(value)); }, [value]);
  return <label className="field"><span>{label}</span><input aria-label={label} type="number" min={min} max={max} value={draft}
    onFocus={() => { focused.current = true; cancelled.current = false; }} onChange={event => setDraft(event.target.value)}
    onBlur={() => { focused.current = false; if (!cancelled.current) { if (draft.trim() && Number.isFinite(Number(draft))) notify(update(Number(draft))); else pushNotice('error', `${label}不能为空`); } setDraft(String(value)); }}
    onKeyDown={event => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { event.stopPropagation(); cancelled.current = true; event.currentTarget.blur(); } }} /></label>;
}
function AlphaRange({ label, color, change }: { label: string; color: string; change: (color: string) => Result<void> }) {
  const node = useRef<HTMLInputElement>(null), frame = useRef<number | null>(null), pending = useRef<number | null>(null);
  const drag = useRef<{ id: number; left: number; width: number; token: number | null } | null>(null), update = useRef(change); update.current = change;
  const alpha = Math.round(parseInt(color.slice(7), 16) / 255 * 100), rgb = useRef(color.slice(0, 7)); rgb.current = color.slice(0, 7);
  const flush = () => {
    const value = pending.current; pending.current = null; if (value === null) return;
    if (drag.current && drag.current.token !== null && drag.current.token !== currentBackgroundEdit()?.token) return;
    notify(update.current(rgb.current + Math.round(value * 255 / 100).toString(16).padStart(2, '0').toUpperCase()));
    if (drag.current) drag.current.token = currentBackgroundEdit()?.token ?? null;
  };
  const stop = (commit: boolean) => {
    if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null;
    if (commit) flush(); else { pending.current = null; cancelBackgroundEdit(); }
    const held = drag.current; drag.current = null; if (held && node.current?.hasPointerCapture(held.id)) node.current.releasePointerCapture(held.id);
  };
  const queue = (x: number) => { const held = drag.current; if (!held) return; pending.current = Math.round(Math.max(0, Math.min(1, (x - held.left - 8) / Math.max(1, held.width - 16))) * 100); if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; flush(); }); };
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  return <label className="field"><span>{label}</span><RangeNumberValue label={label} value={Math.round(parseInt(color.slice(7),16)*1000/255)/10} min={0} max={100} step={.1} unit="%" apply={n=>{const result=change(color.slice(0,7)+Math.round(n*255/100).toString(16).padStart(2,'0').toUpperCase());return result.ok?commitBackgroundEdit():result;}}/><input ref={node} type="range" min="0" max="100" value={alpha} aria-label={label}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); const box = event.currentTarget.getBoundingClientRect(); drag.current = { id: event.pointerId, left: box.left, width: box.width, token: currentBackgroundEdit()?.token ?? null }; event.currentTarget.setPointerCapture(event.pointerId); queue(event.clientX); }}
    onPointerMove={event => { if (drag.current?.id === event.pointerId) queue(event.clientX); }} onPointerUp={event => { if (drag.current?.id === event.pointerId) { queue(event.clientX); stop(true); } }}
    onPointerCancel={() => stop(false)} onLostPointerCapture={event => { if (drag.current?.id === event.pointerId) stop(false); }}
    onChange={event => { if (!drag.current) { pending.current = Number(event.currentTarget.value); flush(); } }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); stop(false); } }} /></label>;
}
function ColorField({ label, color, change }: { label: string; color: string; change: (color: string) => Result<void> }) {
  return <div className="background-color"><label>{label}<input type="color" aria-label={label} value={color.slice(0, 7)} onChange={event => notify(change(event.target.value.toUpperCase() + color.slice(7)))} /></label><AlphaRange label={`${label}不透明度`} color={color} change={change} /></div>;
}
function WatermarkText({ value, change }: { value: string; change: (text: string) => Result<void> }) {
  const [draft, setDraft] = useState(value), focused = useRef(false), composing = useRef(false), cancelled = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(value); }, [value]);
  const finish = () => { focused.current = false; if (!cancelled.current) notify(change(draft)); setDraft(value); };
  return <label className="field"><span>水印文字</span><input aria-label="水印文字" value={draft} onFocus={() => { focused.current = true; cancelled.current = false; }} onChange={event => setDraft(event.target.value)} onBlur={finish}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={event => { if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return; if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { event.stopPropagation(); cancelled.current = true; event.currentTarget.blur(); } }} /></label>;
}
export function PageBackgroundInspector({ layer }: { layer: PageBackgroundLayer }) {
  const active = useStore(backgroundEditStore, state => state.active?.id === layer.id ? state.active : null);
  const previewLayer = active?.preview.layers[layer.id], current = previewLayer?.type === 'pageBackground' ? previewLayer : layer;
  const patch = (values: Partial<BackgroundValues>) => previewPageBackground(layer.id, values);
  const frame = current.frame, watermark = current.watermark, page = getProject().pages[layer.pageId], effective = backgroundFrames(page.width, page.height, frame);
  useEffect(() => () => { if (currentBackgroundEdit()?.id === layer.id) cancelBackgroundEdit(); }, [layer.id]);
  return <div className="page-background-inspector">
    <p className="hint">背景贴合纸张，模板只改变底层。删除背景后页面透明。</p>
    <fieldset disabled={layer.locked} className="background-fields">
      <div className="background-template-grid" aria-label="页面背景模板">{backgroundTemplates.map(template => <button key={template.id} type="button" aria-label={`背景模板：${template.name}`} onClick={() => notify(patch(template.values))}><span aria-hidden="true" className={`background-template-sample template-${template.id}`}>{template.id === 'watermark' ? 'Comia' : ''}</span>{template.name}</button>)}</div>
      <ColorField label="背景底色" color={current.fill} change={fill => patch({ fill })} />
      <label className="field"><span>页面边框</span><select aria-label="页面边框" value={frame?.kind ?? 'none'} onChange={event => notify(patch({ frame: event.target.value === 'none' ? null : { kind: event.target.value as 'single' | 'double', color: frame?.color ?? '#000000FF', width: frame?.width ?? 4, insetRatio: frame?.insetRatio ?? .04, gap: frame?.gap ?? 8 } }))}><option value="none">无边框</option><option value="single">单边框</option><option value="double">双边框</option></select></label>
      {frame && <><div className="field-grid"><NumberField label="页面边框粗细" value={frame.width} min={0} max={256} update={width => patch({ frame: { ...frame, width } })} /><NumberField label="页面边框内边距 %" value={frame.insetRatio * 100} min={0} max={45} update={value => patch({ frame: { ...frame, insetRatio: value / 100 } })} /></div>{frame.kind === 'double' && <NumberField label="双边框间隔" value={frame.gap} min={0} max={256} update={gap => patch({ frame: { ...frame, gap } })} />}<ColorField label="页面边框颜色" color={frame.color} change={color => patch({ frame: { ...frame, color } })} />{(effective.effectiveWidth < frame.width || effective.innerOmitted) && <p className="hint" role="status">小页面有效边宽 {effective.effectiveWidth.toFixed(1)} px{effective.innerOmitted ? '；仅能容纳外框' : ''}，请求参数仍保留。</p>}</>}
      <label className="background-toggle"><input aria-label="显示页面水印" type="checkbox" checked={!!watermark} onChange={event => notify(patch({ watermark: event.target.checked ? structuredClone(backgroundTemplates.find(item => item.id === 'watermark')!.values.watermark) : null }))} />页面水印</label>
      {watermark && <><WatermarkText value={watermark.content} change={content => patch({ watermark: { ...watermark, content } })} /><ColorField label="水印颜色" color={watermark.color} change={color => patch({ watermark: { ...watermark, color } })} /><div className="field-grid"><NumberField label="水印字号" value={watermark.fontSize} min={12} max={512} update={fontSize => patch({ watermark: { ...watermark, fontSize } })} /><NumberField label="水印角度" value={watermark.angleDeg} min={-180} max={180} update={angleDeg => patch({ watermark: { ...watermark, angleDeg } })} /></div><label className="background-toggle"><input aria-label="平铺水印" type="checkbox" checked={watermark.repeat} onChange={event => notify(patch({ watermark: { ...watermark, repeat: event.target.checked } }))} />平铺水印</label>{watermark.repeat && <div className="field-grid"><NumberField label="水印水平间距" value={watermark.spacingX} min={16} max={4096} update={spacingX => patch({ watermark: { ...watermark, spacingX } })} /><NumberField label="水印垂直间距" value={watermark.spacingY} min={16} max={4096} update={spacingY => patch({ watermark: { ...watermark, spacingY } })} /></div>}</>}
    </fieldset>
    {active && <div className="background-edit-actions" role="group" aria-label="背景编辑"><button onClick={() => notify(commitBackgroundEdit())}>完成背景编辑</button><button onClick={cancelBackgroundEdit}>取消背景编辑</button></div>}
    <button disabled={layer.locked} onClick={() => { cancelBackgroundEdit(); setSelection([layer.id]); notify(deleteSelected()); }}>删除页面背景</button>
    <p className="hint">PNG 保留透明；PDF 的透明区域按白纸显示。</p>
  </div>;
}
