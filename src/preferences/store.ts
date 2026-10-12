import { createStore } from 'zustand/vanilla';
import { fail,ok,problem,type Result } from '../domain/types';
import { sessionStore,pushNotice } from '../state/sessionStore';
import { buildShortcutIndex } from '../commands/shortcutBinding';
import { createDefaultPreferences,createPreferencesDraft,validatePreferences } from './model';
import { loadPreferences,persistPreferences,PREFERENCES_KEY,readStoredPreferences } from './persistence';
import type { AppPreferences,EditablePreferenceKey,PreferencesDraft } from './types';
import type { CommandId } from '../commands/catalog';
const initial=createDefaultPreferences();
export const preferencesStore=createStore<{value:AppPreferences;shortcutIndex:ReadonlyMap<string,CommandId>}>(()=>({value:initial,shortcutIndex:new Map()}));
let installed=false,knownStorageGeneration:string|null=null;
function publish(value:AppPreferences){const index=buildShortcutIndex(value.shortcuts);if(!index.ok)return;
 preferencesStore.setState({value,shortcutIndex:index.value});sessionStore.setState({theme:value.theme,snap16:value.snap16,showPanelNumbers:value.showPanelNumbers});
 if(typeof document!=='undefined')document.documentElement.dataset.theme=value.theme==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):value.theme;
}
export function installPreferences():void {if(installed)return;installed=true;const value=loadPreferences();try{knownStorageGeneration=readStoredPreferences()?.generation??null;}catch{knownStorageGeneration=null;}publish(value);
 window.addEventListener('storage',e=>{if(e.key!==PREFERENCES_KEY)return;try{const p=readStoredPreferences();if(!p){knownStorageGeneration=null;publish(createDefaultPreferences());}else{knownStorageGeneration=p.generation;publish(p);}}catch{pushNotice('info','另一窗口的首选项无效，当前设置保持');}});
}
export function applyPreferences(draft:PreferencesDraft):Result<void>{
 const validated=validatePreferences(draft.value);if(!validated.ok)return validated;
 const conflict=()=>fail(problem('preferences/conflict','设置已在另一窗口更新，请重新载入'));
 if(draft.baseGeneration!==preferencesStore.getState().value.generation)return conflict();
 try{const external=readStoredPreferences();if((external?.generation??null)!==knownStorageGeneration){knownStorageGeneration=external?.generation??null;publish(external??createDefaultPreferences());return conflict();}}catch{/* Unavailable storage must not disable session preferences. */}
 const value={...validated.value,generation:crypto.randomUUID()};if(persistPreferences(value))knownStorageGeneration=value.generation;publish(value);return ok(undefined);
}
export function updatePreference<K extends EditablePreferenceKey>(key:K,value:AppPreferences[K]):Result<void>{const draft=createPreferencesDraft(preferencesStore.getState().value);draft.value[key]=value;return applyPreferences(draft);}
