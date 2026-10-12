import {fail,ok,problem,type Id,type Point,type Project,type Result,type Viewport} from '../domain/types';
import {polyBounds} from '../geometry/polygon';
import {areaCombination,buildAreaCandidates,type AreaCandidate,type AreaSelectionOptions,type AreaShape,type AreaTool} from './regionSelection';
export interface AreaSelectionGesture {pointerId:number;project:Project;epoch:number;pageId:Id;scopeId:Id|null;viewport:Viewport;options:AreaSelectionOptions;baseSelection:Id[];baseAnchor:Id|null;candidates:AreaCandidate[];shape:AreaShape;distancePx:number}
export function beginAreaSelection(project:Project,epoch:number,pageId:Id,scopeId:Id|null,viewport:Viewport,options:AreaSelectionOptions,baseSelection:Id[],baseAnchor:Id|null,kind:AreaTool,pointerId:number,point:Point,shift=false,alt=false):Result<AreaSelectionGesture>{
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y))return fail(problem('selection/point','选区坐标无效'));
  const candidates=buildAreaCandidates(project,pageId,scopeId,viewport,options.target);if(!candidates.ok)return candidates;
  return ok({pointerId,project,epoch,pageId,scopeId,viewport:structuredClone(viewport),options:{...options,combination:areaCombination(options,shift,alt)},baseSelection:[...baseSelection],baseAnchor,candidates:candidates.value,shape:{kind,points:[point,...(kind==='marquee'?[point]:[])]},distancePx:0});
}
export function appendAreaPoint(g:AreaSelectionGesture,p:Point,final=false):Result<void>{
  if(!Number.isFinite(p.x)||!Number.isFinite(p.y))return fail(problem('selection/point','选区坐标无效'));const points=g.shape.points;
  g.distancePx=Math.max(g.distancePx,Math.hypot(p.x-points[0].x,p.y-points[0].y));
  if(g.shape.kind==='marquee'){points[1]=p;return ok(undefined);}
  const last=points.at(-1)!;if(Math.hypot(p.x-last.x,p.y-last.y)>=(final?1e-6:1.5)){if(points.length>=4096)return fail(problem('selection/budget','套索超过4096点，请缩短笔划后重试'));points.push(p);}return ok(undefined);
}
export function validAreaShape(g:AreaSelectionGesture):boolean{if(g.shape.kind==='marquee'){const b=polyBounds(g.shape.points);return g.distancePx>3&&b.width>1e-6&&b.height>1e-6;}const p=g.shape.points,b=polyBounds(p);if(p.length<3||b.width<=3||b.height<=3)return false;const a=p[0],v=p.find(q=>Math.hypot(q.x-a.x,q.y-a.y)>1e-6);return!!v&&p.some(q=>Math.abs((v.x-a.x)*(q.y-a.y)-(v.y-a.y)*(q.x-a.x))>1e-6);}
