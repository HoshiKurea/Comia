import { useState,useEffect } from 'react';
import type { Id,Project,Result } from '../domain/types';
import { pushNotice,sessionStore } from '../state/sessionStore';
import { PageList } from '../pages/PageList';
import { addPage,resizePage,setReadingDirection,type PageSizeInput,type PaperPreset } from '../pages/commands';
import { PageSetupDialog } from '../pages/PageSetupDialog';
function notice(r:Result<unknown>){if(!r.ok)pushNotice('error',r.problems[0].message);}
export function PageManagerPanel({project,pageId,rename,remove}:{project:Project;pageId:Id;rename:(id:Id)=>void;remove:(id:Id)=>void}) {
const currentPage=project.pages[pageId];
const [setupOpen,setSetupOpen]=useState(false);
useEffect(()=>setSetupOpen(false),[pageId,project.id]);
const [paperPreset,setPaperPreset]=useState<PaperPreset>('custom'),[paperOrientation,setPaperOrientation]=useState<'portrait'|'landscape'>('portrait'),[paperWidth,setPaperWidth]=useState(''),[paperHeight,setPaperHeight]=useState(''),[paperDpi,setPaperDpi]=useState('300');
useEffect(()=>{if(!currentPage)return;setPaperPreset('custom');setPaperOrientation('portrait');setPaperWidth(String(currentPage.width));setPaperHeight(String(currentPage.height));setPaperDpi(String(currentPage.dpi));},[pageId,currentPage?.width,currentPage?.height,currentPage?.dpi]);
const applyPageSize=()=>{const input:PageSizeInput={preset:paperPreset,orientation:paperOrientation,dpi:Number(paperDpi),widthPx:Number(paperWidth),heightPx:Number(paperHeight),snap16:sessionStore.getState().snap16};if(window.confirm('内容位置不变，超出页面边界的部分导出时裁切。继续修改页面尺寸？'))notice(resizePage(pageId,input));};
return <div className="pages">
          <div className="section-title"><span>项目页面</span><button className="tiny-action" onClick={() => notice(addPage(pageId))}>+ 新建漫画页</button></div>
          <PageList project={project} activeId={pageId} rename={rename} remove={remove} />
          <div className="page-settings"><strong>当前页面</strong>
            <button onClick={()=>setSetupOpen(true)}>漫画原稿与定位线设置…</button>
            {currentPage?.manuscript&&<div className="manuscript-current"><span>成品：{currentPage.manuscript.trim.widthMm} × {currentPage.manuscript.trim.heightMm} mm · 出血 {currentPage.manuscript.bleedMm} mm</span><span>基本框：{currentPage.manuscript.basicFrame.widthMm} × {currentPage.manuscript.basicFrame.heightMm} mm</span><span>定位线仅编辑时显示，不属于实际图层。</span></div>}
            <label>纸张 <select aria-label="纸张" value={paperPreset} onChange={(event) => setPaperPreset(event.target.value as PaperPreset)}><option value="custom">自定义像素</option><option value="A4">A4 · 210×297 mm</option><option value="B4-ISO">ISO B4 · 250×353 mm</option></select></label>
            <label>方向 <select aria-label="纸张方向" value={paperOrientation} onChange={(event) => setPaperOrientation(event.target.value as 'portrait' | 'landscape')}><option value="portrait">纵向</option><option value="landscape">横向</option></select></label>
            {paperPreset === 'custom' && <div className="page-dimensions"><label>宽 px<input aria-label="页面宽度" type="number" min="16" max="16384" value={paperWidth} onChange={(event) => setPaperWidth(event.target.value)} /></label><label>高 px<input aria-label="页面高度" type="number" min="16" max="16384" value={paperHeight} onChange={(event) => setPaperHeight(event.target.value)} /></label></div>}
            <label>DPI <input aria-label="页面 DPI" type="number" min="72" max="600" value={paperDpi} onChange={(event) => setPaperDpi(event.target.value)} /></label>
            <button onClick={applyPageSize}>应用页面尺寸</button>
            <label>阅读方向 <select aria-label="阅读方向" value={project.settings.readingDirection} onChange={(event) => notice(setReadingDirection(event.target.value as 'ltr' | 'rtl'))}><option value="ltr">左到右</option><option value="rtl">右到左</option></select></label>
          </div>
          {setupOpen&&currentPage&&<PageSetupDialog key={pageId} page={currentPage} close={()=>setSetupOpen(false)}/>}
        </div>;
}
