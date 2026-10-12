import { pushNotice } from '../state/sessionStore';
import { createDefaultPreferences,validatePreferences } from './model';
import type { AppPreferences } from './types';
import { COMMAND_BY_ID } from '../commands/catalog';
import { compatibleShortcutDefaults } from './defaultShortcutCompatibility';
export const PREFERENCES_KEY='comia.preferences.v1';
const warnedDefaultConflicts=new Set<string>();
export function readStoredPreferences():AppPreferences|null {const raw=localStorage.getItem(PREFERENCES_KEY);if(raw===null)return null;if(raw.length>65536)throw Error('首选项过大');const value=JSON.parse(raw) as AppPreferences;
 const compatible=compatibleShortcutDefaults(value?.shortcuts);if(!compatible.ok)throw Error(compatible.problems[0].message);value.shortcuts=compatible.value.overrides;
 const r=validatePreferences(value);if(!r.ok)throw Error(r.problems[0].message);for(const conflict of compatible.value.conflicts){const key=JSON.stringify([value.generation,conflict.commandId,conflict.occupiedBy]);if(warnedDefaultConflicts.has(key))continue;warnedDefaultConflicts.add(key);if(warnedDefaultConflicts.size>128)warnedDefaultConflicts.delete(warnedDefaultConflicts.values().next().value!);queueMicrotask(()=>pushNotice('info',`${COMMAND_BY_ID.get(conflict.commandId)!.label}默认键位与已有“${COMMAND_BY_ID.get(conflict.occupiedBy)!.label}”设置冲突，已保留原设置；请在首选项设置快捷键`));}return r.value;}
export function loadPreferences():AppPreferences {
 const defaults=createDefaultPreferences();try{const raw=localStorage.getItem(PREFERENCES_KEY);if(raw!==null)return readStoredPreferences()!;
  const theme=localStorage.getItem('comia.theme.v1');if(theme==='system'||theme==='light'||theme==='dark')defaults.theme=theme;
  const snap=localStorage.getItem('comia.snap16.v1');if(snap==='true'||snap==='false')defaults.snap16=snap==='true';
 }catch{queueMicrotask(()=>pushNotice('info','首选项不可用或损坏，已使用默认设置'));}return defaults;
}
export function persistPreferences(value:AppPreferences):boolean {try{localStorage.setItem(PREFERENCES_KEY,JSON.stringify(value));return true;}catch{pushNotice('info','首选项已在本次会话应用；本机存储不可用，刷新后无法记忆');return false;}}
