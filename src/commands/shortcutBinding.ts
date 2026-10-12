import { fail,ok,problem,type Result } from '../domain/types';
import { COMMANDS,COMMAND_BY_ID,isCommandId,type CommandId } from './catalog';
import type { ShortcutChord,ShortcutOverrides } from './types';
export type KeyInput=Pick<KeyboardEvent,'key'|'ctrlKey'|'metaKey'|'shiftKey'|'altKey'|'isComposing'|'keyCode'>;
export const signature=(c:ShortcutChord)=>`${+c.primary}:${+c.alt}:${+c.shift}:${c.key}`;
const allowed=/^(?:[a-z0-9]|F[23489]|Delete|Backspace)$/;
export function chordFromEvent(e:KeyInput):ShortcutChord|null {
 if(e.isComposing||e.keyCode===229)return null;
 const key=e.key.length===1?e.key.toLowerCase():e.key;
 return allowed.test(key)?{key,primary:e.ctrlKey||e.metaKey,alt:e.altKey,shift:e.shiftKey}:null;
}
export function chordReason(value:unknown):string|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return '快捷键格式无效';
 const c=value as ShortcutChord;
 if(typeof c.key!=='string'||!allowed.test(c.key)||[c.primary,c.alt,c.shift].some(v=>typeof v!=='boolean'))return '该按键不可配置；基础交互或系统功能键受保护';
 if(c.primary&&!c.alt&&(['l','t','w','n','r'].includes(c.key)||c.shift&&['t','w','n','r'].includes(c.key)))return '此组合保留给浏览器，请换一个组合';
 if(c.alt&&!c.primary&&c.key==='F4'||c.primary&&c.alt&&c.key==='Delete')return '此组合保留给系统';
 return null;
}
export function effectiveBindings(id:CommandId,overrides:ShortcutOverrides):readonly ShortcutChord[]{return overrides[id]??COMMAND_BY_ID.get(id)!.defaults;}
export function formatChord(c:ShortcutChord,aria=false):string{return [...(c.primary?[aria?'Control':'Ctrl']:[]),...(c.alt?['Alt']:[]),...(c.shift?['Shift']:[]),c.key.length===1?c.key.toUpperCase():c.key].join('+');}
export function bindingLabel(id:CommandId,o:ShortcutOverrides):string{return effectiveBindings(id,o).map(c=>formatChord(c)).join(' / ');}
export function buildShortcutIndex(overrides:ShortcutOverrides):Result<ReadonlyMap<string,CommandId>> {
 const bad=(m:string)=>fail(problem('preferences/shortcuts',m));
 if(!overrides||typeof overrides!=='object'||Array.isArray(overrides))return bad('快捷键覆盖格式无效');
 for(const [id,chords] of Object.entries(overrides))if(!isCommandId(id)||!Array.isArray(chords)||chords.length>2)return bad(`无效命令或超过两个备用组合：${id}`);
 const index=new Map<string,CommandId>();
 for(const command of COMMANDS){const own=new Set<string>();for(const chord of effectiveBindings(command.id,overrides)){
  const reason=chordReason(chord);if(reason)return bad(`${command.label}：${reason}`);
  const key=signature(chord);if(own.has(key))return bad(`${command.label}的组合重复`);own.add(key);
  const occupied=index.get(key);if(occupied)return bad(`${formatChord(chord)} 已由“${COMMAND_BY_ID.get(occupied)!.label}”使用，与“${command.label}”冲突`);
  index.set(key,command.id);
 }}return ok(index);
}
