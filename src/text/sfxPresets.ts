import type { Id, Result, TextEffects } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { beginSfxTextEdit, currentTextEdit, updateTextEffectsDraft, updateTextInput, updateTextStyleDraft } from './editController';
export const BASE_SFX_EFFECTS:TextEffects={outlineColor:'#FFFFFFFF',outlineWidth:3,shearDeg:0,deformation:'none',amount:0,cycles:1,recipe:'layout'};
export const SFX_PRESETS=[
  {id:'impact',name:'重击',sample:'砰！',effects:{...BASE_SFX_EFFECTS,deformation:'impact',amount:.35,shearDeg:-12}},
  {id:'crack',name:'裂响',sample:'バキ',effects:{...BASE_SFX_EFFECTS,deformation:'impact',amount:-.25,shearDeg:12,outlineWidth:2}},
  {id:'silence',name:'静默',sample:'しーん',effects:{...BASE_SFX_EFFECTS,deformation:'wave',amount:.08,outlineWidth:0}},
  {id:'shout',name:'弧形呼喊',sample:'啊——！',effects:{...BASE_SFX_EFFECTS,deformation:'arc',amount:.35}},
] as const;
export function setTextEffects(id:Id,patch:Partial<TextEffects>):Result<void>{const begun=beginSfxTextEdit(id);return begun.ok?updateTextEffectsDraft({...patch,recipe:'layout'}):begun;}
export function applySfxPreset(id:Id,presetId:string,replaceContent=false):Result<void>{
  const preset=SFX_PRESETS.find(p=>p.id===presetId);if(!preset)return fail(problem('sfx/preset','声效模板不存在'));
  const began=beginSfxTextEdit(id);if(!began.ok)return began;const edit=currentTextEdit()!;
  const effect=updateTextEffectsDraft(preset.effects);if(!effect.ok)return effect;const style=updateTextStyleDraft({font:{color:'#000000FF'}});if(!style.ok)return style;
  if(replaceContent&&!edit.composing)updateTextInput(preset.sample,preset.sample.length,preset.sample.length);return ok(undefined);
}
