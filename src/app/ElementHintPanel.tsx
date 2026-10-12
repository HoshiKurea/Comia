import { useEffect, useRef } from 'react';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { getElementHints,type HintTarget } from '../commands/elementHints';
import { documentStore, getProject } from '../state/documentStore';
import { preferencesStore } from '../preferences/store';
import { sessionStore } from '../state/sessionStore';
import { LibraryThumbnail } from '../library/LibraryThumbnail';
import { runtimeStore } from '../state/runtimeStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import './elementHints.css';

interface ActiveHint {target:HintTarget;projectId:string;pageId:string;key:string}
export const hintReferenceStore=createStore<{active:ActiveHint|null}>(()=>({active:null}));
let timer:ReturnType<typeof setTimeout>|null=null,pendingKey:string|null=null;
function cancelPending(){if(timer!==null)clearTimeout(timer);timer=null;pendingKey=null;}
export function leaveElementHint():void{cancelPending();}
export function hideElementHint():void {cancelPending();hintReferenceStore.setState({active:null});}
function validTarget(t:HintTarget){
  const p=getProject(),page=sessionStore.getState().activePageId;
  if(t.kind==='component')return !t.componentKind.startsWith('template:')||!!p.templates[t.componentKind.slice(9)];
  if(t.projectId!==p.id)return false;
  if(t.kind==='asset')return !!p.assets[t.assetId]&&!!p.libraryAssetIds?.includes(t.assetId);
  if(!p.layers[t.layerId]||p.layers[t.layerId].pageId!==page||!effectiveLayerFlags(p,t.layerId).visible)return false;
  if(t.containedImageId){let id=p.layers[t.containedImageId]?.parentId;while(id&&id!==t.layerId)id=p.layers[id]?.parentId;return id===t.layerId;}
  return true;
}
export function resolveHintReference():{target:HintTarget|null;source:'hover'|'selection'|'empty';count:number}{
  const p=getProject(),s=sessionStore.getState(),a=hintReferenceStore.getState().active;
  if(a&&a.projectId===p.id&&a.pageId===s.activePageId&&validTarget(a.target))return{target:a.target,source:'hover',count:s.selection.length};
  const id=s.selection[0];return id&&p.layers[id]?.pageId===s.activePageId?{target:{kind:'canvas',projectId:p.id,layerId:id},source:'selection',count:s.selection.length}:{target:null,source:'empty',count:0};
}
export function requestElementHint(target:HintTarget,_anchor?:{x:number;y:number},delay=180):void {
  if(!validTarget(target)||runtimeStore.getState().gestureActive||document.querySelector('[role=dialog][aria-modal=true]'))return;
  const key=JSON.stringify(target);if(hintReferenceStore.getState().active?.key===key||pendingKey===key)return;
  if(timer!==null)clearTimeout(timer);timer=null;
  const p=getProject(),s=sessionStore.getState(),value={target,key,projectId:p.id,pageId:s.activePageId};
  if(delay===0){pendingKey=null;hintReferenceStore.setState({active:value});return;}
  pendingKey=key;timer=setTimeout(()=>{timer=null;pendingKey=null;if(getProject().id===value.projectId&&sessionStore.getState().activePageId===value.pageId&&validTarget(target)&&!runtimeStore.getState().gestureActive&&!document.querySelector('[role=dialog][aria-modal=true]'))hintReferenceStore.setState({active:value});},delay);
}
sessionStore.subscribe((s,old)=>{if(s.activePageId!==old.activePageId||s.selection!==old.selection)hideElementHint();});
runtimeStore.subscribe((s,old)=>{if(s.gestureActive&&!old.gestureActive)hideElementHint();});
documentStore.subscribe((d,old)=>{const a=hintReferenceStore.getState().active;if(d.epoch!==old.epoch||a&&!validTarget(a.target))hideElementHint();});
function AssetHintImage({assetId}:{assetId:string}){
  const node=useRef<HTMLCanvasElement>(null),images=useStore(runtimeStore,s=>s.images),a=getProject().assets[assetId];
  useEffect(()=>{const c=node.current?.getContext('2d'),image=a?images.get(a.renderHash):null;if(c&&image&&a){c.clearRect(0,0,100,75);const s=Math.min(100/a.width,75/a.height);c.drawImage(image,(100-a.width*s)/2,(75-a.height*s)/2,a.width*s,a.height*s);}},[a,images]);return <canvas ref={node} width={100} height={75} aria-hidden="true"/>;
}
export function ElementHintPanel(){
  const active=useStore(hintReferenceStore,s=>s.active),overrides=useStore(preferencesStore,s=>s.value.shortcuts),selection=useStore(sessionStore,s=>s.selection);
  useStore(sessionStore,s=>s.activePageId);
  useStore(documentStore,s=>s.project.id);
  useStore(documentStore,s=>active?.target.kind==='canvas'?s.project.layers[active.target.layerId]:active?.target.kind==='asset'?s.project.assets[active.target.assetId]:active?.target.kind==='component'&&active.target.componentKind.startsWith('template:')?s.project.templates[active.target.componentKind.slice(9)]:s.project.layers[selection[0]]);
  useStore(documentStore,s=>active?.target.kind==='canvas'&&active.target.containedImageId?s.project.layers[active.target.containedImageId]:null);
  const project=getProject();
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape')hideElementHint();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  const reference=resolveHintReference(),t=reference.target;
  if(!t)return <section className="element-shortcut-reference" aria-label="快捷键参考"><p>悬停组件或素材，或选中画布对象，查看相关快捷键。</p></section>;
  const label=t.kind==='component'?t.label:t.kind==='asset'?project.assets[t.assetId].name:project.layers[t.layerId].name;
  const canvasLayer=t.kind==='canvas'?project.layers[t.layerId]:null;
  const rows=getElementHints(t,overrides),imageId=t.kind==='asset'?t.assetId:canvasLayer?.type==='image'?canvasLayer.assetId:null;
  return <section id="element-shortcut-reference" aria-label="快捷键参考" className="element-shortcut-reference"><div className="element-hint-heading">{t.kind==='component'&&!t.tool?<LibraryThumbnail kind={t.componentKind} enlarged/>:imageId?<AssetHintImage assetId={imageId}/>:null}<div><strong>{label}</strong><small>{reference.source==='hover'?'悬停参考':'当前选区'}{reference.count>1?` · 已选${reference.count}项`:''}</small></div></div>{rows.map((r,i)=><div className="element-hint-row" key={i}><span>{r.label}{r.note&&<small>{r.note}</small>}</span><kbd>{r.binding}</kbd></div>)}{t.kind==='canvas'&&t.containedImageId&&project.layers[t.containedImageId]?.type==='image'&&<><div className="element-hint-section">框内素材：{project.layers[t.containedImageId].name}</div>{getElementHints({kind:'canvas',projectId:t.projectId,layerId:t.containedImageId},overrides).map((r,i)=><div className="element-hint-row" key={`image${i}`}><span>{r.label}{r.note&&<small>{r.note}</small>}</span><kbd>{r.binding}</kbd></div>)}</>}<p>快捷键作用于当前选区；参考不会改变选择。</p></section>;
}
