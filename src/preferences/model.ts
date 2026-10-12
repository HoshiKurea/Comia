import { fail,ok,problem,type Result } from '../domain/types';
import { buildShortcutIndex } from '../commands/shortcutBinding';
import type { AppPreferences,PreferencesDraft } from './types';
export function createDefaultPreferences():AppPreferences{return{version:1,generation:crypto.randomUUID(),theme:'system',snap16:false,showPanelNumbers:true,exportScale:1,shortcuts:{}};}
export function createPreferencesDraft(value:AppPreferences):PreferencesDraft{return{baseGeneration:value.generation,value:structuredClone(value)};}
export function validatePreferences(value:unknown):Result<AppPreferences>{
 const bad=(m:string)=>fail(problem('preferences/invalid',m));
 if(!value||typeof value!=='object'||Array.isArray(value))return bad('首选项格式无效');
 const p=value as AppPreferences;
 if(p.version!==1||typeof p.generation!=='string'||!p.generation.length||p.generation.length>128)return bad('首选项版本无效');
 if(!['system','light','dark'].includes(p.theme)||typeof p.snap16!=='boolean'||typeof p.showPanelNumbers!=='boolean'||![.25,.5,1,2,4].includes(p.exportScale))return bad('主题、编辑辅助或导出倍率无效');
 const shortcuts=buildShortcutIndex(p.shortcuts);if(!shortcuts.ok)return shortcuts;
 return ok(structuredClone({version:1,generation:p.generation,theme:p.theme,snap16:p.snap16,showPanelNumbers:p.showPanelNumbers,exportScale:p.exportScale,shortcuts:p.shortcuts}));
}
