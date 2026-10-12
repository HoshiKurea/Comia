import { currentTextEdit } from '../text/editController';
import { runtimeStore } from '../state/runtimeStore';
import { currentCreation } from '../library/creationController';
import { currentSpeedStroke } from '../library/speedBrushController';
import { pushNotice } from '../state/sessionStore';
let composing=false,relocating=false,releaseFrame=0;
export function isInputComposing(){return composing||Boolean(currentTextEdit()?.composing);}
export function installPanelInputProtection(){
  const start=()=>{composing=true;},end=()=>{composing=false;};
  document.addEventListener('compositionstart',start,true);document.addEventListener('compositionend',end,true);
  return()=>{document.removeEventListener('compositionstart',start,true);document.removeEventListener('compositionend',end,true);composing=false;if(releaseFrame)cancelAnimationFrame(releaseFrame);relocating=false;};
}
export function panelChangeAllowed(notify=true):boolean {
  const reason=composing || currentTextEdit()?.composing?'请先完成输入法候选，再调整面板':runtimeStore.getState().gestureActive || currentCreation() || currentSpeedStroke()?'请先结束当前画布拖动，再调整面板':null;
  if(reason && notify)pushNotice('info',reason);return !reason;
}
export function protectPanelDraft(run:()=>void){
  relocating=true;if(releaseFrame)cancelAnimationFrame(releaseFrame);
  const focus=document.activeElement instanceof HTMLElement?document.activeElement:null,input=focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement?focus:null;
  const start=input?.selectionStart,end=input?.selectionEnd,direction=input?.selectionDirection,scroll=input?.scrollTop;
  run();releaseFrame=requestAnimationFrame(()=>{if(focus?.isConnected&&focus.getClientRects().length){focus.focus({preventScroll:true});if(input&&start!==null&&start!==undefined&&end!==null&&end!==undefined){try{input.setSelectionRange(start,end,direction??undefined);}catch{/* Numeric fields have no text selection. */}input.scrollTop=scroll??0;}}relocating=false;releaseFrame=0;});
}
export function isPanelRelocating(){return relocating;}
