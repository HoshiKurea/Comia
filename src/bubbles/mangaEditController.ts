import { createStore } from 'zustand/vanilla';
import type { Id, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { getDocument } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { runtimeStore } from '../state/runtimeStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { cancelActiveGesture, registerGestureCanceller } from '../interaction/activeGesture';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { migrateProject } from '../storage/migrateProject';
import { retainResources } from '../storage/blobRepository';
import { execute } from '../history/commandBus';
import { validateProject } from '../domain/validate';
import { hasLockedDescendant } from '../layers/group';
import { prepareDialogue } from './dialogueGeometry';
import { editorGeometryTarget } from './editorTarget';

export type MangaEditKind='shape'|'tail'|'dialogue';
export interface MangaEdit {
  id:Id;kind:MangaEditKind;pageId:Id;epoch:number;stateId:Id;
  base:Project;initial:Project;preview:Project;revision:number;
}
export const mangaEditStore=createStore<{active:MangaEdit|null}>(()=>({active:null}));
export const currentMangaEdit=()=>mangaEditStore.getState().active;
let unregister:(()=>void)|null=null,unsubscribe:(()=>void)|null=null,release:(()=>void)|null=null;
const pending=new Map<string,()=>void>();let pendingFrame=0;
/** Coalesce each property's newest patch; different properties in a frame are retained. */
export function queueMangaPatch(key:string,apply:()=>void):void{pending.set(key,apply);if(!pendingFrame)pendingFrame=requestAnimationFrame(flushMangaPatches);}
export function flushMangaPatches():void{if(pendingFrame)cancelAnimationFrame(pendingFrame);pendingFrame=0;const batch=[...pending.values()];pending.clear();for(const apply of batch)apply();}
function discardPatches():void{if(pendingFrame)cancelAnimationFrame(pendingFrame);pendingFrame=0;pending.clear();}
export function cancelMangaEdit():void{
  discardPatches();
  if(!currentMangaEdit())return;
  unregister?.();unregister=null;unsubscribe?.();unsubscribe=null;
  mangaEditStore.setState({active:null});release?.();release=null;
  runtimeStore.setState({gestureActive:false,previewProject:null});
}
export function beginMangaEdit(id:Id,kind:MangaEditKind):Result<void>{
  const prior=currentMangaEdit();if(prior?.id===id&&prior.kind===kind)return ok(undefined);
  const edit=finishActiveTextEdit();if(!edit.ok)return edit;cancelActiveGesture();
  const doc=getDocument(),layer=doc.project.layers[id],flags=effectiveLayerFlags(doc.project,id);
  if(!layer||layer.pageId!==sessionStore.getState().activePageId||flags.locked||!flags.visible||kind==='shape'&&layer.type!=='bubble'||kind==='tail'&&layer.type!=='bubbleTail'||kind==='dialogue'&&(layer.type!=='group'||!layer.dialogue))return fail(problem('manga/edit-target','请选择当前页可见且未锁定的目标'));
  if(kind==='dialogue'&&hasLockedDescendant(doc.project,id))return fail(problem('dialogue/locked-member','对白组包含锁定主体、文字或尾巴，请先解锁再修改组合方式/样式'));
  const upgraded=migrateProject(structuredClone(doc.project));if(!upgraded.ok)return upgraded;
  const preview=upgraded.value;
  release=retainResources(doc.project);
  sessionStore.setState({selection:[id],toolMode:'select'});
  mangaEditStore.setState({active:{id,kind,pageId:layer.pageId,epoch:doc.epoch,stateId:doc.history.stateId,base:doc.project,initial:preview,preview,revision:0}});
  runtimeStore.setState({gestureActive:true,previewProject:preview});
  unregister=registerGestureCanceller(cancelMangaEdit);
  unsubscribe=sessionStore.subscribe(s=>{const active=currentMangaEdit();if(active&&(s.activePageId!==active.pageId||s.toolMode!=='select'||!s.selection.includes(active.id)))cancelMangaEdit();});
  return ok(undefined);
}
export function mangaEditGuard():Result<MangaEdit>{
  const active=currentMangaEdit(),doc=getDocument();if(!active)return fail(problem('manga/edit-inactive','请先进入编辑'));
  if(doc.epoch!==active.epoch||doc.history.stateId!==active.stateId){cancelMangaEdit();return fail(problem('manga/edit-stale','作品已变化，旧编辑已取消'));}
  const flags=effectiveLayerFlags(doc.project,active.id);if(flags.locked||!flags.visible){cancelMangaEdit();return fail(problem('manga/edit-locked','目标已锁定或隐藏，旧编辑已取消'));}
  return ok(active);
}
/** Caller validates only affected geometry. Initial entry and final commit validate the full document. */
export function publishMangaPreview(preview:Project):Result<void>{
  const guard=mangaEditGuard();if(!guard.ok)return guard;
  const active=guard.value;if(preview.id!==active.initial.id||preview.layers[active.id]?.pageId!==active.pageId)return fail(problem('manga/edit-identity','预览目标身份已改变'));
  for(let id:Id|null=active.id;id;id=preview.layers[id]?.parentId??null){const layer=preview.layers[id];if(layer?.type==='group'&&layer.dialogue){const geometry=prepareDialogue(preview,id,editorGeometryTarget(preview,id));if(!geometry.ok)return geometry;}}
  mangaEditStore.setState({active:{...active,preview,revision:active.revision+1}});runtimeStore.setState({previewProject:preview});return ok(undefined);
}
export function commitMangaEdit():Result<void>{
  flushMangaPatches();
  const guard=mangaEditGuard();if(!guard.ok)return guard;
  const active=guard.value;
  if(JSON.stringify(active.preview)===JSON.stringify(active.initial)){cancelMangaEdit();return ok(undefined);}
  const checked=validateProject(active.preview);if(!checked.ok)return checked;
  const preview=structuredClone(active.preview);cancelMangaEdit();
  const result=execute({label:active.kind==='shape'?'编辑手绘气泡':active.kind==='tail'?'编辑气泡尾巴':'编辑连续对白',context:{pageId:active.pageId,selection:[active.id]},afterSelection:[active.id],mutate(draft){Object.assign(draft,preview);}});
  return result.ok?ok(undefined):result;
}
