import {BubbleBrushOptions} from '../bubbles/BubbleBrushOptions';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {useStore} from 'zustand';
import {sessionStore,pushNotice} from '../state/sessionStore';
import {drawingStore,cancelDrawing} from '../panels/drawingController';
import {maskEditStore,selectMaskTarget,commitMaskEdit,cancelMaskEdit} from '../images/maskController';
import {cropEditStore,commitCropEdit,cancelCropEdit} from '../images/cropController';
import {trimEditStore,commitImageTrim,cancelImageTrim} from '../images/trimController';
import {setImageMaskShape} from '../interaction/imageMaskTool';
import {effectiveDisplayTool} from '../interaction/imageCropTool';
import {setPanelCutGap} from '../interaction/panelCutTool';
import {cancelActiveGesture} from '../interaction/activeGesture';
import type {ImageLayer,ImageMask,Result} from '../domain/types';
import type {CommandId} from '../commands/catalog';
import {AreaSelectionOptions} from './AreaSelectionOptions';
import './toolOptions.css';

const labels:Record<string,string>={select:'移动/点选',marquee:'矩形框选',lasso:'自由套索',geometry:'几何编辑','panel-cut':'分镜切割','image-crop':'素材裁剪','image-mask':'素材遮罩',crop:'调整框内图片',text:'文字编辑','speed-brush':'速度线笔刷','bubble-brush':'手绘气泡'};
const command:Partial<Record<string,CommandId>>={select:'tool-select',marquee:'tool-marquee',lasso:'tool-lasso',geometry:'tool-geometry','panel-cut':'tool-panel-cut','image-crop':'tool-image-crop','image-mask':'tool-image-mask','bubble-brush':'tool-bubble-brush'};
function notice(r:Result<unknown>){if(!r.ok)pushNotice('error',r.problems[0].message);}
function Controls({disabled,bindings,prefix=''}:{disabled:boolean;bindings:Partial<Record<CommandId,string>>;prefix?:string}){
  const mode=useStore(sessionStore,s=>s.toolMode),gap=useStore(sessionStore,s=>s.panelCutGap);
  const line=useStore(drawingStore,s=>s.active?.kind==='line'),lineGap=useStore(drawingStore,s=>s.active?.kind==='line'?s.active.gap:null),error=useStore(drawingStore,s=>s.active?.kind==='line'?s.active.error:'');
  const mask=useStore(maskEditStore,s=>!!s.active),target=useStore(maskEditStore,s=>s.active?.target),shape=useStore(maskEditStore,s=>{const a=s.active;return a?(a.preview.layers[a.imageId] as ImageLayer).mask?.shape:null;});
  const crop=useStore(cropEditStore,s=>!!s.active),trim=useStore(trimEditStore,s=>!!s.active),display=effectiveDisplayTool(mode,line,mask,crop,trim);
  const cutGap=lineGap??gap,cutError=error||(!Number.isFinite(cutGap)||cutGap<0||cutGap>256?'切割间隙须为0～256px':'');
  if(display==='bubble-brush')return <BubbleBrushOptions expanded={!!prefix}/>;
  if(display==='marquee'||display==='lasso')return <AreaSelectionOptions moveBinding={bindings['tool-select']||''} labelPrefix={prefix}/>;
  if(display==='panel-cut')return <>
    <label>间隙<input aria-label={`${prefix}切割工具间隙`} type="number" min="0" max="256" step="1" disabled={disabled} value={Number.isFinite(lineGap??gap)?lineGap??gap:''} onChange={e=>{const value=e.target.value.trim()?Number(e.target.value):NaN;setPanelCutGap(value);}}/>px</label>
    <span className="tool-option-hint" title={cutError||'从分镜上开始拖动一条穿过边界的直线，松手切割。结果为独立图层。'}>{cutError||'拖线穿过分镜 · 松手切割 · Esc取消'}</span>
    {line&&<button disabled={disabled} onClick={()=>{cancelActiveGesture();cancelDrawing();}}>取消切割</button>}
  </>;
  if(display==='image-crop')return trim?<><button disabled={disabled} onClick={()=>notice(commitImageTrim())}>应用裁剪</button><button disabled={disabled} onClick={cancelImageTrim}>取消裁剪</button><span className="tool-option-hint">拖裁剪框改变选择范围 · 库原图保留 · Enter应用</span></>:<span className="tool-option-hint">点击画布素材进入真正裁剪</span>;
  if(display==='image-mask')return mask?<>
    <label>形状<select aria-label={`${prefix}遮罩工具形状`} disabled={disabled} value={shape??'rect'} onChange={e=>notice(setImageMaskShape(e.target.value as ImageMask['shape']))}><option value="rect">矩形</option><option value="ellipse">椭圆</option><option value="polygon">多边形</option></select></label>
    <button disabled={disabled} aria-pressed={target==='mask'} onClick={()=>selectMaskTarget('mask')}>遮罩</button><button disabled={disabled} aria-pressed={target==='image'} onClick={()=>selectMaskTarget('image')}>图片</button>
    <button disabled={disabled} onClick={()=>notice(commitMaskEdit())}>应用遮罩</button><button disabled={disabled} onClick={()=>{cancelActiveGesture();cancelMaskEdit();}}>取消遮罩</button><span className="tool-option-hint">只隐藏像素，素材选择范围保持</span>
  </>:<span className="tool-option-hint">点击素材调整独立遮罩</span>;
  if(display==='crop')return <><span className="tool-option-hint">调整框内图片 · 使用画布取景控制</span><button disabled={disabled} onClick={()=>notice(commitCropEdit())}>应用取景</button><button disabled={disabled} onClick={cancelCropEdit}>取消取景</button></>;
  const help=display==='select'?'Shift单击多选 · Alt单击选框内素材':display==='geometry'?'Ctrl拖单节点 · 横纵吸附 · Alt临时自由':display==='text'?'输入文字 · Ctrl+Enter完成 · Esc取消':display==='speed-brush'?'按住拖动绘制速度线 · Esc取消':'选择对象后调整属性';
  return <span className="tool-option-hint">{help}</span>;
}
export function ToolOptionsBar({disabled,bindings}:{disabled:boolean;bindings:Partial<Record<CommandId,string>>}){
  const mode=useStore(sessionStore,s=>s.toolMode),line=useStore(drawingStore,s=>s.active?.kind==='line'),mask=useStore(maskEditStore,s=>!!s.active),crop=useStore(cropEditStore,s=>!!s.active),trim=useStore(trimEditStore,s=>!!s.active),display=effectiveDisplayTool(mode,line,mask,crop,trim);
  const [expanded,setExpanded]=useState(false),[overflow,setOverflow]=useState(false),[position,setPosition]=useState({left:8,top:8,width:420,maxHeight:400});
  const bar=useRef<HTMLDivElement>(null),available=useRef<HTMLDivElement>(null),controls=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),popover=useRef<HTMLDivElement>(null);
  const close=(focus=false)=>{setExpanded(false);if(focus)trigger.current?.focus({preventScroll:true});};
  const place=()=>{const a=trigger.current?.getBoundingClientRect();if(!a)return;const width=Math.min(420,window.innerWidth-16),height=Math.min(popover.current?.scrollHeight??300,window.innerHeight-16),below=a.bottom+6;const top=below+height<=window.innerHeight-8?below:Math.max(8,a.top-height-6);setPosition({left:Math.max(8,Math.min(a.right-width,window.innerWidth-width-8)),top,width,maxHeight:Math.max(0,window.innerHeight-top-8)});};
  useLayoutEffect(()=>{const measure=()=>{if(available.current&&controls.current)setOverflow(controls.current.scrollWidth>available.current.clientWidth+1);};const observer=new ResizeObserver(measure);if(available.current)observer.observe(available.current);if(controls.current)observer.observe(controls.current);measure();return()=>observer.disconnect();},[display,mask,crop,trim,line]);
  useEffect(()=>setExpanded(false),[display]);
  useLayoutEffect(()=>{if(expanded)place();},[expanded,display]);
  useEffect(()=>{if(!expanded)return;const outside=(e:PointerEvent)=>{if(!bar.current?.contains(e.target as Node)&&!popover.current?.contains(e.target as Node))close();};const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();e.stopImmediatePropagation();close(true);}};const resize=()=>place();document.addEventListener('pointerdown',outside,true);window.addEventListener('keydown',key,true);window.addEventListener('resize',resize);return()=>{document.removeEventListener('pointerdown',outside,true);window.removeEventListener('keydown',key,true);window.removeEventListener('resize',resize);};},[expanded]);
  const id=command[display],binding=id?bindings[id]:'';
  return <><div ref={bar} role="toolbar" aria-label="工具选项" className="tool-options-bar">
    <strong className="tool-option-name" title={binding?`${labels[display]??display} · ${binding}`:labels[display]??display}>{labels[display]??'编辑工具'}{binding&&<kbd>{binding}</kbd>}</strong>
    <div ref={available} className="tool-options-available"><div ref={controls} className={`tool-options-controls${overflow?' overflowed':''}`} aria-hidden={overflow}><Controls disabled={disabled} bindings={bindings}/></div>{overflow&&<span className="tool-options-overflow-hint">展开更多选项</span>}</div>
    <button ref={trigger} className="tool-options-more" aria-label="更多工具选项" aria-expanded={expanded} aria-controls={expanded?'expanded-tool-options':undefined} title="展开工具选项与说明" onClick={()=>setExpanded(v=>!v)}>···</button>
  </div>{expanded&&createPortal(<div ref={popover} id="expanded-tool-options" role="dialog" aria-modal="false" aria-label="展开工具选项" className="tool-options-popover" style={position}><div className="tool-options-popover-heading"><strong>{labels[display]??'工具选项'}</strong><button aria-label="关闭工具选项" onClick={()=>close(true)}>×</button></div><div className="tool-options-controls expanded"><Controls disabled={disabled} bindings={bindings} prefix="展开"/></div><p>切换工具不会改变画布位置。区域选择使用完整对象；素材裁剪保留原件。详细取景参数可在素材编辑窗调整。</p></div>,document.body)}</>;
}
