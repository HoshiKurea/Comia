import { useRef,type CSSProperties } from 'react';
import type { Rect,Result } from '../domain/types';
import { panelLayoutStore,publishLayout } from './panelLayoutStore';
import { movePanels,setActivePanel,setCollapsed,closePanel,updateLayout } from './layoutCommands';
import { PANEL_LABELS,type PanelGroup,type PanelLayout } from './types';
import { PanelHostSlot,type PanelHosts } from './PanelRegistry';
import type { PanelDragController } from './PanelDragController';
import { panelChangeAllowed,protectPanelDraft } from './panelInteraction';
export function changePanelLayout(run:(layout:PanelLayout)=>Result<PanelLayout>){if(panelChangeAllowed())protectPanelDraft(()=>publishLayout(run(panelLayoutStore.getState().layout)));}
export function PanelGroupView({group,layout,hosts,controller,rect,z,weight,expanded}:{group:PanelGroup;layout:PanelLayout;hosts:PanelHosts;controller:()=>PanelDragController|null;rect?:Rect;z?:number;weight?:number;expanded?:typeof group.active|null}) {
  const menu=useRef<HTMLDetailsElement>(null),moved=useRef(false),down=useRef({x:0,y:0}),float=!!rect;
  const style:CSSProperties=rect?{position:'absolute',transform:`translate(${rect.x}px,${rect.y}px)`,width:rect.width,height:group.collapsed?32:rect.height,zIndex:z}:{flex:group.collapsed?'0 0 32px':`${weight ?? 1} 1 0`,minHeight:group.collapsed?32:0};
  const action=(run:(l:PanelLayout)=>Result<PanelLayout>)=>{controller()?.cancel();changePanelLayout(run);if(menu.current)menu.current.open=false;};
  const floatingRect=rect ?? {x:40,y:40,width:320,height:420};
  const source={kind:'group' as const,groupId:group.id};
  const positionMenu=(details:HTMLDetailsElement)=>{
    const options=details.querySelector<HTMLElement>('.panel-menu-options');if(!options)return;
    options.style.cssText='';if(!details.open)return;
    // Viewport positioning escapes the fixed column's clipping, including its bottom group.
    const anchor=details.querySelector('summary')!.getBoundingClientRect(),width=Math.max(1,Math.min(210,window.innerWidth-16));
    options.style.width=`${width}px`;options.style.maxHeight=`${Math.max(1,window.innerHeight-16)}px`;options.style.overflowY='auto';
    const height=options.getBoundingClientRect().height;
    const left=Math.max(8,Math.min(anchor.right-width,window.innerWidth-width-8)),top=Math.max(8,Math.min(anchor.bottom,window.innerHeight-height-8)),origin=details.getBoundingClientRect();
    options.style.position=float?'absolute':'fixed';options.style.right='auto';options.style.left=`${left-(float?origin.left:0)}px`;options.style.top=`${top-(float?origin.top:0)}px`;
  };
  const start=(e:React.PointerEvent<HTMLButtonElement>,panel?:typeof group.active)=>{if(e.pointerType==='touch'&&!e.isPrimary){e.preventDefault();moved.current=true;return;}down.current={x:e.clientX,y:e.clientY};moved.current=false;controller()?.begin(e.nativeEvent,e.currentTarget,{kind:'move',source:panel?{kind:'tab',panel}:source});};
  return <section className={`panel-group${float?' panel-floating':''}${group.collapsed?' collapsed':''}`} data-panel-group={group.id} role="region" aria-label={`${group.tabs.map(p=>PANEL_LABELS[p]).join(' / ')}面板组`} style={style} onPointerDownCapture={()=>{
    if(float && panelLayoutStore.getState().layout.floating.at(-1)?.groupId!==group.id)publishLayout(updateLayout(panelLayoutStore.getState().layout,d=>{const f=d.floating.find(f=>f.groupId===group.id);if(f)d.floating=[...d.floating.filter(f=>f.groupId!==group.id),f];}));
  }}>
    <header className="panel-heading" data-panel-chrome data-text-edit-preserve onPointerDown={e=>{if(e.target instanceof Element && e.target.closest('button,summary'))e.preventDefault();}}>
      <button className="panel-title" aria-label={`移动${PANEL_LABELS[group.active]}面板组`} title="拖动整组 · 浮窗方向键移动10px，Shift为1px" onPointerDown={e=>start(e)} onKeyDown={e=>{
        if(!float||e.nativeEvent.isComposing||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();const step=e.shiftKey?1:10;
        action(l=>updateLayout(l,d=>{const f=d.floating.find(f=>f.groupId===group.id);if(f){f.rect.x+=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0;f.rect.y+=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;}}));
      }}><span className="panel-grip" aria-hidden>⠿</span>{PANEL_LABELS[group.active]}</button>
      <button className="panel-chrome-button" aria-label={`展开${PANEL_LABELS[group.active]}面板`} title="在大浮窗中展开当前面板" onClick={()=>{if(panelChangeAllowed())window.dispatchEvent(new CustomEvent('comia:expand-panel',{detail:group.active}));}}>⤢</button>
      <button className="panel-chrome-button" aria-label={`${group.collapsed?'展开':'折叠'}${PANEL_LABELS[group.active]}面板组`} title={group.collapsed?'展开面板组':'折叠面板组'} onClick={()=>action(l=>setCollapsed(l,group.id,!group.collapsed))}>{group.collapsed?'▾':'▴'}</button>
      <details ref={menu} className="panel-group-menu" onToggle={e=>positionMenu(e.currentTarget)} onKeyDown={e=>{if(e.key==='Escape'&&!e.nativeEvent.isComposing){e.preventDefault();e.stopPropagation();if(menu.current){menu.current.open=false;menu.current.querySelector<HTMLElement>('summary')?.focus();}}}}><summary role="button" tabIndex={0} aria-label={`${PANEL_LABELS[group.active]}面板菜单`} title="面板菜单">⋯</summary><div className="panel-menu-options" data-panel-chrome data-text-edit-preserve>
        <button onClick={()=>action(l=>movePanels(l,source,{kind:'float',rect:floatingRect}))}>浮动整个面板组</button>
        <button onClick={()=>action(l=>movePanels(l,{kind:'tab',panel:group.active},{kind:'float',rect:{...floatingRect,x:floatingRect.x+24,y:floatingRect.y+24}}))}>拆出当前面板</button>
        <button onClick={()=>action(l=>movePanels(l,source,{kind:'dock',side:'left',index:l.docks.left.groups.length}))}>停靠左侧</button>
        <button onClick={()=>action(l=>movePanels(l,source,{kind:'dock',side:'right',index:l.docks.right.groups.length}))}>停靠右侧</button>
        <label>组合当前面板 <select aria-label={`移入面板组 ${PANEL_LABELS[group.active]}`} value="" onChange={e=>{const id=e.target.value;if(id)action(l=>movePanels(l,{kind:'tab',panel:group.active},{kind:'merge',groupId:id,index:l.groups[id].tabs.length}));}}><option value="">选择目标组</option>{Object.values(layout.groups).filter(g=>g.id!==group.id).map(g=><option key={g.id} value={g.id}>{g.tabs.map(p=>PANEL_LABELS[p]).join(' / ')}</option>)}</select></label>
      </div></details>
      <button className="panel-chrome-button" aria-label={`关闭${PANEL_LABELS[group.active]}面板`} title="关闭当前面板，可从窗口菜单重新显示" onClick={()=>action(l=>closePanel(l,group.active))}>×</button>
    </header>
    {!group.collapsed && <><div className="panel-tabs" role="tablist" aria-label={`${group.id} 面板标签`} data-panel-chrome data-text-edit-preserve>
      {group.tabs.map(p=><button key={p} id={`panel-tab-${p}`} role="tab" aria-selected={p===group.active} aria-controls={`panel-content-${p}`} tabIndex={p===group.active?0:-1} className={p===group.active?'active':''}
        onPointerDown={e=>{e.preventDefault();start(e,p);}} onPointerMove={e=>{if(Math.hypot(e.clientX-down.current.x,e.clientY-down.current.y)>=4)moved.current=true;}}
        onClick={e=>{if(moved.current&&e.detail!==0){moved.current=false;return;}action(l=>setActivePanel(l,p));}}
        onContextMenu={e=>{e.preventDefault();action(l=>setActivePanel(l,p));if(menu.current)menu.current.open=true;}}
        onKeyDown={e=>{if(e.nativeEvent.isComposing)return;const i=group.tabs.indexOf(p);if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();const n=e.key==='Home'?0:e.key==='End'?group.tabs.length-1:(i+(e.key==='ArrowLeft'?-1:1)+group.tabs.length)%group.tabs.length;document.getElementById(`panel-tab-${group.tabs[n]}`)?.focus();}else if(e.key==='Escape'){if(menu.current)menu.current.open=false;controller()?.cancel();e.stopPropagation();}}}>{PANEL_LABELS[p]}</button>)}
    </div><div className="panel-group-body">{group.tabs.map(p=>p===expanded?<div key={p} className="panel-expanded-placeholder" hidden={p!==group.active}><span>当前面板已在展开窗中显示</span><button onClick={()=>window.dispatchEvent(new CustomEvent('comia:expand-panel',{detail:null}))}>收回面板</button></div>:<PanelHostSlot key={p} host={hosts[p]} id={p} active={p===group.active} />)}</div></>}
    {float&&!group.collapsed && (['e','s','se'] as const).map(edge=><button key={edge} className={`panel-resize panel-resize-${edge}`} aria-label={`调整${PANEL_LABELS[group.active]}面板${edge==='e'?'宽度':edge==='s'?'高度':'大小'}`} onPointerDown={e=>controller()?.begin(e.nativeEvent,e.currentTarget,{kind:'float-size',id:group.id,edge})} onKeyDown={e=>{
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)||e.nativeEvent.isComposing)return;e.preventDefault();e.stopPropagation();const step=e.shiftKey?1:10;action(l=>updateLayout(l,d=>{const f=d.floating.find(f=>f.groupId===group.id);if(f){f.rect.width=Math.max(224,f.rect.width+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0));f.rect.height=Math.max(160,f.rect.height+(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0));}}));
    }} />)}
  </section>;
}
