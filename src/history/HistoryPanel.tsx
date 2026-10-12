import { useEffect,useRef,useState,useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import { documentStore,getDocument } from '../state/documentStore';
import { pushNotice,sessionStore } from '../state/sessionStore';
import { runtimeStore } from '../state/runtimeStore';
import { travelToHistoryState,clearHistory } from './commandBus';
import { historyRows } from './historyRows';
import { FocusDialog } from '../app/FocusDialog';
import { drawingStore } from '../panels/drawingController';
import { maskEditStore } from '../images/maskController';
import { breakoutEditStore } from '../images/breakoutController';
import { cropEditStore } from '../images/cropController';
import { mangaEditStore } from '../bubbles/mangaEditController';
import { speedBrushStore } from '../library/speedBrushController';
import { currentCreation,subscribeCreation } from '../library/creationController';
export function HistoryPanel({busy=false}:{busy?:boolean}) {
  const doc=useStore(documentStore),editing=useStore(sessionStore,s=>!!s.textEditingId || s.toolMode==='crop'),preview=useStore(runtimeStore,s=>s.gestureActive || !!s.previewProject);
  const [confirm,setConfirm]=useState(false),[scroll,setScroll]=useState(0),[height,setHeight]=useState(300),list=useRef<HTMLDivElement>(null),rows=historyRows(doc.history);
  const drawing=useStore(drawingStore,s=>!!s.active),mask=useStore(maskEditStore,s=>!!s.active),breakout=useStore(breakoutEditStore,s=>!!s.active),crop=useStore(cropEditStore,s=>!!s.active),manga=useStore(mangaEditStore,s=>!!s.active),brush=useStore(speedBrushStore,s=>!!s.active),creation=useSyncExternalStore(subscribeCreation,()=>!!currentCreation());
  useEffect(()=>{const n=list.current!;const resize=()=>setHeight(n.clientHeight);const o=new ResizeObserver(resize);o.observe(n);resize();return()=>o.disconnect();},[]);
  useEffect(()=>{const n=list.current;if(n){const y=doc.history.past.length*36;if(y<n.scrollTop || y+36>n.scrollTop+n.clientHeight)n.scrollTop=Math.max(0,y-n.clientHeight/2);}},[doc.history.stateId]);
  const reason=busy?'正在保存、打开或切换项目':editing||preview||drawing||mask||breakout||crop||manga||brush||creation?'请先完成或取消当前编辑，再恢复历史':null;
  const start=Math.max(0,Math.floor(scroll/36)-3),end=Math.min(rows.length,start+Math.ceil(height/36)+7);
  return <div className="history-panel"><div className="section-title"><span>编辑历史</span><button className="tiny-action" disabled={!!reason} onClick={()=>setConfirm(true)}>清空历史</button></div>
    {reason && <p className="history-reason" role="status">{reason}</p>}
    <div ref={list} className="history-list" aria-label="编辑历史状态" onScroll={e=>setScroll(e.currentTarget.scrollTop)}><div aria-hidden style={{height:start*36}} />
      {rows.slice(start,end).map(row=><button key={row.stateId} className={`history-row${row.current?' current':''}${row.future?' future':''}`} aria-current={row.current?'step':undefined} disabled={!!reason} onClick={()=>{
        const d=getDocument(),r=travelToHistoryState(row.stateId,{projectId:d.project.id,epoch:d.epoch,stateId:d.history.stateId});if(!r.ok)pushNotice('error',r.problems[0].message);
      }}><span aria-hidden>{row.current?'●':row.future?'↷':'↶'}</span><span><span className="history-label">{row.label}</span><small>{row.pageId?doc.project.pages[row.pageId]?.name ?? '已删除页面':'保留历史起点'}</small></span></button>)}
      <div aria-hidden style={{height:(rows.length-end)*36}} /></div>
    {confirm && <FocusDialog title="清空编辑历史" onCancel={()=>setConfirm(false)}><strong>清空编辑历史</strong><p>当前画面会保留，此前操作将无法撤销。正在编辑时须先完成或取消编辑。</p><div className="dialog-actions"><button onClick={()=>setConfirm(false)}>取消</button><button onClick={()=>{const r=clearHistory(true);if(r.ok)setConfirm(false);else pushNotice('error',r.problems[0].message);}}>确认清空</button></div></FocusDialog>}
  </div>;
}
