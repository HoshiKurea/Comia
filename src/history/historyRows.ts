import type { HistoryState } from './types';
export interface HistoryRow {stateId:string;label:string;position:number;current:boolean;future:boolean;pageId:string|null}
export function historyRows(history:HistoryState):HistoryRow[] {
  const chain=[...history.past,...history.future],base=history.past[0]?.beforeStateId ?? history.stateId;
  return [{stateId:base,label:'当前可回退起点',position:0,current:history.past.length===0,future:false,pageId:null},...chain.map((e,i)=>({stateId:e.afterStateId,label:e.label,position:i+1,current:i+1===history.past.length,future:i>=history.past.length,pageId:e.afterPageId ?? e.pageId}))];
}
