import { fail, ok, problem, type Id, type Point, type Rect, type Result } from '../domain/types';
import { getDocument } from '../state/documentStore';
import { registerGestureCanceller } from '../interaction/activeGesture';
import { cancelTextEdit, commitTextEdit, currentTextEdit, textEditStore, updateBubbleFrameDraft, type ActiveTextEdit } from './editController';
import { setBubbleTextFrame } from './commands';
import { mainBubbleText } from '../bubbles/ownership';
import { sessionStore } from '../state/sessionStore';

interface FrameDrag { id:Id; index:number; safe:Rect; width:number; height:number; changed:boolean; before:ActiveTextEdit|null; epoch:number; stateId:Id; pageId:Id }
let active:FrameDrag|null=null,unregister:(()=>void)|null=null,off:(()=>void)|null=null;
export function frameSizeAt(safe:Rect,width:number,height:number,index:number,p:Point,ratio:boolean):{width:number;height:number}{
  const cx=safe.x+safe.width/2,cy=safe.y+safe.height/2,horizontal=![1,5].includes(index),vertical=![3,7].includes(index);
  let w=horizontal?Math.max(1,Math.min(16384,2*Math.abs(p.x-cx))):width,h=vertical?Math.max(1,Math.min(16384,2*Math.abs(p.y-cy))):height;
  if(ratio){const scale=horizontal&&!vertical?w/width:vertical&&!horizontal?h/height:Math.max(w/width,h/height),limited=Math.min(scale,16384/width,16384/height);w=Math.max(1,width*limited);h=Math.max(1,height*limited);}
  return{width:w,height:h};
}
function clear(){active=null;unregister?.();unregister=null;off?.();off=null;}
export function beginBubbleFrameDrag(id:Id,index:number,box:Rect,safe:Rect):Result<void>{
  if(active)return fail(problem('text/frame-pointer','已有文字框拖动'));
  if(currentTextEdit()?.composing)return fail(problem('text/composing','请先完成输入法候选'));
  const p=getDocument().project,l=p.layers[id];if(l?.type!=='text'||!l.parentId||mainBubbleText(p,l.parentId)?.id!==id)return fail(problem('text/frame-target','请选择主对白'));
  const before=currentTextEdit()?.layerId===id?currentTextEdit():null,r=setBubbleTextFrame(id,{mode:'manual',manualSize:{width:Math.max(1,Math.min(16384,box.width)),height:Math.max(1,Math.min(16384,box.height))},placement:'center'});if(!r.ok)return r;
  const doc=getDocument();active={id,index,safe,width:Math.max(1,Math.min(16384,box.width)),height:Math.max(1,Math.min(16384,box.height)),before,changed:false,epoch:doc.epoch,stateId:doc.history.stateId,pageId:l.pageId};
  unregister=registerGestureCanceller(cancelBubbleFrameDrag);
  const mode=sessionStore.getState().toolMode;off=sessionStore.subscribe(s=>{if(active&&(s.activePageId!==active.pageId||s.toolMode!==mode||!s.selection.includes(id)))cancelBubbleFrameDrag();});return ok(undefined);
}
export function previewBubbleFrameDrag(p:Point,ratio=false):Result<void>{
  if(!active)return fail(problem('text/frame-inactive','没有活动文字框拖动'));
  const doc=getDocument();if(doc.epoch!==active.epoch||doc.history.stateId!==active.stateId){cancelBubbleFrameDrag();return fail(problem('text/stale','作品已变化，文字框拖动已取消'));}
  if(!Number.isFinite(p.x)||!Number.isFinite(p.y))return fail(problem('text/frame-point','坐标须为有限数字'));
  const size=frameSizeAt(active.safe,active.width,active.height,active.index,p,ratio);const r=updateBubbleFrameDraft({mode:'manual',manualSize:size,placement:'center'});if(r.ok)active.changed=Math.abs(size.width-active.width)>1e-6||Math.abs(size.height-active.height)>1e-6;return r;
}
export function cancelBubbleFrameDrag():void{const old=active;if(!old)return;clear();const doc=getDocument();if(old.before&&doc.epoch===old.epoch&&doc.history.stateId===old.stateId&&sessionStore.getState().activePageId===old.pageId)textEditStore.setState({active:old.before});else cancelTextEdit();}
export function commitBubbleFrameDrag():Result<void>{const old=active;if(!old)return ok(undefined);if(!old.changed){cancelBubbleFrameDrag();return ok(undefined);}clear();return old.before?ok(undefined):commitTextEdit();}
