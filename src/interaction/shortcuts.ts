import {buildShortcutIndex} from '../commands/shortcutBinding';
import {resolveCommandShortcut} from '../commands/shortcutRouter';
import type {CommandId} from '../commands/catalog';
export interface ShortcutContext { textEditing: boolean; inputFocused: boolean; modalOpen: boolean; gestureActive: boolean; composing?: boolean; cancelableToolEdit?: boolean }
export type ShortcutAction = 'bindImages' | 'unbindImages' | 'undo' | 'redo' | 'delete' | 'copy' | 'paste' | 'duplicate' | 'group' | 'ungroup' | 'save' | 'saveAs' | 'cancel' | 'commitText' | 'pan' | 'left' | 'right' | 'up' | 'down';
export function resolveFixedShortcut(event:Pick<KeyboardEvent,'key'|'ctrlKey'|'metaKey'|'shiftKey'|'altKey'|'isComposing'|'keyCode'>,context:ShortcutContext):ShortcutAction|null {
 if(event.isComposing||event.keyCode===229||context.composing||context.modalOpen)return null;
 const key=event.key.toLowerCase(),command=event.ctrlKey||event.metaKey;
 if(key==='escape'&&!context.inputFocused)return 'cancel';
 if(command&&!event.altKey&&key==='enter'&&context.textEditing)return 'commitText';
 if(context.inputFocused||context.gestureActive||command||event.altKey)return null;
 if(key===' ')return 'pan';
 return ({arrowleft:'left',arrowright:'right',arrowup:'up',arrowdown:'down'} as const)[key as 'arrowleft']??null;
}
const legacy:Partial<Record<CommandId,ShortcutAction>>={'bind-images':'bindImages','unbind-images':'unbindImages','save-as':'saveAs',undo:'undo',redo:'redo',save:'save',delete:'delete',copy:'copy',paste:'paste',duplicate:'duplicate',group:'group',ungroup:'ungroup'};
const defaults=buildShortcutIndex({});
/** Compatibility API uses the same catalog, never a second hard-coded binding map. */
export function resolveShortcut(event:Pick<KeyboardEvent,'key'|'ctrlKey'|'metaKey'|'shiftKey'|'altKey'|'isComposing'|'keyCode'>,context:ShortcutContext):ShortcutAction|null {
 const fixed=resolveFixedShortcut(event,context);if(fixed)return fixed;
 if(!defaults.ok)return null;const id=resolveCommandShortcut(event,context,defaults.value);return id?legacy[id]??null:null;
}
