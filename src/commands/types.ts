import type { CommandId } from './catalog';
export interface ShortcutChord { key:string; primary:boolean; alt:boolean; shift:boolean }
export type ShortcutOverrides=Partial<Record<CommandId,ShortcutChord[]>>;
export interface CommandDescriptor { id:CommandId; label:string; category:string; defaults:readonly ShortcutChord[]; repeat:'allow'|'deny'; inputScope:'save'|'none' }
