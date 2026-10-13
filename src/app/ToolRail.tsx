import {ToolIcon} from './ToolIcon';
import './toolRail.css';
import type {ToolMode} from '../interaction/types';
import type {CommandId} from '../commands/catalog';

export function ToolRail({selected,binding,disabled,onSelect,mode,areaBindings,extraBindings,onAreaTool}:{selected:boolean;binding:string;disabled:boolean;onSelect:()=>void;mode:ToolMode;areaBindings:Record<'tool-marquee'|'tool-lasso',string>;extraBindings:Record<'tool-panel-cut'|'tool-image-crop'|'tool-image-mask'|'tool-bubble-brush'|'tool-flash-bubble'|'tool-paint-pen'|'tool-paint-eraser',string>;onAreaTool:(id:CommandId)=>void}){
  return <div role="toolbar" aria-label="绘图工具" aria-orientation="vertical" className="tool-rail">
    <button type="button" aria-label="自由绘画窗口" disabled={disabled} title="自由绘画窗口 · 创作可重画的手绘素材" onClick={()=>onAreaTool('drawing-window')}><ToolIcon kind="drawing-window"/></button>
    <button type="button" aria-label="选择" aria-pressed={selected} disabled={disabled} title={`移动/点选工具 · ${binding||'未设置快捷键'} · Shift单击多选 · Alt+Shift单击素材多选`} onClick={onSelect}><ToolIcon kind="select"/></button>
    <button type="button" aria-label="矩形框选" aria-pressed={mode==='marquee'} disabled={disabled} title={`矩形框选 · ${areaBindings['tool-marquee']||'未设置快捷键'} · 拖出选区选择完整对象`} onClick={()=>onAreaTool('tool-marquee')}><ToolIcon kind="marquee"/></button>
    <button type="button" aria-label="自由套索" aria-pressed={mode==='lasso'} disabled={disabled} title={`自由套索 · ${areaBindings['tool-lasso']||'未设置快捷键'} · 圈出选区选择完整对象`} onClick={()=>onAreaTool('tool-lasso')}><ToolIcon kind="lasso"/></button>
    <button type="button" aria-label="分镜切割" aria-pressed={mode==='panel-cut'} disabled={disabled} title={`分镜切割 · ${extraBindings['tool-panel-cut']||'未设置快捷键'} · 拖线穿过分镜`} onClick={()=>onAreaTool('tool-panel-cut')}><ToolIcon kind="panel-cut"/></button>
    <button type="button" aria-label="素材裁剪" aria-pressed={mode==='image-crop'} disabled={disabled} title={`素材裁剪 · ${extraBindings['tool-image-crop']||'未设置快捷键'} · 点击素材裁剪选择范围`} onClick={()=>onAreaTool('tool-image-crop')}><ToolIcon kind="image-crop"/></button>
    <button type="button" aria-label="素材遮罩" aria-pressed={mode==='image-mask'} disabled={disabled} title={`素材遮罩 · ${extraBindings['tool-image-mask']||'未设置快捷键'} · 保留素材选择范围`} onClick={()=>onAreaTool('tool-image-mask')}><ToolIcon kind="image-mask"/></button>
    {(['flash-bubble','paint-pen','paint-eraser'] as const).map((kind,i)=><button key={kind} type="button" aria-label={['效果线气泡','绘画画笔','绘画橡皮擦'][i]} aria-pressed={mode===kind} disabled={disabled} title={`${['效果线气泡','绘画画笔 · 先选择绘画图层','绘画橡皮擦'][i]} · ${extraBindings[('tool-'+kind) as keyof typeof extraBindings]||'未设置快捷键'}`} onClick={()=>onAreaTool(('tool-'+kind) as CommandId)}><ToolIcon kind={kind}/></button>)}
    <button type="button" aria-label="手绘气泡" aria-pressed={mode==='bubble-brush'} disabled={disabled} title={`手绘气泡 · ${extraBindings['tool-bubble-brush']||'未设置快捷键'} · 画轮廓，松手自动补口`} onClick={()=>onAreaTool('tool-bubble-brush')}><ToolIcon kind="bubble-brush"/></button>
  </div>;
}
