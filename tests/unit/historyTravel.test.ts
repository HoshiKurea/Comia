import { beforeEach,expect,it } from 'vitest';
import { createProject } from '../../src/domain/factories';
import { documentStore,getDocument } from '../../src/state/documentStore';
import { execute,replaceDocument,travelToHistoryState,isDirty } from '../../src/history/commandBus';
import { historyRows } from '../../src/history/historyRows';
import { sessionStore } from '../../src/state/sessionStore';
import { runtimeStore } from '../../src/state/runtimeStore';
import { registerHistoryTravelGuard } from '../../src/history/historyTravel';
import { addPage } from '../../src/pages/commands';
const token=()=>{const d=getDocument();return{projectId:d.project.id,epoch:d.epoch,stateId:d.history.stateId};};
function rename(name:string){const d=getDocument();expect(execute({label:'命名 '+name,context:{pageId:d.project.pageOrder[0],selection:[]},mutate(p){p.name=name;}}).ok).toBe(true);}
beforeEach(()=>{runtimeStore.setState({gestureActive:false,previewProject:null});sessionStore.setState({textEditingId:null,toolMode:'select'});expect(replaceDocument(createProject()).ok).toBe(true);});
it('travels backwards and forwards with one document publication and no added history entries',()=>{
 const base=getDocument().history.stateId;rename('甲');rename('乙');rename('丙');const end=getDocument(),middle=end.history.past[0].afterStateId;let changes=0;const off=documentStore.subscribe(()=>changes++);
 expect(travelToHistoryState(middle,token()).ok).toBe(true);expect(changes).toBe(1);expect(getDocument().project.name).toBe('甲');expect(getDocument().history.past).toHaveLength(1);expect(getDocument().history.future).toHaveLength(2);
 expect(travelToHistoryState(end.history.stateId,token()).ok).toBe(true);expect(changes).toBe(2);expect(getDocument().project).toEqual(end.project);expect(getDocument().history).toEqual(end.history);
 expect(travelToHistoryState(base,token()).ok).toBe(true);expect(changes).toBe(3);expect(getDocument().project.name).toBe('未命名项目');off();
});
it('leaves current content and saved marker unchanged for the current state and restores dirty status at saved state',()=>{
 rename('保存');const saved=getDocument().history.stateId;documentStore.setState({savedStateId:saved});rename('新稿');expect(isDirty()).toBe(true);
 expect(travelToHistoryState(saved,token()).ok).toBe(true);expect(isDirty()).toBe(false);const before=getDocument();expect(travelToHistoryState(saved,token()).ok).toBe(true);expect(getDocument()).toBe(before);expect(getDocument().savedStateId).toBe(saved);
});
it('rejects stale epoch/project/state tokens and unknown target states without publication',()=>{
 const old=token();rename('改变');const before=getDocument();for(const t of [old,{...token(),epoch:999},{...token(),projectId:'foreign'}])expect(travelToHistoryState(before.history.past[0].beforeStateId,t).ok).toBe(false);
 expect(travelToHistoryState('trimmed',token()).ok).toBe(false);expect(getDocument()).toBe(before);
});
it('rolls back every intermediate patch on a damaged patch or invalid intermediate project',()=>{
 rename('甲');rename('乙');rename('丙');const original=getDocument(),base=original.history.past[0].beforeStateId,pid=original.project.pageOrder[0];
 for(const patch of [{op:'remove',path:'/missing'} as const,{op:'replace',path:`/pages/${pid}/width`,value:0} as const]){
  const d=structuredClone(original);d.history.past[1].inverse=[patch];documentStore.setState(d);const before=getDocument();expect(travelToHistoryState(base,token()).ok).toBe(false);expect(getDocument()).toBe(before);
 }
});
it('rejects duplicate or disconnected history states before applying any patches',()=>{
 rename('甲');rename('乙');for(const kind of ['duplicate','disconnected']){const d=structuredClone(getDocument());if(kind==='duplicate')d.history.past[1].afterStateId=d.history.past[0].afterStateId;else d.history.past[1].beforeStateId='wrong';documentStore.setState(d);const before=getDocument();expect(travelToHistoryState(d.history.past[0].beforeStateId,token()).ok).toBe(false);expect(getDocument()).toBe(before);}
});
it('does not implicitly commit text or edit previews when history is clicked',()=>{
 rename('甲');const base=getDocument().history.past[0].beforeStateId;for(const start of [()=>sessionStore.setState({textEditingId:'draft'}),()=>runtimeStore.setState({previewProject:getDocument().project}),()=>runtimeStore.setState({gestureActive:true}),()=>sessionStore.setState({toolMode:'crop'})]){start();const before=getDocument();expect(travelToHistoryState(base,token()).ok).toBe(false);expect(getDocument()).toBe(before);sessionStore.setState({textEditingId:null,toolMode:'select'});runtimeStore.setState({previewProject:null,gestureActive:false});}
 const off=registerHistoryTravelGuard(()=> '正在切换项目');expect(travelToHistoryState(base,token()).ok).toBe(false);off();
});
it('restores the appropriate page and removes stale scope when crossing page creation',()=>{
 const pid=getDocument().project.pageOrder[0],base=getDocument().history.stateId;expect(addPage(pid).ok).toBe(true);const after=getDocument();sessionStore.setState({scopeId:'stale'});
 expect(travelToHistoryState(base,token()).ok).toBe(true);expect(sessionStore.getState().activePageId).toBe(pid);expect(sessionStore.getState().scopeId).toBeNull();expect(travelToHistoryState(after.history.stateId,token()).ok).toBe(true);expect(getDocument().project).toEqual(after.project);
});
it('shows true transaction labels, highlights current position and removes future rows after branching',()=>{
 rename('甲');rename('乙');const first=getDocument().history.past[0].afterStateId;expect(travelToHistoryState(first,token()).ok).toBe(true);let rows=historyRows(getDocument().history);expect(rows.map(r=>r.label)).toEqual(['当前可回退起点','命名 甲','命名 乙']);expect(rows[1].current).toBe(true);expect(rows[2].future).toBe(true);rename('新分支');rows=historyRows(getDocument().history);expect(rows.map(r=>r.label)).toEqual(['当前可回退起点','命名 甲','命名 新分支']);expect(rows.at(-1)?.current).toBe(true);
});
it('uses the retained 200-entry base rather than pretending trimmed edits are still recoverable',()=>{
 for(let i=0;i<205;i++)rename(String(i));const d=getDocument(),rows=historyRows(d.history);expect(d.history.past).toHaveLength(200);expect(rows).toHaveLength(201);expect(rows[0].stateId).not.toBe(d.project.id);expect(rows.at(-1)?.current).toBe(true);expect(travelToHistoryState(rows[0].stateId,token()).ok).toBe(true);expect(getDocument().project.name).toBe('4');expect(getDocument().history.future).toHaveLength(200);
});
