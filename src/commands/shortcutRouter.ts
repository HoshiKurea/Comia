import type { ShortcutContext } from '../interaction/shortcuts';
import { COMMAND_BY_ID,type CommandId } from './catalog';
import { chordFromEvent,signature,type KeyInput } from './shortcutBinding';
export function resolveCommandShortcut(event:KeyInput&{repeat?:boolean},context:ShortcutContext,index:ReadonlyMap<string,CommandId>,includeDeniedRepeat=false):CommandId|null {
 if(event.isComposing||event.keyCode===229||context.composing||context.modalOpen)return null;
 const chord=chordFromEvent(event);if(!chord)return null;
 const id=index.get(signature(chord));if(!id)return null;const command=COMMAND_BY_ID.get(id)!;
 if(context.inputFocused&&command.inputScope!=='save')return null;
 if(context.textEditing&&['bind-images','unbind-images'].includes(id))return null;
 // Tool edits are drafts: switching tools cancels them through the gesture registry.
 // Ordinary move/resize gestures retain the existing shortcut guard.
 if(context.gestureActive&&!['save','save-as','undo','redo'].includes(id)&&!(context.cancelableToolEdit&&id.startsWith('tool-')))return null;
 return event.repeat&&command.repeat==='deny'&&!includeDeniedRepeat?null:id;
}
