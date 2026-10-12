import type { Point,Rect } from '../domain/types';
import { panelLayoutStore,publishLayout } from './panelLayoutStore';
import { movePanels,updateLayout } from './layoutCommands';
import { contains,fitFloatingRect,clamp } from './layoutGeometry';
import { panelChangeAllowed,protectPanelDraft } from './panelInteraction';
import { panelGroup,groupSide } from './layoutModel';
import { PANEL_LABELS,type DropTarget,type MoveSource,type PanelLayout,type DockSide } from './types';
type Operation = {kind:'move';source:MoveSource}|{kind:'float-size';id:string;edge:'e'|'s'|'se'}|{kind:'column';side:DockSide}|{kind:'split';side:DockSide;index:number};
/** DOM-only drafts: no canvas/store/React updates until release. */
export class PanelDragController {
  private cancelCurrent:(()=>void)|null=null;
  constructor(private root:HTMLElement,private narrow:()=>boolean){}
  cancel(){this.cancelCurrent?.();}
  begin(event:PointerEvent,handle:HTMLElement,op:Operation) {
    if(event.button!==0 || (event.pointerType==='touch'&&!event.isPrimary) || this.narrow() || !panelChangeAllowed())return;
    this.cancel();event.preventDefault();
    const base=panelLayoutStore.getState().layout,bounds=this.root.getBoundingClientRect(),windowSize={width:window.innerWidth,height:window.innerHeight};
    const id=op.kind==='move'?(op.source.kind==='group'?op.source.groupId:panelGroup(base,op.source.panel)?.id):op.kind==='float-size'?op.id:null;
    const node=id?this.root.querySelector<HTMLElement>(`[data-panel-group="${id}"]`):null;
    if((op.kind==='move'||op.kind==='float-size') && !node)return;
    const measured=node?.getBoundingClientRect(),origin:Rect=measured?{x:measured.x-bounds.x,y:measured.y-bounds.y,width:measured.width,height:measured.height}:{x:event.clientX-bounds.x,y:event.clientY-bounds.y,width:4,height:bounds.height};
    const ghost=document.createElement('div'),preview=document.createElement('div');ghost.className='panel-drag-ghost';ghost.dataset.testid='panel-drag-ghost';preview.className='panel-drop-preview';preview.dataset.testid='panel-drop-preview';
    ghost.setAttribute('aria-hidden','true');preview.setAttribute('aria-hidden','true');ghost.hidden=preview.hidden=true;
    if(op.kind==='move' && id)ghost.textContent=base.groups[id].tabs.filter(p=>op.source.kind==='group'||p===op.source.panel).map(p=>PANEL_LABELS[p]).join(' / ');
    this.root.append(ghost,preview);
    let latest:Point={x:event.clientX,y:event.clientY},moved=false,frame=0,target:DropTarget|null=null,draft=origin,done=false;
    const paintBox=(n:HTMLElement,r:Rect)=>{n.style.transform=`translate(${r.x}px,${r.y}px)`;n.style.width=`${r.width}px`;n.style.height=`${r.height}px`;};
    const paint=()=>{
      frame=0;if(!moved)return;const dx=latest.x-event.clientX,dy=latest.y-event.clientY;
      if(op.kind==='move') {
        draft=fitFloatingRect({...origin,x:origin.x+dx,y:origin.y+dy},{width:bounds.width,height:bounds.height});ghost.hidden=false;paintBox(ghost,draft);
        const hit=this.targetAt(latest,base,op.source);target=hit.target.kind==='float'?{kind:'float',rect:draft}:hit.target;preview.hidden=target.kind==='float';if(hit.rect)paintBox(preview,hit.rect);preview.dataset.kind=target.kind;
      }else if(op.kind==='float-size' && node){
        draft=fitFloatingRect({...origin,width:origin.width+(op.edge!=='s'?dx:0),height:origin.height+(op.edge!=='e'?dy:0)},bounds);
        node.style.width=`${draft.width}px`;node.style.height=`${draft.height}px`;
      }else if(op.kind==='column'){
        ghost.hidden=false;ghost.classList.add('separator-draft');paintBox(ghost,{x:latest.x-bounds.x,y:0,width:4,height:bounds.height});
      }else if(op.kind==='split'){
        const col=this.root.querySelector<HTMLElement>(`.${op.side}-panel`)?.getBoundingClientRect();if(col){ghost.hidden=false;ghost.classList.add('separator-draft');paintBox(ghost,{x:col.x-bounds.x,y:latest.y-bounds.y,width:col.width,height:4});}
      }
      this.root.dispatchEvent(new CustomEvent('comia:panel-preview'));
    };
    const cleanup=()=>{
      if(done)return;done=true;if(frame)cancelAnimationFrame(frame);ghost.remove();preview.remove();
      if(op.kind==='float-size' && node){node.style.width=`${origin.width}px`;node.style.height=`${origin.height}px`;}
      window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',cancel,true);window.removeEventListener('pointerdown',second,true);window.removeEventListener('keydown',key,true);window.removeEventListener('blur',cancel);window.removeEventListener('resize',cancel);handle.removeEventListener('lostpointercapture',cancel);off();observer.disconnect();this.cancelCurrent=null;
      if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);
    };
    const cancel=()=>cleanup();
    const move=(e:PointerEvent)=>{if(e.pointerId!==event.pointerId)return;latest={x:e.clientX,y:e.clientY};moved ||= Math.hypot(latest.x-event.clientX,latest.y-event.clientY)>=4;if(moved && !frame)frame=requestAnimationFrame(paint);};
    const up=(e:PointerEvent)=>{
      if(e.pointerId!==event.pointerId)return;
      const now=this.root.getBoundingClientRect();if(now.width!==bounds.width||now.height!==bounds.height||window.innerWidth!==windowSize.width||window.innerHeight!==windowSize.height){cleanup();return;}
      latest={x:e.clientX,y:e.clientY};moved ||= Math.hypot(latest.x-event.clientX,latest.y-event.clientY)>=4;
      if(frame)cancelAnimationFrame(frame);if(moved)paint();cleanup();if(!moved||!panelChangeAllowed())return;
      const current=panelLayoutStore.getState().layout;if(current.revision!==base.revision)return;
      const dx=latest.x-event.clientX,dy=latest.y-event.clientY;
      protectPanelDraft(()=>{
        if(op.kind==='move' && target)publishLayout(movePanels(current,op.source,target,base.revision));
        else if(op.kind==='float-size')publishLayout(updateLayout(current,d=>{const f=d.floating.find(f=>f.groupId===op.id);if(f)f.rect=draft;}));
        else if(op.kind==='column')publishLayout(updateLayout(current,d=>{d.docks[op.side].width=clamp(base.docks[op.side].width+dx*(op.side==='left'?1:-1),192,480);}));
        else if(op.kind==='split'){
          const groups=base.docks[op.side].groups,a=this.root.querySelector<HTMLElement>(`[data-panel-group="${groups[op.index]}"]`),b=this.root.querySelector<HTMLElement>(`[data-panel-group="${groups[op.index+1]}"]`);
          if(!a||!b||base.groups[groups[op.index]].collapsed||base.groups[groups[op.index+1]].collapsed)return;
          const ah=a.offsetHeight,bh=b.offsetHeight,total=ah+bh;if(total<192)return;const h=clamp(ah+dy,96,total-96),weights=base.docks[op.side].weights,pair=weights[op.index]+weights[op.index+1];
          publishLayout(updateLayout(current,d=>{d.docks[op.side].weights[op.index]=pair*h/total;d.docks[op.side].weights[op.index+1]=pair*(total-h)/total;}));
        }
      });
    };
    const second=(e:PointerEvent)=>{if(e.pointerId!==event.pointerId)cancel();};
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!e.isComposing){e.preventDefault();e.stopPropagation();cancel();}};
    const off=panelLayoutStore.subscribe(s=>{if(s.layout.revision!==base.revision)cancel();});
    const observer=new ResizeObserver(()=>{const now=this.root.getBoundingClientRect();if(now.width!==bounds.width||now.height!==bounds.height)cancel();});observer.observe(this.root);
    this.cancelCurrent=cancel;window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',cancel,true);window.addEventListener('pointerdown',second,true);window.addEventListener('keydown',key,true);window.addEventListener('blur',cancel);window.addEventListener('resize',cancel);handle.addEventListener('lostpointercapture',cancel);handle.setPointerCapture(event.pointerId);
  }
  private targetAt(client:Point,layout:PanelLayout,source:MoveSource):{target:DropTarget;rect?:Rect} {
    const root=this.root.getBoundingClientRect(),p={x:client.x-root.x,y:client.y-root.y};
    const local=(node:Element):Rect=>{const r=node.getBoundingClientRect();return{x:r.x-root.x,y:r.y-root.y,width:r.width,height:r.height};};
    const sourceId=source.kind==='group'?source.groupId:panelGroup(layout,source.panel)?.id;
    const expand=this.root.querySelector('.panel-expand-window'),occluded=expand&&contains(local(expand),p);
    const ordered=occluded?[]:[...layout.floating.map(f=>f.groupId).reverse(),...layout.docks.left.groups,...layout.docks.right.groups];
    for(const id of ordered){
      if(source.kind==='group'&&id===sourceId)continue;const node=this.root.querySelector<HTMLElement>(`[data-panel-group="${id}"]`);if(!node||!node.getClientRects().length)continue;
      const r=local(node);if(!contains(r,p))continue;
      const bar=node.querySelector('.panel-tabs');if(bar&&contains(local(bar),p)){
        const tabs=[...bar.querySelectorAll<HTMLElement>('[role=tab]')],i=tabs.findIndex(t=>{const b=local(t);return p.x<b.x+b.width/2;}),index=i<0?tabs.length:i,b=i<0?local(tabs.at(-1)!):local(tabs[i]);
        return{target:{kind:'merge',groupId:id,index},rect:{x:i<0?b.x+b.width:b.x,y:local(bar).y,width:4,height:local(bar).height}};
      }
      const side=groupSide(layout,id),index=side?layout.docks[side].groups.indexOf(id):0;
      if(side && (p.y-r.y<20 || r.y+r.height-p.y<20)){const below=r.y+r.height-p.y<20;return{target:{kind:'dock',side,index:index+Number(below)},rect:{x:r.x,y:below?r.y+r.height-40:r.y,width:r.width,height:40}};}
      // The topmost floating content occludes all groups below it.
      if(!side)break;
    }
    const side=occluded?null:p.x<=28?'left':p.x>=root.width-28?'right':null;
    if(side)return{target:{kind:'dock',side,index:layout.docks[side].groups.length},rect:{x:side==='left'?0:root.width-layout.docks[side].width,y:0,width:layout.docks[side].width,height:root.height}};
    const node=sourceId?this.root.querySelector<HTMLElement>(`[data-panel-group="${sourceId}"]`):null,r=node?local(node):{x:p.x,y:p.y,width:300,height:400};
    return{target:{kind:'float',rect:fitFloatingRect({...r,x:p.x-24,y:p.y-16},root)}};
  }
}
