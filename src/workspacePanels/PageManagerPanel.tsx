import { useState,useEffect } from 'react';
import type { Id,Project,Result } from '../domain/types';
import { pushNotice,sessionStore } from '../state/sessionStore';
import { PageList } from '../pages/PageList';
import { addPage,resizePage,setReadingDirection,type PageSizeInput,type PaperPreset } from '../pages/commands';
import { PageSetupDialog } from '../pages/PageSetupDialog';
import { pageDimensionsMm, isB5Manuscript } from '../pages/paperSizes';
function notice(r:Result<unknown>){if(!r.ok)pushNotice('error',r.problems[0].message);}
export function PageManagerPanel({project,pageId,rename,remove}:{project:Project;pageId:Id;rename:(id:Id)=>void;remove:(id:Id)=>void}) {
const currentPage=project.pages[pageId];
const [setupOpen,setSetupOpen]=useState(false);
useEffect(()=>setSetupOpen(false),[pageId,project.id]);
const [paperPreset,setPaperPreset]=useState<PaperPreset|'comic-B5'>('comic-B5'),[paperOrientation,setPaperOrientation]=useState<'portrait'|'landscape'>('portrait'),[paperWidth,setPaperWidth]=useState(''),[paperHeight,setPaperHeight]=useState(''),[paperDpi,setPaperDpi]=useState('300');
const [paperUnit,setPaperUnit]=useState<'mm'|'px'>('mm');
useEffect(()=>{if(!currentPage)return;const mm=pageDimensionsMm(currentPage);setPaperPreset(isB5Manuscript(currentPage)?'comic-B5':'custom');setPaperOrientation(currentPage.width>currentPage.height?'landscape':'portrait');setPaperWidth(String(paperUnit==='mm'?mm.width:currentPage.width));setPaperHeight(String(paperUnit==='mm'?mm.height:currentPage.height));setPaperDpi(String(currentPage.dpi));},[pageId,currentPage?.width,currentPage?.height,currentPage?.dpi]);
const changeUnit=(unit:'mm'|'px')=>{if(unit===paperUnit)return;const dpi=Number(paperDpi);if(!Number.isInteger(dpi)||dpi<72||dpi>600){pushNotice('error','请先输入72～600的整数DPI');return;}const nominal=currentPage&&Number(paperWidth)===currentPage.width&&Number(paperHeight)===currentPage.height?pageDimensionsMm(currentPage):null;const convert=(value:string,axis:'width'|'height')=>!value.trim()?'':String(unit==='px'?Math.round(Number(value)*dpi/25.4):nominal?.[axis]??Number((Number(value)*25.4/dpi).toFixed(6)));setPaperWidth(convert(paperWidth,'width'));setPaperHeight(convert(paperHeight,'height'));setPaperUnit(unit);};
const changeOrientation=(orientation:'portrait'|'landscape')=>{if((orientation==='landscape'&&Number(paperWidth)<Number(paperHeight))||(orientation==='portrait'&&Number(paperWidth)>Number(paperHeight))){setPaperWidth(paperHeight);setPaperHeight(paperWidth);}setPaperOrientation(orientation);};
const applyPageSize=()=>{const axis=(value:string)=>!value.trim()?NaN:paperUnit==='mm'?Math.round(Number(value)*Number(paperDpi)/25.4):Number(value);const input:PageSizeInput={preset:paperPreset==='comic-B5'?'custom':paperPreset,orientation:(paperPreset==='custom'||paperPreset==='comic-B5')?'portrait':paperOrientation,dpi:Number(paperDpi),widthPx:axis(paperWidth),heightPx:axis(paperHeight),snap16:paperUnit==='px'&&sessionStore.getState().snap16};if(window.confirm('内容位置不变，超出页面边界的部分导出时裁切。继续修改原稿画布尺寸？'))notice(resizePage(pageId,input));};
return <div className="pages">
          <div className="section-title"><span>项目页面</span><button className="tiny-action" onClick={() => notice(addPage(pageId))}>+ 新建漫画页</button></div>
          <PageList project={project} activeId={pageId} rename={rename} remove={remove} unit={paperUnit} />
          <div className="page-settings"><strong>当前页面</strong>
            <button onClick={()=>setSetupOpen(true)}>漫画原稿与定位线设置…</button>
            {currentPage?.manuscript&&<div className="manuscript-current"><strong>纸张：{isB5Manuscript(currentPage)?'B5 漫画原稿':'自定义漫画原稿'}</strong><span>原稿 {pageDimensionsMm(currentPage).width} × {pageDimensionsMm(currentPage).height} mm · {currentPage.dpi} DPI</span><span>出血 {currentPage.manuscript.bleedMm} mm · 基本框 {currentPage.manuscript.basicFrame.widthMm} × {currentPage.manuscript.basicFrame.heightMm} mm</span><span>定位线仅编辑时显示，不属于实际图层。</span></div>}
            <label>漫画纸张 <select aria-label="纸张" value={paperPreset} onChange={event=>{const preset=event.target.value as PaperPreset|'comic-B5';setPaperPreset(preset);if(preset==='comic-B5'){const horizontal=paperOrientation==='landscape',w=horizontal?297:210,h=horizontal?210:297;setPaperWidth(String(paperUnit==='mm'?w:Math.round(w*Number(paperDpi)/25.4)));setPaperHeight(String(paperUnit==='mm'?h:Math.round(h*Number(paperDpi)/25.4)));}}}><option value="comic-B5">B5 漫画原稿 · 210×297 mm</option><option value="custom">自定义原稿画布</option><option value="A4">210×297 mm（普通画布）</option><option value="B4-ISO">250×353 mm（普通画布）</option></select></label>
            <label>单位 <select aria-label="页面单位" value={paperUnit} onChange={event=>changeUnit(event.target.value as 'mm'|'px')}><option value="mm">mm</option><option value="px">px</option></select></label>
            <label>方向 <select aria-label="纸张方向" value={paperOrientation} onChange={(event) => changeOrientation(event.target.value as 'portrait' | 'landscape')}><option value="portrait">纵向</option><option value="landscape">横向</option></select></label>
            {(paperPreset === 'custom'||paperPreset==='comic-B5') && <div className="page-dimensions"><label>原稿宽 {paperUnit}<input aria-label="页面宽度" type="number" step={paperUnit==='mm'?'.01':'1'} value={paperWidth} onChange={(event) => {setPaperPreset('custom');setPaperWidth(event.target.value);}} /></label><label>原稿高 {paperUnit}<input aria-label="页面高度" type="number" step={paperUnit==='mm'?'.01':'1'} value={paperHeight} onChange={(event) => {setPaperPreset('custom');setPaperHeight(event.target.value);}} /></label></div>}
            <label>DPI <input aria-label="页面 DPI" type="number" min="72" max="600" value={paperDpi} onChange={(event) => setPaperDpi(event.target.value)} /></label>
            <button onClick={applyPageSize}>应用页面尺寸</button>
            <label>阅读方向 <select aria-label="阅读方向" value={project.settings.readingDirection} onChange={(event) => notice(setReadingDirection(event.target.value as 'ltr' | 'rtl'))}><option value="ltr">左到右</option><option value="rtl">右到左</option></select></label>
          </div>
          {setupOpen&&currentPage&&<PageSetupDialog key={pageId} page={currentPage} close={()=>setSetupOpen(false)}/>}
        </div>;
}
