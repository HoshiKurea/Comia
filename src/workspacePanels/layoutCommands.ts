import { fail, ok, problem, type Result } from '../domain/types';
import { createDefaultPanelLayout, panelGroup, validatePanelLayout } from './layoutModel';
import type { DropTarget, MoveSource, PanelId, PanelLayout } from './types';
const error = (message:string):Result<PanelLayout> => fail(problem('panels/change',message));
function clean(d:PanelLayout) {
  for(const [id,g] of Object.entries(d.groups))if(!g.tabs.length) {
    delete d.groups[id];d.floating=d.floating.filter(f=>f.groupId!==id);
    for(const side of ['left','right'] as const) {const c=d.docks[side],i=c.groups.indexOf(id);if(i>=0){c.groups.splice(i,1);c.weights.splice(i,1);}}
  }
  for(const g of Object.values(d.groups))if(!g.tabs.includes(g.active))g.active=g.tabs[0];
  for(const c of Object.values(d.docks)){const sum=c.weights.reduce((a,b)=>a+b,0);if(sum)c.weights=c.weights.map(w=>w/sum);}
}
function finish(before:PanelLayout,d:PanelLayout):Result<PanelLayout> {
  clean(d);if(JSON.stringify(before)===JSON.stringify(d))return ok(before);
  if(!Number.isSafeInteger(before.revision+1))return error('布局版本超出上限，请恢复默认工作区');
  d.revision=before.revision+1;return validatePanelLayout(d);
}
function nextId(d:PanelLayout){let i=1;while(d.groups[`pg-${i}`])i++;return `pg-${i}`;}
export function movePanels(layout:PanelLayout,source:MoveSource,target:DropTarget,expectedRevision=layout.revision):Result<PanelLayout> {
  const valid=validatePanelLayout(layout);if(!valid.ok)return valid;
  if(expectedRevision!==layout.revision)return error('面板布局已变化，请重新拖动');
  const from=source.kind==='group'?layout.groups[source.groupId]:panelGroup(layout,source.panel);
  if(!from)return error('源面板已关闭');
  if(target.kind!=='float' && (!Number.isInteger(target.index)||target.index<0))return error('无效的面板位置');
  if(target.kind==='merge' && !layout.groups[target.groupId])return error('目标面板组已关闭');
  if(target.kind==='merge' && target.groupId===from.id && source.kind==='group')return ok(layout);
  const d=structuredClone(layout), tabs=source.kind==='group'?[...from.tabs]:[source.panel],src=d.groups[from.id];
  let index=target.kind==='merge'?Math.min(target.index,d.groups[target.groupId].tabs.length):target.kind==='dock'?Math.min(target.index,d.docks[target.side].groups.length):0;
  if(target.kind==='merge' && target.groupId===from.id && source.kind==='tab' && src.tabs.indexOf(source.panel)<index)index--;
  if(target.kind==='dock' && source.kind==='group') {const old=d.docks[target.side].groups.indexOf(from.id);if(old>=0 && old<index)index--;}
  const oldActive=src.active,oldIndex=src.tabs.indexOf(oldActive);src.tabs=src.tabs.filter(p=>!tabs.includes(p));
  if(!src.tabs.includes(src.active))src.active=src.tabs[Math.min(oldIndex,src.tabs.length-1)] ?? tabs[0];
  if(target.kind==='merge') {
    const to=d.groups[target.groupId];to.tabs.splice(index,0,...tabs);to.active=source.kind==='group'?oldActive:tabs[0];to.collapsed=false;
  } else {
    clean(d);const id=source.kind==='group'?from.id:nextId(d);
    d.groups[id]={id,tabs,active:source.kind==='group'?oldActive:tabs[0],collapsed:false};
    if(target.kind==='float')d.floating.push({groupId:id,rect:{...target.rect}});
    else {const c=d.docks[target.side];c.groups.splice(index,0,id);c.weights.splice(index,0,1/Math.max(1,c.groups.length));}
  }
  return finish(layout,d);
}
export function setActivePanel(layout:PanelLayout,panel:PanelId):Result<PanelLayout> {
  const g=panelGroup(layout,panel);if(!g)return error('面板未显示');const d=structuredClone(layout);d.groups[g.id].active=panel;d.groups[g.id].collapsed=false;return finish(layout,d);
}
export function closePanel(layout:PanelLayout,panel:PanelId):Result<PanelLayout> {
  const g=panelGroup(layout,panel);if(!g)return ok(layout);const d=structuredClone(layout),to=d.groups[g.id],i=to.tabs.indexOf(panel);
  to.tabs.splice(i,1);if(to.active===panel)to.active=to.tabs[i] ?? to.tabs[i-1] ?? panel;d.hidden.push(panel);return finish(layout,d);
}
export function showPanel(layout:PanelLayout,panel:PanelId):Result<PanelLayout> {
  if(panelGroup(layout,panel))return setActivePanel(layout,panel);
  if(!layout.hidden.includes(panel))return error('未知面板');
  const d=structuredClone(layout),side=['components','assets','pages'].includes(panel)?'left':'right';d.hidden=d.hidden.filter(p=>p!==panel);
  const id=d.docks[side].groups.at(-1) ?? nextId(d);
  if(!d.groups[id]){d.groups[id]={id,tabs:[],active:panel,collapsed:false};d.docks[side].groups.push(id);d.docks[side].weights.push(1);}
  d.groups[id].tabs.push(panel);d.groups[id].active=panel;d.groups[id].collapsed=false;return finish(layout,d);
}
export function setCollapsed(layout:PanelLayout,id:string,collapsed:boolean):Result<PanelLayout> {
  if(!layout.groups[id])return error('面板组已关闭');const d=structuredClone(layout);d.groups[id].collapsed=collapsed;return finish(layout,d);
}
export function resetLayout(layout:PanelLayout):Result<PanelLayout> {const d=createDefaultPanelLayout();if(layout.revision>=Number.MAX_SAFE_INTEGER)return ok(d);d.revision=layout.revision;return finish(layout,d);}
export function updateLayout(layout:PanelLayout,mutate:(draft:PanelLayout)=>void):Result<PanelLayout>{const d=structuredClone(layout);mutate(d);return finish(layout,d);}
