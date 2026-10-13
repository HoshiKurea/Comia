import {fail,ok,problem,type Result} from '../domain/types';
import {COMMAND_BY_ID,type CommandId} from '../commands/catalog';
import {buildShortcutIndex,signature} from '../commands/shortcutBinding';
import type {ShortcutOverrides} from '../commands/types';

const introducedDefaults=['tool-select','tool-geometry','dialogue-connector','dialogue-fused','dialogue-overlap','tool-marquee','tool-lasso','tool-panel-cut','tool-image-crop','tool-image-mask','tool-bubble-brush','tool-flash-bubble','tool-paint-pen','tool-paint-eraser']as const;
export interface DefaultShortcutConflict {commandId:CommandId;occupiedBy:CommandId}
/** Preserve explicit bindings, including [], before enabling missing new defaults. */
export function compatibleShortcutDefaults(value:unknown):Result<{overrides:ShortcutOverrides;conflicts:DefaultShortcutConflict[]}>{
  if(!value||typeof value!=='object'||Array.isArray(value))return fail(problem('preferences/shortcuts','快捷键覆盖格式无效'));
  const original=value as ShortcutOverrides,draft:ShortcutOverrides={...original},conflicts:DefaultShortcutConflict[]=[];
  for(const id of introducedDefaults)if(original[id]===undefined)draft[id]=[];
  let current=buildShortcutIndex(draft);if(!current.ok)return current;
  for(const id of introducedDefaults){
    if(original[id]!==undefined)continue;
    const occupied=COMMAND_BY_ID.get(id)!.defaults.map(c=>current.ok?current.value.get(signature(c)):undefined).find((v):v is CommandId=>v!==undefined);
    if(occupied){conflicts.push({commandId:id,occupiedBy:occupied});continue;}
    delete draft[id];current=buildShortcutIndex(draft);if(!current.ok)return current;
  }
  return ok({overrides:draft,conflicts});
}
