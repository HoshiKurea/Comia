import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { createPortal } from 'react-dom';
import { useEffect } from 'react';
import type { Id, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { getDocument } from '../state/documentStore';
import { sessionStore,pushNotice,getViewport } from '../state/sessionStore';
import { runtimeStore } from '../state/runtimeStore';
import { drawPage } from '../render/drawScene';
import { cancelActiveGesture } from '../interaction/activeGesture';
import { setPaint } from './commands';
const picker=createStore<{active:{ids:Id[];field:'fill'|'borderColor';epoch:number;state:string;pageId:Id}|null}>(()=>({active:null}));
export function beginEyedropper(ids:Id[],field:'fill'|'borderColor'){cancelActiveGesture();const d=getDocument();picker.setState({active:{ids:[...ids],field,epoch:d.epoch,state:d.history.stateId,pageId:sessionStore.getState().activePageId}});}
export function samplePageColor(x:number,y:number):Result<string>{const d=getDocument(),pid=sessionStore.getState().activePageId,p=d.project.pages[pid];if(!p||x<0||y<0||x>=p.width||y>=p.height)return fail(problem('picker/outside','请点击页面内的颜色'));const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d')!;try{ctx.translate(-Math.floor(x),-Math.floor(y));drawPage(ctx,d.project,pid,runtimeStore.getState().images);const a=ctx.getImageData(0,0,1,1).data;return ok('#'+Array.from(a).map(n=>n.toString(16).padStart(2,'0')).join('').toUpperCase());}catch(e){return fail(problem('picker/render',(e as Error).message));}finally{c.width=c.height=0;}}
export function Eyedropper(){const active=useStore(picker,s=>s.active);useEffect(()=>{if(!active)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();picker.setState({active:null});}},blur=()=>picker.setState({active:null});window.addEventListener('keydown',key,true);window.addEventListener('blur',blur);return()=>{window.removeEventListener('keydown',key,true);window.removeEventListener('blur',blur);};},[active]);if(!active)return null;
  return createPortal(<div className="appearance-eyedropper" aria-label="取样画布颜色" onPointerDown={e=>{e.preventDefault();e.stopPropagation();const d=getDocument(),s=sessionStore.getState();if(d.epoch!==active.epoch||d.history.stateId!==active.state||s.activePageId!==active.pageId||s.selection.join('|')!==active.ids.join('|')){picker.setState({active:null});return;}const rect=document.querySelector('.canvas-viewport')?.getBoundingClientRect(),vp=getViewport(active.pageId);if(!rect||!vp)return;const r=samplePageColor((e.clientX-rect.left-vp.pan.x)/vp.zoom,(e.clientY-rect.top-vp.pan.y)/vp.zoom);if(!r.ok){pushNotice('error',r.problems[0].message);return;}picker.setState({active:null});const applied=setPaint(active.ids,{[active.field]:r.value});if(!applied.ok)pushNotice('error',applied.problems[0].message);}}><span>点击页面取色 · Esc取消</span></div>,document.body);
}
