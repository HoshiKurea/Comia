import { pushNotice } from '../state/sessionStore';
import { createDefaultPanelLayout, validatePanelLayout, migratePanelLayout } from './layoutModel';
import type { PanelLayout } from './types';
export const PANEL_LAYOUT_KEY='comia.panel-layout.v2';
let warned=false;
function warn(message:string){if(!warned){warned=true;queueMicrotask(()=>pushNotice('info',message));}}
export function loadPanelLayout():PanelLayout {
  try {const text=localStorage.getItem(PANEL_LAYOUT_KEY);if(text===null){const legacy=localStorage.getItem('comia.panel-layout.v1');if(!legacy)return createDefaultPanelLayout();if(legacy.length>65536)throw Error('size');const migrated=migratePanelLayout(JSON.parse(legacy));if(!migrated.ok)throw Error('invalid');savePanelLayout(migrated.value);return migrated.value;}if(text.length>65536)throw Error('size');const r=validatePanelLayout(JSON.parse(text));if(!r.ok)throw Error('invalid');return r.value;}
  catch{warn('面板设置不可用或损坏，已恢复默认工作区');return createDefaultPanelLayout();}
}
export function savePanelLayout(layout:PanelLayout):boolean {
  try{localStorage.setItem(PANEL_LAYOUT_KEY,JSON.stringify(layout));return true;}catch{warn('面板布局已应用；本机设置存储不可用，刷新后需重新排列');return false;}
}
