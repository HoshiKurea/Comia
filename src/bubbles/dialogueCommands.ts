import type { DialogueSpec, Id, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { createLayer } from '../domain/factories';
import { getProject } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { execute } from '../history/commandBus';
import { groupEligibility, ungroup } from '../layers/group';
import { composeBubble } from './composeBubble';
import { prepareDialogue } from './dialogueGeometry';
import { multiply, rectCorners, translation } from '../geometry/matrix';
import { polyBounds } from '../geometry/polygon';
import { promoteMangaDraft } from './mangaDraft';
import { beginMangaEdit, mangaEditGuard, publishMangaPreview } from './mangaEditController';
import { parseDialogue } from '../domain/mangaValidation';

export function dialogueEligibility(project:Project,ids:Id[]):Result<Id[]>{
  const group=groupEligibility(project,ids);if(!group.ok)return group;
  if(group.value.length>16||group.value.some(id=>project.layers[id].type!=='bubble'))return fail(problem('dialogue/count','请选择2～16个连续气泡主体，文字或普通编组不能代替主体'));
  if(group.value.some(id=>!effectiveLayerFlags(project,id).visible))return fail(problem('dialogue/hidden','请先显示所有选中的气泡'));
  return group;
}
export function createDialogue(ids:Id[],mode:DialogueSpec['mode']):Result<Id>{
  const project=getProject(),eligible=dialogueEligibility(project,ids);if(!eligible.ok)return eligible;
  const ordered=eligible.value,first=project.layers[ordered[0]],top=project.layers[ordered.at(-1)!];if(top.type!=='bubble')return fail(problem('dialogue/member','请选择气泡'));
  const draft=structuredClone(project);promoteMangaDraft(draft);const points=[];
  for(const id of ordered){const geometry=composeBubble(draft,id);if(!geometry.ok)return geometry;points.push(...rectCorners(geometry.value.bounds,draft.layers[id].matrix));}
  const bounds=polyBounds(points),group=createLayer('group',first.pageId);if(group.type!=='group')throw Error('group factory');group.name='连续对白';group.parentId=first.parentId;group.matrix=translation(bounds.x,bounds.y);group.children=ordered;
  if(top.presentation){group.presentation=structuredClone(top.presentation);delete group.presentation.transformHint;}
  group.dialogue={mode,links:ordered.slice(1).map((to,i)=>({from:ordered[i],to,width:24,bend:0})),seamRadius:4,overlapOpacity:.65,fusionStyle:structuredClone(top.style),fusionPressure:top.handDrawn?.pressure??0,seed:top.handDrawn?.seed??42};
  const parent=group.parentId?draft.layers[group.parentId]:null,list=parent&&'children'in parent?parent.children:draft.pages[group.pageId].roots;
  list.splice(list.indexOf(ordered[0]),ordered.length,group.id);draft.layers[group.id]=group;
  for(const id of ordered){draft.layers[id].parentId=group.id;draft.layers[id].matrix=multiply(translation(-bounds.x,-bounds.y),draft.layers[id].matrix);}
  const checked=prepareDialogue(draft,group.id);if(!checked.ok)return checked;
  const result=execute({label:'建立连续对白',context:{pageId:group.pageId,selection:sessionStore.getState().selection},afterSelection:[group.id],mutate(p){Object.assign(p,draft);}});
  if(result.ok)sessionStore.setState({expanded:[...new Set([...sessionStore.getState().expanded,group.id])]});return result.ok?ok(group.id):result;
}
export function setDialogueMode(id:Id,mode:DialogueSpec['mode']):Result<void>{
  const began=beginMangaEdit(id,'dialogue');if(!began.ok)return began;return updateDialogueStyle(id,{mode});
}
export function updateDialogueStyle(id:Id,patch:Partial<DialogueSpec>):Result<void>{
  const guard=mangaEditGuard();if(!guard.ok)return guard;const active=guard.value;if(active.kind!=='dialogue'||active.id!==id)return fail(problem('dialogue/session','请先编辑该对白组'));
  const group=active.preview.layers[id];if(group.type!=='group'||!group.dialogue)return fail(problem('dialogue/target','对白组已不存在'));
  const spec=parseDialogue({...group.dialogue,...patch},`layers.${id}.dialogue`);if(!spec.ok)return spec;
  const preview={...active.preview,layers:{...active.preview.layers,[id]:{...group,dialogue:spec.value}}};
  return publishMangaPreview(preview);
}
export function dissolveDialogue(id:Id):Result<Id[]>{const group=getProject().layers[id];return group?.type==='group'&&group.dialogue?ungroup(id):fail(problem('dialogue/target','请选择连续对白组'));}
