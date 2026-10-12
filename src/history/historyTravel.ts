import { fail,ok,problem,type Result,type Project } from '../domain/types';
import type { DocumentStoreState } from '../state/documentStore';
import type { HistoryEntry,HistoryState,JsonValue } from './types';
import { applyPatches } from './jsonPatch';
import { validateProject } from '../domain/validate';
export interface HistoryJumpToken { projectId:string;epoch:number;stateId:string }
interface TravelResult {project:Project;history:HistoryState;pageId:string;selection:string[];changed:boolean}
let guard:(()=>string|null)|null=null;
export function registerHistoryTravelGuard(fn:()=>string|null){guard=fn;return()=>{if(guard===fn)guard=null;};}
export function historyTravelGuard(){return guard?.() ?? null;}
export function prepareHistoryTravel(doc:DocumentStoreState,target:string,token:HistoryJumpToken):Result<TravelResult> {
  const bad=(message:string):Result<TravelResult>=>fail(problem('history/travel',message));
  if(token.projectId!==doc.project.id || token.epoch!==doc.epoch || token.stateId!==doc.history.stateId)return bad('作品或历史已变化，请重新选择历史项');
  const chain=[...doc.history.past,...doc.history.future],k=doc.history.past.length,base=doc.history.past[0]?.beforeStateId ?? doc.history.stateId;
  const states=[base,...chain.map(e=>e.afterStateId)];
  if(new Set(states).size!==states.length || states[k]!==doc.history.stateId || chain.some((e,i)=>e.beforeStateId!==states[i]))return bad('历史状态链不一致，未执行恢复');
  const m=states.indexOf(target);if(m<0)return bad('目标历史已不在可回退范围');
  if(m===k)return ok({project:doc.project,history:doc.history,pageId:doc.project.pageOrder[0],selection:[],changed:false});
  const project=structuredClone(doc.project);let last:HistoryEntry|null=null;
  try{
    const indices=m<k?Array.from({length:k-m},(_,i)=>k-1-i):Array.from({length:m-k},(_,i)=>k+i);
    for(const i of indices){last=chain[i];applyPatches(project as unknown as JsonValue,m<k?last.inverse:last.forward);const v=validateProject(project);if(!v.ok)return fail(...v.problems);}
  }catch(e){return bad(`恢复失败，作品保持：${(e as Error).message}`);}
  const e=last!,requested=m<k?e.pageId:e.afterPageId ?? e.pageId,pageId=project.pages[requested]?requested:project.pageOrder[0];
  return ok({project,history:{past:chain.slice(0,m),future:chain.slice(m),stateId:target},pageId,selection:(m<k?e.beforeSelection:e.afterSelection).filter(id=>project.layers[id] && project.layers[id].pageId===pageId),changed:true});
}
