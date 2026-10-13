import {documentStore} from '../state/documentStore';
import {BrushPreview} from './BrushPreview';
import { useStore } from 'zustand';
import { comicDrawStore,setComicPaintOptions } from './controller';
import { flashPreset, parseFlash } from './model';
import type { FlashOptions, FlashPreset } from './types';
import { MangaNumber } from '../bubbles/MangaFields';
import { RgbaColorField } from '../bubbles/RgbaColorField';
import { pushNotice, sessionStore } from '../state/sessionStore';

export const FLASH_LABELS:Record<FlashPreset,string>={flash:'效果线',inverse:'反白效果线',dense:'密集效果线',urchin:'海胆效果线',firework:'烟火'};
export function FlashFields({value,set,expanded=true}:{value:FlashOptions;set:(v:FlashOptions)=>void;expanded?:boolean}) {
  const patch=(p:Partial<FlashOptions>)=>{const r=parseFlash({...value,...p});if(r.ok)set(r.value);else pushNotice('error',r.problems[0].message);};
  const n=(label:string,key:'brushSize'|'spacing'|'length'|'lengthJitter'|'referenceJitter'|'seed',min:number,max:number,step=1)=><MangaNumber key={key} label={label} min={min} max={max} step={step} value={value[key]} apply={v=>{patch({[key]:v});return {ok:true,value:undefined};}}/>;
  return <>{expanded&&<BrushPreview flash={value}/>}<label>效果线预设<select aria-label="效果线预设" value={value.preset} onChange={e=>set({...flashPreset(e.target.value as FlashPreset),seed:value.seed})}>{Object.entries(FLASH_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    {n('效果线笔刷尺寸','brushSize',.25,128,.25)}{n('效果线长度','length',1,2048)}
    {expanded&&<><RgbaColorField label="效果线底色" value={value.background} apply={background=>patch({background})}/><label><input type="checkbox" aria-label="效果线填充基底" checked={value.fillCenter} onChange={e=>patch({fillCenter:e.target.checked})}/>填充基底</label>
      <label>线条间距<select aria-label="效果线间距模式" value={value.spacingMode} onChange={e=>patch({spacingMode:e.target.value as FlashOptions['spacingMode'],spacing:8})}><option value="distance">距离 px</option><option value="angle">角度 °</option></select></label>{n('效果线间距','spacing',value.spacingMode==='angle'?.5:1,value.spacingMode==='angle'?90:256,.5)}
      {n('效果线长度不齐','lengthJitter',0,.9,.05)}{n('效果线基准偏移','referenceJitter',0,80)}<label><input type="checkbox" aria-label="效果线锯齿基准" checked={value.jagged} onChange={e=>patch({jagged:e.target.checked})}/>锯齿基准</label>{n('效果线随机种子','seed',0,0xffffffff)}<button onClick={()=>patch({seed:crypto.getRandomValues(new Uint32Array(1))[0]})}>重新生成效果线</button></>}
  </>;
}
export function ComicToolOptions({flash,expanded=false}:{flash:boolean;expanded?:boolean}) {
  const options=useStore(comicDrawStore,s=>s.flash),paint=useStore(comicDrawStore,s=>s.paint);
  const mode=useStore(sessionStore,s=>s.toolMode),selection=useStore(sessionStore,s=>s.selection),layer=useStore(documentStore,s=>s.project.layers[selection[0]]),eraser=mode==='paint-eraser',vectorEraser=eraser&&layer?.type==='decoration'&&layer.spec.kind==='paint'&&layer.spec.mode==='vector';
  if(flash)return <><FlashFields value={options} set={flash=>comicDrawStore.setState({flash})} expanded={expanded}/><span className="tool-option-hint">拖出椭圆基准 · 松手生成独立气泡 · Esc取消</span></>;
  const set=(patch:Partial<typeof paint>)=>{const r=setComicPaintOptions(patch);if(!r.ok)pushNotice('error',r.problems[0].message);};
  return <><MangaNumber label="绘画笔刷尺寸" min={1} max={512} value={paint.width} apply={width=>{set({width});return {ok:true,value:undefined};}}/>
    {!vectorEraser&&<MangaNumber label="绘画笔刷不透明度 %" min={0} max={100} value={paint.opacity*100} apply={v=>{set({opacity:v/100});return {ok:true,value:undefined};}}/>}
    {expanded&&<>{!eraser&&<RgbaColorField label="绘画笔刷颜色" value={paint.color} apply={color=>set({color})}/>}<label><input type="checkbox" aria-label="绘画笔刷压力" checked={paint.pressure} onChange={e=>set({pressure:e.target.checked})}/>触笔压力控制粗细</label><MangaNumber label="绘画防抖" min={0} max={.9} step={.05} value={paint.stabilization} apply={stabilization=>{set({stabilization});return {ok:true,value:undefined};}}/></>}
    <span className="tool-option-hint">栅格擦除像素 · 矢量擦除整条线 · 每笔一次撤销</span></>;
}
