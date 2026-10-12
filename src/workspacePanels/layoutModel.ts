import { fail, ok, problem, type Result } from '../domain/types';
import { PANEL_IDS, type PanelId, type PanelLayout } from './types';
export function createDefaultPanelLayout():PanelLayout {
  return {version:2,revision:0,groups:{
    'pg-left':{id:'pg-left',tabs:['components','assets','pages'],active:'components',collapsed:false},
    'pg-hints':{id:'pg-hints',tabs:['hints'],active:'hints',collapsed:false},
    'pg-upper':{id:'pg-upper',tabs:['inspector'],active:'inspector',collapsed:false},
    'pg-lower':{id:'pg-lower',tabs:['layers','history'],active:'layers',collapsed:false},
  },docks:{left:{width:240,groups:['pg-left'],weights:[1]},right:{width:320,groups:['pg-hints','pg-upper','pg-lower'],weights:[.22,.3666,.4134]}},floating:[],hidden:[]};
}
const object = (v:unknown):v is Record<string,unknown> => !!v && typeof v==='object' && !Array.isArray(v);
const finite = (v:unknown,lo:number,hi:number):v is number => typeof v==='number' && Number.isFinite(v) && v>=lo && v<=hi;
function validateStructure(value:unknown,version:1|2,ids:readonly string[]):Result<PanelLayout> {
  const invalid = ():Result<PanelLayout> => fail(problem('panels/layout','面板布局损坏，已恢复默认工作区'));
  if (!object(value) || value.version!==version || !Number.isSafeInteger(value.revision) || !finite(value.revision,0,Number.MAX_SAFE_INTEGER) || !object(value.groups) || !object(value.docks) || !Array.isArray(value.floating) || !Array.isArray(value.hidden)) return invalid();
  const seen = new Set<string>(), owned = new Set<string>(), groups = Object.entries(value.groups);
  if(groups.length>ids.length || value.floating.length>ids.length || value.hidden.length>ids.length)return invalid();
  const take = (id:unknown) => typeof id==='string' && ids.includes(id) && !seen.has(id) && Boolean(seen.add(id));
  for(const [id,g] of groups) {
    if(!/^pg-[a-z0-9-]+$/.test(id) || !object(g) || g.id!==id || !Array.isArray(g.tabs) || !g.tabs.length || g.tabs.length>ids.length || !g.tabs.every(take) || !g.tabs.includes(g.active) || typeof g.collapsed!=='boolean')return invalid();
  }
  if(!value.hidden.every(take) || seen.size!==ids.length)return invalid();
  const own = (id:unknown) => typeof id==='string' && Object.hasOwn(value.groups as object,id) && !owned.has(id) && Boolean(owned.add(id));
  for(const side of ['left','right']) {
    const d=value.docks[side];if(!object(d) || !finite(d.width,192,480) || !Array.isArray(d.groups) || !Array.isArray(d.weights) || d.groups.length!==d.weights.length || !d.groups.every(own) || !d.weights.every(w=>finite(w,Number.MIN_VALUE,1e9)) || !Number.isFinite(d.weights.reduce((s:number,w:number)=>s+w,0)))return invalid();
  }
  for(const f of value.floating) {
    if(!object(f) || !own(f.groupId) || !object(f.rect) || !finite(f.rect.x,-1e7,1e7) || !finite(f.rect.y,-1e7,1e7) || !finite(f.rect.width,1,16384) || !finite(f.rect.height,1,16384))return invalid();
  }
  return owned.size===groups.length ? ok(structuredClone(value) as unknown as PanelLayout) : invalid();
}
export function panelGroup(layout:PanelLayout,panel:PanelId) { return Object.values(layout.groups).find(g=>g.tabs.includes(panel)); }
export function groupSide(layout:PanelLayout,id:string) { return (['left','right'] as const).find(side=>layout.docks[side].groups.includes(id)); }

export function validatePanelLayout(value:unknown):Result<PanelLayout> { return validateStructure(value,2,PANEL_IDS); }
export function migratePanelLayout(value:unknown):Result<PanelLayout> {
  if(object(value)&&value.version===2)return validatePanelLayout(value);
  const old=validateStructure(value,1,PANEL_IDS.filter(id=>id!=='hints'));if(!old.ok)return old;
  const d=old.value;d.version=2;
  let id='pg-hints',suffix=2;while(Object.hasOwn(d.groups,id))id=`pg-hints-${suffix++}`;
  d.groups[id]={id,tabs:['hints'],active:'hints',collapsed:false};
  const right=d.docks.right,sum=right.weights.reduce((a,b)=>a+b,0);
  right.weights=right.groups.length?[.22,...right.weights.map(w=>Math.max(Number.MIN_VALUE,.78*(w/sum)))]:[1];right.groups.unshift(id);
  return validatePanelLayout(d);
}
