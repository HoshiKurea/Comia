import type { BubbleLayer, Result } from '../domain/types';
import { ok } from '../domain/types';
import { useStore } from 'zustand';
import { mangaEditStore, queueMangaPatch } from './mangaEditController';
import { applyHandDrawnPreset, beginBubbleShapeEdit, editableContour, regenerateBubbleContour, resetBubbleShape, setEditedBubbleShape, updateBubbleContour, updateHandDrawn } from './shapeController';
import { MangaNumber, reportManga } from './MangaFields';
import { RangeNumberValue } from '../ui/RangeNumberField';
import { openDrawingWindow } from '../freehand/session';

export function BubbleShapeInspector({bubble}:{bubble:BubbleLayer}){
  const active=useStore(mangaEditStore,s=>s.active?.id===bubble.id?s.active:null),current=active?.preview.layers[bubble.id];
  const b=current?.type==='bubble'?current:bubble,hand=b.handDrawn;
  const run=(fn:()=>Result<unknown>)=>{const began=beginBubbleShapeEdit(b.id);if(!began.ok){reportManga(began);return;}reportManga(fn());};
  const contour=active?(b.contour?ok(b.contour):editableContour(b)):null;
  if(b.shape==='freehand')return <section className="manga-inspector" aria-label="自由绘画气泡属性"><h4>自由绘画轮廓</h4><button disabled={!!active} onClick={()=>reportManga(openDrawingWindow(b.id))}>在绘画窗口编辑</button><p className="hint">用笔刷补画或擦除修形。边框与内外描边可在下方属性中调整；文字和尾巴继续独立编辑。</p></section>;
  return <section className="manga-inspector" aria-label="手绘气泡属性"><h4>轮廓与笔触</h4>
    <div className="button-stack"><button onClick={()=>run(()=>applyHandDrawnPreset('soft'))}>柔和手绘</button><button onClick={()=>run(()=>applyHandDrawnPreset('rough'))}>粗糙速写</button><button onClick={()=>reportManga(beginBubbleShapeEdit(b.id))}>编辑气泡轮廓</button></div>
    <label className="field"><span>情绪形状</span><select aria-label="情绪气泡形状" value={b.shape} onChange={e=>run(()=>setEditedBubbleShape(e.target.value as BubbleLayer['shape']))}>{[['roundRect','圆角对白'],['rect','方框旁白'],['circle','圆形'],['cloud','内心云朵'],['spiky','尖刺喊叫'],['handOval','不规则卵形'],['handPolygon','不规则多边形'],['wave','波浪紧张']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    {([['wobble','轮廓抖动',.03],['irregularity','不规则程度',.12],['pressure','笔压变化',.65]] as const).map(([field,label,max])=><label className="manga-slider" key={field}><span>{label}<RangeNumberValue label={label} min={0} max={max} step={.001} value={field==='wobble'&&b.edgeStyle?.recipe==='normal-offset-v1'?b.edgeStyle.wobble:hand?.[field]??0} disabled={!!b.contour&&field==='irregularity'} apply={n=>run(()=>updateHandDrawn({[field]:n}))}/></span><input aria-label={label} type="range" disabled={!!b.contour&&field==='irregularity'} title={b.contour&&field==='irregularity'?'手调节点已决定基础形状；重新生成后应用不规则参数':undefined} min={0} max={max} step={.001} value={field==='wobble'&&b.edgeStyle?.recipe==='normal-offset-v1'?b.edgeStyle.wobble:hand?.[field]??0} onChange={e=>{const n=Number(e.target.value);run(()=>{queueMangaPatch(field,()=>reportManga(updateHandDrawn({[field]:n})));return {ok:true,value:undefined};});}}/></label>)}
    <MangaNumber label="边缘种子" value={b.edgeStyle?.seed??hand?.seed??42} min={0} max={0xffffffff} step={1} apply={n=>{run(()=>updateHandDrawn({seed:n}));return{ok:true,value:undefined};}}/>{active&&contour?.ok&&<><MangaNumber key={`${b.id}-tension`} label="轮廓平滑程度" min={0} max={.5} step={.01} value={contour.value.tension} apply={n=>reportManga(updateBubbleContour(contour.value.nodes,n))}/><p className="hint">拖动画布上的节点修正轮廓；双击轮廓加节点，右键节点删除。{contour.value.nodes.length}/32 节点。手调节点保留；笔触抖动和笔压作为可关闭的派生效果；重新生成将替换手调节点。</p><button onClick={()=>run(regenerateBubbleContour)}>换一个笔触并重新生成</button><button onClick={()=>run(resetBubbleShape)}>恢复规整轮廓</button><p className="hint">在画布浮窗中完成或取消本次编辑。</p></>}
  </section>;
}
