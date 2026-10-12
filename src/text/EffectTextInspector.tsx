import { useStore } from 'zustand';
import type { TextLayer } from '../domain/types';
import { textEditStore, queueTextEffects } from './editController';
import { applySfxPreset, setTextEffects, SFX_PRESETS } from './sfxPresets';
import { MangaNumber, reportManga } from '../bubbles/MangaFields';
import { RangeNumberValue } from '../ui/RangeNumberField';
export function EffectTextInspector({layer}:{layer:TextLayer}){
  const edit=useStore(textEditStore,s=>s.active?.layerId===layer.id?s.active:null),effects=edit?.draftEffects??layer.effects;if(!effects)return null;
  return <section className="manga-inspector" aria-label="声效字效果" data-text-edit-preserve><h4>声效字效果</h4><p className="hint">变形模板使用当前字体；内置 Noto 保证离线显示，未标为手写字体。应用模板保留已有文字。</p>{effects.recipe==='legacy-sfx-v5'&&<p className="hint">旧声效使用原绘制方式；修改排版、多行内容或新效果将切换到可变形的文字排版。</p>}
    <div className="button-stack">{SFX_PRESETS.map(p=><button key={p.id} onClick={()=>reportManga(applySfxPreset(layer.id,p.id))}>{p.name}模板</button>)}</div>
    <label className="field">描边RGBA<input aria-label="声效描边RGBA" defaultValue={effects.outlineColor} key={`${layer.id}-${effects.outlineColor}`} onBlur={e=>{if(e.target.value.toUpperCase()!==effects.outlineColor.toUpperCase())reportManga(setTextEffects(layer.id,{outlineColor:e.target.value.toUpperCase()}));}}/></label>
    <MangaNumber label="声效描边宽" value={effects.outlineWidth} min={0} max={64} apply={n=>reportManga(setTextEffects(layer.id,{outlineWidth:n}))}/><MangaNumber label="声效倾斜角" value={effects.shearDeg} min={-60} max={60} apply={n=>reportManga(setTextEffects(layer.id,{shearDeg:n}))}/>
    <label className="field">声效变形<select aria-label="声效变形" value={effects.deformation} onChange={e=>reportManga(setTextEffects(layer.id,{deformation:e.target.value as typeof effects.deformation}))}><option value="none">无</option><option value="arc">弧形</option><option value="wave">波浪</option><option value="impact">冲击</option></select></label>
    <MangaNumber label="声效变形力度" value={effects.amount} min={-.45} max={.45} step={.01} apply={n=>reportManga(setTextEffects(layer.id,{amount:n}))}/><MangaNumber label="声效波浪次数" value={effects.cycles} min={1} max={3} step={1} apply={n=>reportManga(setTextEffects(layer.id,{cycles:n}))}/>
    <label className="manga-slider"><span>声效力度滑杆<RangeNumberValue label="声效力度滑杆" value={effects.amount} min={-.45} max={.45} step={.001} apply={amount=>queueTextEffects(layer.id,'amount',{amount})}/></span><input aria-label="声效力度滑杆" type="range" min={-.45} max={.45} step={.001} value={effects.amount} onChange={e=>reportManga(queueTextEffects(layer.id,'amount',{amount:Number(e.target.value)}))}/></label>
  </section>;
}
