import {activateBubbleBrush,bubbleBrushStore,currentBubbleBrush,setBubbleBrushOptions} from '../bubbles/brushController';
import {DEFAULT_BUBBLE_BRUSH} from '../bubbles/brushOptions';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { FocusDialog } from '../app/FocusDialog';
import { describePresetCapture, renameUserTemplate, saveComponentRecipe } from './templates';
import { getDocument } from '../state/documentStore';
import { sessionStore, pushNotice } from '../state/sessionStore';
import { speedBrushStore, setSpeedBrushOptions, activateSpeedBrush } from './speedBrushController';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { cancelActiveGesture } from '../interaction/activeGesture';
import { currentDrawing } from '../panels/drawingController';
import { currentMangaEdit } from '../bubbles/mangaEditController';
import { currentCropEdit } from '../images/cropController';
import { currentMaskEdit } from '../images/maskController';
import { currentBreakoutEdit } from '../images/breakoutController';
import { currentSpeedStroke } from './speedBrushController';
import type { ComponentPreset, Id, Result, ScenePresetRecipe } from '../domain/types';
import { sceneProject } from './presetModel';
import { awaitFonts } from '../text/fonts';
import { drawPage } from '../render/drawScene';
import './presets.css';

interface PresetDialogState { projectId:Id;epoch:number;stateId:Id;name:string;mode:'scene'|'speed-brush'|'bubble-brush';scene:ScenePresetRecipe|null;excludedImages:number;brush:ComponentPreset['recipe']|null;replaceId?:Id;renameId?:Id }
const dialogStore=createStore<{active:PresetDialogState|null}>(()=>({active:null}));
export function openPresetDialog(options:{brush?:boolean;bubbleBrush?:boolean;replaceId?:Id;renameId?:Id}={}):Result<void>{
  if(currentBubbleBrush()||currentDrawing()||currentMangaEdit()||currentCropEdit()||currentMaskEdit()||currentBreakoutEdit()||currentSpeedStroke())return{ok:false,problems:[{code:'preset/editing',message:'请先完成或取消当前编辑，再保存预设'}]};
  const done=finishActiveTextEdit();if(!done.ok)return done;cancelActiveGesture();const doc=getDocument(),s=sessionStore.getState(),t=options.replaceId||options.renameId?doc.project.templates[(options.replaceId||options.renameId)!]:null;
  const capture=describePresetCapture(doc.project,s.selection),selected=doc.project.layers[s.selection[0]],brushOptions=selected?.type==='decoration'&&selected.spec.kind==='speed-brush'?{...selected.spec.options,color:selected.spec.color}:options.brush?speedBrushStore.getState().options:null;
  if(!options.renameId&&!options.brush&&!options.bubbleBrush&&!capture.ok)return capture;
  const bubbleOptions=options.bubbleBrush?bubbleBrushStore.getState().options:selected?.type==='bubble'?{...DEFAULT_BUBBLE_BRUSH,...selected.style,handDrawn:selected.handDrawn?{...selected.handDrawn,wobble:selected.edgeStyle?.wobble??selected.handDrawn.wobble}:null}:null;
  dialogStore.setState({active:{projectId:doc.project.id,epoch:doc.epoch,stateId:doc.history.stateId,name:t?.name??'自定义组件',mode:options.bubbleBrush?'bubble-brush':options.brush?'speed-brush':'scene',scene:capture.ok?capture.value.recipe:null,excludedImages:capture.ok?capture.value.excludedImages:0,brush:bubbleOptions?{kind:'bubble-brush',options:structuredClone(bubbleOptions)}:brushOptions?{kind:'speed-brush',options:{...brushOptions}}:null,replaceId:options.replaceId,renameId:options.renameId}});
  return {ok:true,value:undefined};
}
export function activateBrushPreset(id:Id):Result<void>{
  const t=getDocument().project.templates[id];if(t&&'recipe'in t&&t.recipe.kind==='bubble-brush'){const r=activateBubbleBrush();return r.ok?setBubbleBrushOptions(t.recipe.options):r;}if(!t||!('recipe'in t)||t.recipe.kind!=='speed-brush')return{ok:false,problems:[{code:'preset/brush',message:'笔刷预设已不存在'}]};
  const activated=activateSpeedBrush();return activated.ok?setSpeedBrushOptions(t.recipe.options):activated;
}
export function PresetPreview({recipe}:{recipe:ScenePresetRecipe}){
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{let cancelled=false;const p=sceneProject(recipe),pageId=p.pageOrder[0],b=recipe.bounds;const paint=()=>{if(cancelled)return;const c=canvas.current?.getContext('2d');if(!c)return;const margin=260;p.pages[pageId].width=Math.min(16384,Math.ceil(b.width+margin*2));p.pages[pageId].height=Math.min(16384,Math.ceil(b.height+margin*2));for(const id of recipe.roots){const l=p.layers[id];l.matrix=[l.matrix[0],l.matrix[1],l.matrix[2],l.matrix[3],l.matrix[4]+margin-b.x,l.matrix[5]+margin-b.y];}const scale=Math.min(260/b.width,170/b.height);c.clearRect(0,0,280,190);c.save();c.translate((280-b.width*scale)/2-margin*scale,(190-b.height*scale)/2-margin*scale);c.scale(scale,scale);drawPage(c,p,pageId,new Map(),recipe.roots,false);c.restore();};void awaitFonts(p).then(r=>{if(r.ok)paint();});return()=>{cancelled=true;};},[recipe]);
  return <canvas ref={canvas} width={280} height={190} className="preset-preview" aria-label="保存结果预览"/>;
}
export function PresetDialog(){
  const active=useStore(dialogStore,s=>s.active),[name,setName]=useState(''),[mode,setMode]=useState<'scene'|'speed-brush'|'bubble-brush'>('scene'),[error,setError]=useState('');
  const close=()=>dialogStore.setState({active:null});
  // Initialize before browser input can select/replace the controlled field.
  useLayoutEffect(()=>{if(active){setName(active.name);setMode(active.mode);setError('');}},[active]);
  if(!active)return null;
  const save=()=>{const d=getDocument();if(d.project.id!==active.projectId||d.epoch!==active.epoch||d.history.stateId!==active.stateId){setError('作品已变化，请重新打开保存窗口');return;}let r:Result<unknown>;if(active.renameId)r=renameUserTemplate(active.renameId,name);else{const recipe=mode==='scene'?active.scene:active.brush;if(!recipe){setError('没有可保存的组件或笔刷参数');return;}r=saveComponentRecipe(name,recipe,active.replaceId);}if(!r.ok){setError(r.problems[0].message);return;}close();pushNotice('info',active.renameId?'预设已重命名':'预设已保存；画布副本保持独立');};
  return <FocusDialog title={active.renameId?'重命名组件预设':'保存组件预设'} onCancel={close} className="preset-dialog"><div className="dialog-heading"><strong>{active.renameId?'重命名组件预设':active.replaceId?'用选区更新预设':'保存组件预设'}</strong></div><label className="field"><span>预设名称</span><input aria-label="预设名称" value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.nativeEvent.isComposing||e.nativeEvent.keyCode===229)return;if(e.key==='Enter'){e.preventDefault();save();}}}/></label>
    {!active.renameId&&<>{active.brush&&active.scene&&<label className="field"><span>保存类型</span><select aria-label="预设保存类型" value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="scene">固定组件图案</option><option value={active.brush.kind}>{active.brush.kind==='bubble-brush'?'气泡笔刷参数':'速度线笔刷参数'}</option></select></label>}{mode==='scene'&&active.scene?<PresetPreview recipe={active.scene}/>:<p className="hint">笔刷参数用于之后绘制的新笔画，不保存当前轨迹。</p>}<p className="hint">预设保存在当前漫画；放置后是独立可编辑副本。</p>{active.excludedImages>0&&mode==='scene'&&<p role="status" className="preset-resource-note">本预设不包含 {active.excludedImages} 张图片。图片由素材库管理；上方为实际保存结果。</p>}</>}
    {error&&<p role="alert">{error}</p>}<div className="dialog-actions"><button onClick={close}>取消</button><button className="primary" onClick={save}>{active.renameId?'确定':'保存预设'}</button></div></FocusDialog>;
}
