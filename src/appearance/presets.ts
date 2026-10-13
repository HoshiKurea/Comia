import type { AppearancePreset, Id, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { newId } from '../domain/id';
import { getProject } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { execute } from '../history/commandBus';
import { migrateProject } from '../storage/migrateProject';
import { layerPaint, parseAppearancePreset, presentation } from './model';
import { beginAppearanceEdit, cancelAppearanceEdit, commitAppearanceEdit, patchPaint, previewAppearance } from './commands';
const key=(name:string)=>name.trim().normalize('NFKC').toLocaleLowerCase();
export function saveAppearancePreset(id:Id,name:string,colorOnly=false):Result<Id>{
  const p=getProject(),l=p.layers[id];if(!l)return fail(problem('preset/target','图层已不存在'));const paint=layerPaint(l);if(colorOnly&&!paint)return fail(problem('preset/color','此图层没有填充色'));const preset:AppearancePreset={id:newId(),name:name.trim(),presentation:structuredClone(presentation(l)),...(paint?{paint:{...paint}}:{})};delete preset.presentation.transformHint;
  if(colorOnly){preset.presentation=presentation({...l,presentation:undefined});preset.paint={fill:paint!.fill,borderColor:paint!.borderColor,borderWidth:paint!.borderWidth,radius:paint!.radius};}
  return insertPresets([preset]);
}
export function insertPresets(items:AppearancePreset[]):Result<Id>{
  const p=getProject(),all={...p.stylePresets},names=new Set(Object.values(all).map(p=>key(p.name)));if(Object.keys(all).length+items.length>128)return fail(problem('preset/limit','作品最多保存128个外观预设'));
  for(const raw of items){const parsed=parseAppearancePreset(raw);if(!parsed.ok)return parsed;const v=parsed.value;if(all[v.id]||names.has(key(v.name)))return fail(problem('preset/name','预设名称或编号重复，请先重命名或删除同名预设'));names.add(key(v.name));all[v.id]={...v,presentation:{...v.presentation,effects:v.presentation.effects.map(e=>({...e,id:newId()}))}};}
  const r=execute({label:'保存外观预设',context:{pageId:sessionStore.getState().activePageId,selection:sessionStore.getState().selection},mutate(d){const m=migrateProject(d);if(!m.ok)throw Error(m.problems[0].message);Object.assign(d,m.value);d.stylePresets=all;}});return r.ok?ok(items[0].id):r;
}
export function applyAppearancePreset(ids:Id[],id:Id,colorOnly=false):Result<void>{const p=getProject(),preset=p.stylePresets?.[id];if(!preset)return fail(problem('preset/missing','预设已删除'));if(colorOnly&&(!preset.paint||ids.some(id=>!layerPaint(p.layers[id]))))return fail(problem('preset/color','当前选区无法读取填充颜色'));const b=beginAppearanceEdit(ids,'读取外观预设');if(!b.ok)return b;const r=previewAppearance(l=>{if(colorOnly)patchPaint(l,{fill:preset.paint!.fill});else{const hint=l.presentation?.transformHint;l.presentation=structuredClone(preset.presentation);if(hint)l.presentation.transformHint=hint;l.presentation.effects=l.presentation.effects.map(e=>({...e,id:newId()}));if(preset.paint)patchPaint(l,preset.paint);}});if(!r.ok){cancelAppearanceEdit();return r;}return commitAppearanceEdit();}
export function deleteAppearancePreset(id:Id):Result<void>{const r=execute({label:'删除外观预设',context:{pageId:sessionStore.getState().activePageId,selection:sessionStore.getState().selection},mutate(p){delete p.stylePresets?.[id];}});return r.ok?ok(undefined):r;}
export function parsePresetFile(text:string):Result<AppearancePreset[]>{if(new TextEncoder().encode(text).length>1048576)return fail(problem('preset/file','预设文件超过1MiB'));try{const v=JSON.parse(text);if(v?.format!=='comia-appearance'||v.version!==1||!Array.isArray(v.presets)||!v.presets.length||v.presets.length>128)throw Error();const items:AppearancePreset[]=[];for(const raw of v.presets){const r=parseAppearancePreset({...raw,id:newId()});if(!r.ok)return r;items.push(r.value);}return ok(items);}catch{return fail(problem('preset/file','不是有效的Comia外观预设文件'));}}
