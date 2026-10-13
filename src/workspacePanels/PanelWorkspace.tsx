import { useEffect,useLayoutEffect,useRef,useState,type CSSProperties,type ReactNode } from 'react';
import { useStore } from 'zustand';
import { ResponsiveSidebar } from '../app/ResponsiveSidebar';
import { PanelRegistry,PanelHostSlot,createPanelHosts } from './PanelRegistry';
import { panelLayoutStore,installPanelPersistence,publishLayout } from './panelLayoutStore';
import { showPanel,updateLayout } from './layoutCommands';
import { PANEL_IDS,PANEL_LABELS,type PanelId } from './types';
import { dockWidths,fitFloatingRect } from './layoutGeometry';
import { PanelGroupView,changePanelLayout } from './PanelGroupView';
import { PanelDragController } from './PanelDragController';
import { installPanelInputProtection,panelChangeAllowed,protectPanelDraft } from './panelInteraction';
import { registerHistoryTravelGuard } from '../history/historyTravel';
import { currentDrawing } from '../panels/drawingController';
import { currentMaskEdit } from '../images/maskController';
import { currentBreakoutEdit } from '../images/breakoutController';
import { currentCropEdit } from '../images/cropController';
import { currentImageTrim } from '../images/trimController';
import { currentBubbleBrush } from '../bubbles/brushController';
import { currentCreation } from '../library/creationController';
import { currentSpeedStroke } from '../library/speedBrushController';
import { mangaEditStore } from '../bubbles/mangaEditController';
import './panels.css';
export function revealPanel(id:PanelId){if(!panelChangeAllowed())return;changePanelLayout(l=>showPanel(l,id));window.dispatchEvent(new CustomEvent('comia:show-panel',{detail:id}));}
export function PanelWorkspace({contents,children,drawer,setDrawer,closeDrawer,busy}:{contents:Record<PanelId,ReactNode>;children:ReactNode;drawer:'left'|'right'|null;setDrawer:(v:'left'|'right'|null)=>void;closeDrawer:()=>void;busy:boolean}) {
  const layout=useStore(panelLayoutStore,s=>s.layout),root=useRef<HTMLDivElement>(null),controller=useRef<PanelDragController|null>(null),[hosts]=useState(createPanelHosts),[size,setSize]=useState({width:window.innerWidth,height:window.innerHeight-120}),[mobile,setMobile]=useState<PanelId|null>(null),[expanded,setExpanded]=useState<PanelId|null>(null);
  const widths=dockWidths(layout,size.width),narrow=useRef(widths.narrow),busyRef=useRef(busy);narrow.current=widths.narrow;busyRef.current=busy;
  const safeClose=()=>{if(panelChangeAllowed())protectPanelDraft(closeDrawer);};
  const chooseMobile=(id:PanelId)=>{if(panelChangeAllowed())protectPanelDraft(()=>{if(panelLayoutStore.getState().layout.hidden.includes(id))publishLayout(showPanel(panelLayoutStore.getState().layout,id));setMobile(id);});};
  useEffect(()=>{const off=installPanelPersistence(),input=installPanelInputProtection(),guard=registerHistoryTravelGuard(()=>busyRef.current?'正在读写或切换项目':currentDrawing()||currentMaskEdit()||currentBreakoutEdit()||currentCropEdit()||currentImageTrim()||currentBubbleBrush()||currentCreation()||currentSpeedStroke()||mangaEditStore.getState().active?'请先完成或取消当前编辑，再恢复历史':null);return()=>{off();input();guard();};},[]);
  useLayoutEffect(()=>{
    const n=root.current!;controller.current=new PanelDragController(n,()=>narrow.current);const measure=()=>{const b=n.getBoundingClientRect();setSize(s=>s.width===b.width&&s.height===b.height?s:{width:b.width,height:b.height});};
    measure();const o=new ResizeObserver(measure);o.observe(n);return()=>{o.disconnect();controller.current?.cancel();controller.current=null;};
  },[]);
  useEffect(()=>{const show=(event:Event)=>{if(narrow.current){const id=(event as CustomEvent<PanelId>).detail;setMobile(id);setDrawer(['components','assets','pages'].includes(id)?'left':'right');}};window.addEventListener('comia:show-panel',show);return()=>window.removeEventListener('comia:show-panel',show);},[setDrawer]);
  useEffect(()=>{const expand=(event:Event)=>{const id=(event as CustomEvent<PanelId|null>).detail;if(id!==null&&!panelChangeAllowed())return;controller.current?.cancel();protectPanelDraft(()=>setExpanded(id));};window.addEventListener('comia:expand-panel',expand);return()=>window.removeEventListener('comia:expand-panel',expand);},[]);
  useEffect(()=>{if(expanded&&layout.hidden.includes(expanded))protectPanelDraft(()=>setExpanded(null));},[layout.hidden,expanded]);
  useEffect(()=>{if(!widths.narrow && drawer)setDrawer(null);},[widths.narrow]);
  const style={'--dock-left':`${widths.left}px`,'--dock-right':`${widths.right}px`} as CSSProperties;
  const columnKey=(e:React.KeyboardEvent,side:'left'|'right')=>{if(!['ArrowLeft','ArrowRight'].includes(e.key)||e.nativeEvent.isComposing)return;e.preventDefault();e.stopPropagation();const delta=(e.key==='ArrowRight'?1:-1)*(e.shiftKey?1:10)*(side==='left'?1:-1);changePanelLayout(l=>updateLayout(l,d=>{d.docks[side].width=Math.max(192,Math.min(480,d.docks[side].width+delta));}));};
  return <><div className="mobile-sidebar-toolbar" data-panel-chrome data-text-edit-preserve onPointerDown={e=>e.preventDefault()} style={widths.narrow?{display:'flex'}:undefined}><button aria-controls="sidebar-left" aria-expanded={drawer==='left'} onClick={()=>{if(panelChangeAllowed())protectPanelDraft(()=>{setMobile(null);setDrawer(drawer==='left'?null:'left');});}}>组件 / 页面</button><button aria-controls="sidebar-right" aria-expanded={drawer==='right'} onClick={()=>{if(panelChangeAllowed())protectPanelDraft(()=>{setMobile(null);setDrawer(drawer==='right'?null:'right');});}}>属性 / 图层</button></div>
    {drawer&&widths.narrow&&<button className="sidebar-scrim" aria-label="关闭侧栏" tabIndex={-1} onClick={safeClose} />}
    <div ref={root} className="editor-body panel-workspace" data-narrow={widths.narrow} style={style}>
      <PanelRegistry hosts={hosts} contents={contents} />
      {(['left','right'] as const).map(side=><ResponsiveSidebar key={side} side={side} open={widths.narrow&&drawer===side} close={safeClose}>
        {widths.narrow ? <><div className="mobile-panel-chooser" data-panel-chrome data-text-edit-preserve onPointerDown={e=>e.preventDefault()}>{PANEL_IDS.map(id=><button key={id} aria-pressed={mobile===id} onClick={()=>chooseMobile(id)}>{PANEL_LABELS[id]}</button>)}</div>
          {PANEL_IDS.filter(id=>id!==expanded && drawer===side && (mobile?id===mobile:side==='left'?id==='components':id==='inspector'||id==='layers')).map(id=><PanelHostSlot key={id} host={hosts[id]} id={id} active />)}</>
        : <div className="dock-stack">{layout.docks[side].groups.map((id,i)=><div key={id} className="dock-group-slot" style={{flex:layout.groups[id].collapsed?'0 0 32px':`${layout.docks[side].weights[i]} 1 0`,minHeight:layout.groups[id].collapsed?32:64}}>
          <PanelGroupView group={layout.groups[id]} layout={layout} hosts={hosts} controller={()=>controller.current} weight={1} expanded={expanded} />
          {i<layout.docks[side].groups.length-1 && <button className="dock-split-handle" aria-label={`调整${side==='left'?'左':'右'}侧面板高度 ${i+1}`} onPointerDown={e=>controller.current?.begin(e.nativeEvent,e.currentTarget,{kind:'split',side,index:i})} onKeyDown={e=>{if(!['ArrowUp','ArrowDown'].includes(e.key)||e.nativeEvent.isComposing)return;e.preventDefault();e.stopPropagation();changePanelLayout(l=>updateLayout(l,d=>{const w=d.docks[side].weights,delta=e.key==='ArrowUp'?-.03:.03;w[i]=Math.max(.1,w[i]+delta);w[i+1]=Math.max(.1,w[i+1]-delta);}));}} />}
        </div>)}</div>}
      </ResponsiveSidebar>)}
      <div className="panel-canvas-slot">{children}</div>
      {!widths.narrow && <>{layout.docks.left.groups.length>0 && <button className="dock-column-handle left" aria-label="调整左侧栏宽度" style={{left:widths.left-2}} onPointerDown={e=>controller.current?.begin(e.nativeEvent,e.currentTarget,{kind:'column',side:'left'})} onKeyDown={e=>columnKey(e,'left')} />}{layout.docks.right.groups.length>0 && <button className="dock-column-handle right" aria-label="调整右侧栏宽度" style={{right:widths.right-2}} onPointerDown={e=>controller.current?.begin(e.nativeEvent,e.currentTarget,{kind:'column',side:'right'})} onKeyDown={e=>columnKey(e,'right')} />}
        {layout.floating.map((f,i)=><PanelGroupView key={f.groupId} group={layout.groups[f.groupId]} layout={layout} hosts={hosts} controller={()=>controller.current} rect={fitFloatingRect(f.rect,size)} z={20+i} expanded={expanded} />)}</>}
      {expanded&&<section className="panel-expand-window" role="dialog" aria-modal="false" aria-label={`${PANEL_LABELS[expanded]}展开窗`} style={{width:Math.max(1,Math.min(expanded==='inspector'?1004:760,size.width-32)),height:Math.max(1,size.height-32),left:Math.max(8,(size.width-Math.min(expanded==='inspector'?1004:760,size.width-32))/2),top:16}} onKeyDown={e=>{if(e.key==='Escape'&&!e.nativeEvent.isComposing&&!(e.target as HTMLElement).closest('input,textarea,select')){e.preventDefault();e.stopPropagation();window.dispatchEvent(new CustomEvent('comia:expand-panel',{detail:null}));}}}>
        <header data-panel-chrome data-text-edit-preserve onPointerDown={e=>e.preventDefault()}><strong>{PANEL_LABELS[expanded]}</strong><span>展开查看</span><button aria-label={`收回${PANEL_LABELS[expanded]}展开窗`} onClick={()=>window.dispatchEvent(new CustomEvent('comia:expand-panel',{detail:null}))}>收回面板 ×</button></header><PanelHostSlot host={hosts[expanded]} id={expanded} active />
      </section>}
    </div></>;
}
