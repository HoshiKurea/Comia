import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { Result, TextLayer } from '../domain/types';
import { runtimeStore } from '../state/runtimeStore';
import { pushNotice } from '../state/sessionStore';
import { actualFont, awaitFonts, fontCss } from './fonts';
import { beginTextEdit, textEditStore } from './editController';
import { setTextStyle } from './commands';
import { layoutText } from './layout';
import { APPLICATION_FONTS, fontCatalogStore, loadLocalFontCatalog } from './fontCatalog';
import { verticalFallbackMessage } from './verticalGlyphs';
import { resolveBubbleTextFrame } from './bubbleTextFrame';
import { getDocument } from '../state/documentStore';
import { setBubbleTextFrame } from './commands';

function notify(result: Result<unknown>): void { if (!result.ok) pushNotice('error', result.problems[0].message); }
function TextNumber({ label, value, min, max, disabled = false, commit }: { label: string; value: number; min: number; max: number; disabled?: boolean; commit: (value: number) => Result<void> }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <label className="field"><span>{label}</span><input aria-label={`文字${label}`} type="number" min={min} max={max} step="any" disabled={disabled} value={draft} onChange={(event) => setDraft(event.target.value)}
    onBlur={() => {
      if (draft === String(value)) return;
      const number = Number(draft);
      if (!draft.trim() || !Number.isFinite(number)) pushNotice('error', `${label}必须是有效数字`);
      else notify(commit(number));
      setDraft(String(value));
    }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(String(value)); } }} /></label>;
}
export function TextInspector({ layer }: { layer: TextLayer }) {
  const edit = useStore(textEditStore, (state) => state.active?.layerId === layer.id ? state.active : null);
  const generation = useStore(runtimeStore, (state) => state.fontGeneration);
  const fontCatalog = useStore(fontCatalogStore);
  const text = edit?.draft ?? layer.text;
  const patch = (value: Parameters<typeof setTextStyle>[1]) => setTextStyle(layer.id, value);
  const layout = useMemo(() => {
    const ctx = document.createElement('canvas').getContext('2d'); if (!ctx) return null;
    ctx.font = fontCss(text.font.family, text.font.size, text.font.bold, text.font.italic);
    if(layer.bubbleFrame?.placement==='center'){const source=edit?.preview??runtimeStore.getState().previewProject??getDocument().project,r=resolveBubbleTextFrame(source,layer.id,ctx,actualFont(text.font.family));if(r.ok)return r.value.layout;}
    return layoutText(text, layer.box, ctx);
  }, [text, layer.box, layer.bubbleFrame, generation, edit?.preview]);
  useEffect(() => {
    if (!edit) return;
    const controller = new AbortController();
    void awaitFonts(edit.preview, controller.signal, [layer.pageId]).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok) notify(result);
      else { const font = result.value.find((item) => item.requested === text.font.family); if (font?.fallback) pushNotice('info', `找不到字体“${font.requested}”，显示使用“${font.actual}”；项目中仍保留原字体名称`); }
    });
    return () => controller.abort();
  }, [layer.id, text.font.family, text.font.bold, text.font.italic]);
  return <div className="text-inspector" data-text-edit-preserve>
    {layer.bubbleFrame&&<section className="manga-inspector" aria-label="对白文字框"><h4>对白文字框</h4><p className="hint">{layer.bubbleFrame.placement==='legacy'?'旧自定义位置；居中操作将恢复主体中心。':layer.bubbleFrame.mode==='auto'?'随文字自动伸缩，整块对白居中。':'手动宽高控制换行，字形大小不变。'}</p>
      <div className="button-stack"><button disabled={!!edit?.composing} onClick={()=>notify(setBubbleTextFrame(layer.id,{mode:'auto',manualSize:null,placement:'center'}))}>恢复自动文字框</button><button disabled={!!edit?.composing} onClick={()=>{const b=layout?.frameBox??layer.box;notify(setBubbleTextFrame(layer.id,{mode:'manual',manualSize:{width:Math.max(1,Math.min(16384,b.width)),height:Math.max(1,Math.min(16384,b.height))},placement:'center'}));}}>手动文字框并居中</button></div>
      {layer.bubbleFrame.mode==='manual'&&<div className="field-grid"><TextNumber label="框宽" value={layer.bubbleFrame.manualSize!.width} min={1} max={16384} disabled={!!edit?.composing} commit={width=>setBubbleTextFrame(layer.id,{mode:'manual',manualSize:{width,height:Math.max(1,Math.min(16384,layer.bubbleFrame!.manualSize!.height))},placement:'center'})}/><TextNumber label="框高" value={layer.bubbleFrame.manualSize!.height} min={1} max={16384} disabled={!!edit?.composing} commit={height=>setBubbleTextFrame(layer.id,{mode:'manual',manualSize:{width:Math.max(1,Math.min(16384,layer.bubbleFrame!.manualSize!.width)),height},placement:'center'})}/></div>}
      {layout?.frameBox&&<p className="hint">当前框 {Math.round(layout.frameBox.width*10)/10} × {Math.round(layout.frameBox.height*10)/10} px；完成文字编辑时一起保存。</p>}
    </section>}
    <label className="field bubble-select"><span>字体</span><select aria-label="文字字体" value={text.font.family} onChange={(event) => notify(patch({ font: { family: event.target.value } }))}>{[...new Set([...APPLICATION_FONTS, ...fontCatalog.families, text.font.family])].map((family) => <option key={family} value={family}>{family}{!APPLICATION_FONTS.includes(family) && !fontCatalog.families.includes(family) ? '（项目请求）' : ''}</option>)}</select></label>
    <div className="button-stack"><button disabled={fontCatalog.loading} onClick={() => { void loadLocalFontCatalog().then(notify); }}>{fontCatalog.loading ? '正在读取字体…' : '读取本机字体列表'}</button></div>{fontCatalog.message && <p className="hint" role="status">{fontCatalog.message}</p>}
    {actualFont(text.font.family) !== text.font.family && <p className="hint">显示替代字体：{actualFont(text.font.family)}</p>}
    <TextNumber label="字号" value={text.font.size} min={1} max={512} commit={(size) => patch({ font: { size } })} />
    <label className="field bubble-select"><span>方向</span><select aria-label="文字方向" value={text.direction} onChange={(event) => notify(patch({ direction: event.target.value as 'horizontal' | 'vertical' }))}><option value="horizontal">横排</option><option value="vertical">竖排</option></select></label>
    <label className="field bubble-select"><span>对齐</span><select aria-label="文字对齐" disabled={layer.bubbleFrame?.placement==='center'} value={text.align} onChange={(event) => notify(patch({ align: event.target.value as 'start' | 'center' | 'end' }))}><option value="start">{text.direction === 'vertical' ? '上' : '左'}</option><option value="center">中</option><option value="end">{text.direction === 'vertical' ? '下' : '右'}</option></select></label>
    <div className="field-grid"><TextNumber label="行高" value={text.lineHeight} min={1} max={3} commit={(lineHeight) => patch({ lineHeight })} /><TextNumber label="字距" value={text.letterSpacing} min={-.2 * text.font.size} max={2 * text.font.size} disabled={text.direction === 'vertical'} commit={(letterSpacing) => patch({ letterSpacing })} /></div>
    <div className="button-stack"><button onClick={() => notify(patch({ font: { bold: !text.font.bold } }))}>{text.font.bold ? '取消加粗' : '加粗'}</button><button onClick={() => notify(patch({ font: { italic: !text.font.italic } }))}>{text.font.italic ? '取消斜体' : '斜体'}</button></div>
    <label className="color-field">文字颜色 <input aria-label="文字颜色" type="color" value={text.font.color.slice(0, 7)} onChange={(event) => notify(patch({ font: { color: `${event.target.value}FF` } }))} /></label>
    {layout?.overflow && <p role="status" className="text-overflow-status">文字溢出 · 超框内容仍可编辑和保存</p>}
    {Boolean(layout?.glyphFallbacks.length) && <p role="status" className="text-glyph-status">{verticalFallbackMessage(layout!.glyphFallbacks)}</p>}
    {/[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/u.test(text.content) && <p role="status" className="text-rtl-status">[待确认] Q08：当前不保证混合RTL双向排版，输入内容保留</p>}
    {!edit && <div className="button-stack"><button onClick={() => notify(beginTextEdit(layer.id))}>编辑文字</button></div>}
    <p className="hint">双击文字进入编辑；内容与样式在完成时一起提交</p>
  </div>;
}
