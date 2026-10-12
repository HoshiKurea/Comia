import type {EditorMenu,MenuEntry} from '../app/menuTypes';
import {isCommandId,type CommandId} from './catalog';
import {bindingLabel,effectiveBindings,formatChord} from './shortcutBinding';
import type {ShortcutOverrides} from './types';
export type CommandLeaf=Exclude<MenuEntry,{kind:'separator'}|{kind:'submenu'}>;
export function collectMenuCommands(menus:EditorMenu[]):Map<CommandId,CommandLeaf>{
 const result=new Map<CommandId,CommandLeaf>();const visit=(entries:MenuEntry[])=>{for(const entry of entries){if(entry.kind==='submenu')visit(entry.entries);else if(entry.kind!=='separator'){if(!isCommandId(entry.id))throw Error(`菜单命令未注册：${entry.id}`);if(result.has(entry.id))throw Error(`菜单命令重复：${entry.id}`);result.set(entry.id,entry);}}};for(const m of menus)visit(m.entries);return result;
}
export function bindMenuCommands(menus:EditorMenu[],overrides:ShortcutOverrides,dispatch:(id:CommandId)=>void):EditorMenu[]{
 const visit=(entries:MenuEntry[]):MenuEntry[]=>entries.map(e=>{if(e.kind==='separator')return e;if(e.kind==='submenu')return{...e,entries:visit(e.entries)};if(!isCommandId(e.id))throw Error(`菜单命令未注册：${e.id}`);const id=e.id;return{...e,shortcut:bindingLabel(id,overrides),ariaShortcut:effectiveBindings(id,overrides).map(c=>formatChord(c,true)).join(' '),run:()=>dispatch(id)};});return menus.map(m=>({...m,entries:visit(m.entries)}));
}
