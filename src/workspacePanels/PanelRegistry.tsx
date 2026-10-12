import { createPortal } from 'react-dom';
import { useLayoutEffect,useState,type ReactNode } from 'react';
import { PANEL_IDS,type PanelId } from './types';
import { isPanelRelocating } from './panelInteraction';
export type PanelHosts=Record<PanelId,HTMLDivElement>;
export function createPanelHosts():PanelHosts {
  return Object.fromEntries(PANEL_IDS.map(id=>{const node=document.createElement('div');node.className='panel-content-host';node.dataset.panelContent=id;return[id,node];})) as PanelHosts;
}
export function PanelRegistry({hosts,contents}:{hosts:PanelHosts;contents:Record<PanelId,ReactNode>}){
  return <>{PANEL_IDS.map(id=>createPortal(<div className="panel-business-content" onBlurCapture={e=>{if(isPanelRelocating() || (e.relatedTarget instanceof Element && e.relatedTarget.closest('[data-panel-chrome]')))e.stopPropagation();}}>{contents[id]}</div>,hosts[id],id))}</>;
}
export function PanelHostSlot({host,active,id}:{host:HTMLDivElement;active:boolean;id:PanelId}){
  const [slot,setSlot]=useState<HTMLDivElement|null>(null);
  useLayoutEffect(()=>{
    if(!slot)return;const focused=document.activeElement instanceof HTMLElement && host.contains(document.activeElement)?document.activeElement:null;
    const input=focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement?focused:null;
    const start=input?.selectionStart,end=input?.selectionEnd,direction=input?.selectionDirection,scroll=input?.scrollTop;
    if(host.parentElement!==slot)slot.appendChild(host);
    if(active && focused){focused.focus({preventScroll:true});if(input && start!==null && start!==undefined && end!==null && end!==undefined){try{input.setSelectionRange(start,end,direction??undefined);}catch{/* Number fields have no text selection. */}input.scrollTop=scroll??0;}}
    return()=>{if(host.parentElement===slot)host.remove();};
  },[host,slot]);
  return <div ref={setSlot} className="panel-host-slot" id={`panel-content-${id}`} role="tabpanel" aria-labelledby={`panel-tab-${id}`} hidden={!active} />;
}
