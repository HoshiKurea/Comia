import { useState } from 'react';
import type { BubbleLayer, DecorationLayer } from '../domain/types';
import { changeLayer } from '../app/actions';
import { pushNotice } from '../state/sessionStore';
import { MangaNumber } from '../bubbles/MangaFields';
import { RgbaColorField } from '../bubbles/RgbaColorField';
import { FlashFields } from './ComicToolOptions';
import { activateComicTool } from './controller';
import type { BackgroundFillSpec, PaintLayerSpec } from './types';

const notice=(r:{ok:boolean;problems?:{message:string}[]})=>{if(!r.ok)pushNotice('error',r.problems?.[0].message??'编辑失败');};
export function FlashInspector({bubble}:{bubble:BubbleLayer}) {
  if(!bubble.flash)return null;
  return <section className="comic-properties"><h4>效果线</h4><FlashFields value={bubble.flash} set={flash=>notice(changeLayer(bubble.id,'修改效果线',layer=>{if(layer.type==='bubble'){layer.flash=flash;}}))}/><p className="hint">边框色控制线条，填充色控制基底。对白与尾巴继续独立编辑。</p><button onClick={()=>notice(changeLayer(bubble.id,'移除效果线',layer=>{if(layer.type==='bubble'){delete layer.flash;layer.style.borderWidth=3;}}))}>转为普通气泡</button></section>;
}
export function ComicLayerInspector({layer}:{layer:DecorationLayer}) {
  const [strokeId,setStrokeId]=useState(''),[nodeIndex,setNodeIndex]=useState(0);
  const spec=layer.spec;if(spec.kind!=='paint'&&spec.kind!=='background-fill')return null;
  const update=(mutate:(s:PaintLayerSpec|BackgroundFillSpec)=>void)=>notice(changeLayer(layer.id,'编辑绘画图层',l=>{if(l.type==='decoration'&&(l.spec.kind==='paint'||l.spec.kind==='background-fill'))mutate(l.spec);}));
  if(spec.kind==='background-fill')return <section className="comic-properties"><h4>{spec.mode==='tone'?'网点':spec.mode==='gradient'?'渐变':'纯色'}背景</h4>
    <RgbaColorField label="背景主色" value={spec.color} apply={color=>update(s=>{if(s.kind==='background-fill')s.color=color;})}/>
    {spec.mode!=='solid'&&<RgbaColorField label="背景底色" value={spec.secondary} apply={color=>update(s=>{if(s.kind==='background-fill')s.secondary=color;})}/>}
    {spec.mode!=='solid'&&<MangaNumber label="背景角度" min={-360} max={360} value={spec.angle} apply={angle=>{update(s=>{if(s.kind==='background-fill')s.angle=angle;});return {ok:true,value:undefined};}}/>}
    {spec.mode==='tone'&&<><MangaNumber label="网点频率 LPI" min={5} max={150} value={spec.frequency} apply={frequency=>{update(s=>{if(s.kind==='background-fill')s.frequency=frequency;});return {ok:true,value:undefined};}}/><MangaNumber label="网点浓度 %" min={0} max={100} value={spec.density} apply={density=>{update(s=>{if(s.kind==='background-fill')s.density=density;});return {ok:true,value:undefined};}}/><p className="hint">频率以每英寸线数计算，图层原始分辨率 {spec.dpi} dpi；网点可继续调整。</p></>}
  </section>;
  const stroke=spec.strokes.find(s=>s.id===strokeId)??spec.strokes[spec.strokes.length-1],index=stroke?Math.min(nodeIndex,stroke.points.length-1):0,point=stroke?.points[index];
  const editStroke=(mutate:(s:NonNullable<typeof stroke>)=>void)=>update(s=>{if(s.kind==='paint'){const selected=s.strokes.find(t=>t.id===stroke?.id);if(selected)mutate(selected);}});
  return <section className="comic-properties"><h4>{spec.mode==='raster'?'栅格':'矢量'}绘画</h4><div className="button-stack"><button onClick={()=>notice(activateComicTool('paint-pen'))}>画笔</button><button onClick={()=>notice(activateComicTool('paint-eraser'))}>橡皮擦</button></div><p className="hint">{spec.width}×{spec.height} 原始像素 · {spec.strokes.length}笔。{spec.mode==='raster'?'缩放保留像素，橡皮擦只擦本层。':'线条可缩放，橡皮擦删除整条线。'}</p>
    {spec.mode==='vector'&&stroke&&<><label>编辑线条<select aria-label="矢量编辑线条" value={stroke.id} onChange={e=>{setStrokeId(e.target.value);setNodeIndex(0);}}>{spec.strokes.map((s,i)=><option key={s.id} value={s.id}>线条 {i+1} · {s.points.length}点</option>)}</select></label><RgbaColorField label="矢量线条颜色" value={stroke.color} apply={color=>editStroke(s=>s.color=color)}/>
      <MangaNumber label="矢量线条粗细" min={1} max={512} value={stroke.width} apply={width=>{editStroke(s=>s.width=width);return {ok:true,value:undefined};}}/>
      <MangaNumber label="矢量节点" min={1} max={stroke.points.length} step={1} value={index+1} apply={v=>{setNodeIndex(Math.round(v)-1);return {ok:true,value:undefined};}}/>
      {point&&(['x','y'] as const).map(axis=><MangaNumber key={axis} label={`矢量节点 ${axis.toUpperCase()}`} min={0} max={axis==='x'?spec.width:spec.height} step={.25} value={point[axis]} apply={v=>{editStroke(s=>s.points[index][axis]=v);return {ok:true,value:undefined};}}/>)}<button onClick={()=>update(s=>{if(s.kind==='paint')s.strokes=s.strokes.filter(t=>t.id!==stroke.id);})}>删除当前线条</button></>}
  </section>;
}
