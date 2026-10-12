import { createStore } from 'zustand/vanilla';
import { firstMessage, type Result } from '../domain/types';
import { pushNotice } from '../state/sessionStore';
import { loadPanelLayout,savePanelLayout } from './layoutPersistence';
import type { PanelLayout } from './types';
export const panelLayoutStore=createStore<{layout:PanelLayout}>(()=>({layout:loadPanelLayout()}));
export function publishLayout(result:Result<PanelLayout>):boolean {
  if(!result.ok){pushNotice('error',firstMessage(result));return false;}
  if(result.value!==panelLayoutStore.getState().layout)panelLayoutStore.setState({layout:result.value});return true;
}
export function installPanelPersistence():()=>void {
  let pending=false,timer:ReturnType<typeof setTimeout>|null=null;
  const flush=()=>{if(timer)clearTimeout(timer);timer=null;if(pending){pending=false;savePanelLayout(panelLayoutStore.getState().layout);}};
  const off=panelLayoutStore.subscribe((s,old)=>{if(s.layout===old.layout)return;pending=true;if(timer)clearTimeout(timer);timer=setTimeout(flush,300);});
  window.addEventListener('pagehide',flush);return()=>{off();window.removeEventListener('pagehide',flush);flush();};
}
