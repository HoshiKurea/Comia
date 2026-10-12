import clipping from 'polygon-clipping';
import type { DialogueLink, Id, Point, Project, Rect, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import type { ShapePath } from '../geometry/types';
import { regionContains, type Region } from '../geometry/pathRegion';
import { checkedUnion, pathToRegion, regionBounds, transformRegion, regionEdges } from '../geometry/renderRegion';
import { LOCAL_TARGET, type GeometryTarget, flattenForBoolean } from '../geometry/flattenForBoolean';
import { apply, multiply } from '../geometry/matrix';
import { unionBounds } from '../geometry/bounds';
import { MANGA } from '../domain/limits';
import { composeBubble, type MangaBubbleGeometry } from './composeBubble';
import {buildBubbleStrokeBands,hasStrokeBands} from './strokeBands';
import { buildPressureRibbon } from './strokeRibbon';
import { mainBubbleText } from './ownership';
import { partitionOverlap, type OwnedFill } from './overlapFill';
import { segmentsIntersect } from '../geometry/polygon';

export interface PreparedDialogue {
  groupId:Id;memberIds:Id[];bodyRegions:ReadonlyMap<Id,Region>;bridgePaths:ShapePath[];
  fusionRegion:Region|null;overlapRegion:Region;ownedFills:OwnedFill[];
  border:Region;inner?:Region;outer?:Region;lines:Region;bounds:Rect;textIds:Id[];
}
const add=(a:Point,b:Point,k=1):Point=>({x:a.x+k*b.x,y:a.y+k*b.y});
const unit=(v:Point):Point=>{const n=Math.hypot(v.x,v.y)||1;return{x:v.x/n,y:v.y/n};};
/** Outermost positive ray crossing on the actual outer boundary. */
function ray(region:Region,center:Point,direction:Point):Point{
  let best=0;const d=unit(direction);
  for(const poly of region)for(const ring of poly)for(let i=0;i+1<ring.length;i++){
    const a=ring[i],b=ring[i+1],e={x:b[0]-a[0],y:b[1]-a[1]},den=d.x*e.y-d.y*e.x;if(Math.abs(den)<1e-12)continue;
    const q={x:a[0]-center.x,y:a[1]-center.y},t=(q.x*e.y-q.y*e.x)/den,s=(q.x*d.y-q.y*d.x)/den;if(t>=0&&s>=0&&s<=1)best=Math.max(best,t);
  }return add(center,d,best);
}
function linkPath(a:Region,b:Region,ca:Point,cb:Point,link:DialogueLink):ShapePath{
  const A=ray(a,ca,{x:cb.x-ca.x,y:cb.y-ca.y}),B=ray(b,cb,{x:ca.x-cb.x,y:ca.y-cb.y}),d={x:B.x-A.x,y:B.y-A.y},n=unit({x:-d.y,y:d.x}),offset=link.bend*Math.hypot(d.x,d.y)*.25;
  return {ops:Math.hypot(d.x,d.y)<1e-8?[]:[{op:'M',p:A},{op:'C',c1:add(add(A,d,1/3),n,offset),c2:add(add(A,d,2/3),n,offset),p:B}],bounds:unionBounds([regionBounds(a),regionBounds(b)])!};
}
/** Arc-length neighbours and tangents at a nearest true boundary point. */
function arcSides(region:Region,q:Point,width:number){
  let best=Infinity,selected:Point[]=[];let index=0,t=0;
  for(const poly of region){const points=poly[0].slice(0,-1).map(([x,y])=>({x,y}));for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,u=Math.max(0,Math.min(1,((q.x-a.x)*dx+(q.y-a.y)*dy)/(dx*dx+dy*dy))),distance=Math.hypot(q.x-a.x-u*dx,q.y-a.y-u*dy);if(distance<best){best=distance;selected=points;index=i;t=u;}}}
  const lengths=selected.map((p,i)=>Math.hypot(p.x-selected[(i+1)%selected.length].x,p.y-selected[(i+1)%selected.length].y)),total=lengths.reduce((s,n)=>s+n,0),origin=lengths.slice(0,index).reduce((s,n)=>s+n,0)+lengths[index]*t;
  const sample=(distance:number)=>{let s=((distance%total)+total)%total;for(let i=0;i<lengths.length;i++){if(s<=lengths[i]){const p=selected[i],v=selected[(i+1)%selected.length],u=s/lengths[i];return{p:{x:p.x+(v.x-p.x)*u,y:p.y+(v.y-p.y)*u},tangent:unit({x:v.x-p.x,y:v.y-p.y})};}s-=lengths[i];}throw Error('弧长采样失败');};
  return {minus:sample(origin-width/2),plus:sample(origin+width/2)};
}
function bridge(a:Region,b:Region,curve:ShapePath,width:number,target:GeometryTarget):Result<Region>{
  const first=curve.ops[0],last=curve.ops[1];if(first?.op!=='M'||last?.op!=='C')return ok([]);
  const A=first.p,B=last.p,d=unit({x:B.x-A.x,y:B.y-A.y}),normal={x:-d.y,y:d.x},length=Math.hypot(B.x-A.x,B.y-A.y),h=Math.min(length/3,width),as=arcSides(a,A,width),bs=arcSides(b,B,width);
  const score=(p:Point,q:Point)=>(p.x-q.x)*normal.x+(p.y-q.y)*normal.y;
  const al=score(as.plus.p,A)>score(as.minus.p,A)?as.plus:as.minus,ar=al===as.plus?as.minus:as.plus,bl=score(bs.plus.p,B)>score(bs.minus.p,B)?bs.plus:bs.minus,br=bl===bs.plus?bs.minus:bs.plus;
  // Choose the tangent AWAY from the opening centre on each side. A tangent
  // perpendicular to A→B has no meaningful dot-product sign with that axis;
  // reusing that sign for both sides bends both edges in the same direction.
  const outward=(end:{p:Point;tangent:Point},center:Point)=>add({x:0,y:0},end.tangent,end.tangent.x*(end.p.x-center.x)+end.tangent.y*(end.p.y-center.y)>=0?1:-1);
  const bend={x:last.c1.x-A.x-(B.x-A.x)/3,y:last.c1.y-A.y-(B.y-A.y)/3};
  const path:ShapePath={ops:[{op:'M',p:al.p},{op:'C',c1:add(add(al.p,outward(al,A),h),bend),c2:add(add(bl.p,outward(bl,B),h),bend),p:bl.p},{op:'L',p:add(B,d,2)},{op:'L',p:br.p},{op:'C',c1:add(add(br.p,outward(br,B),h),bend),c2:add(add(ar.p,outward(ar,A),h),bend),p:ar.p},{op:'L',p:add(A,d,-2)},{op:'Z'}],bounds:curve.bounds};
  const fine={...target,tolerancePx:target.tolerancePx/4},flat=flattenForBoolean(path,fine,MANGA.booleanEdgesPerGroup);if(!flat.ok)return flat;
  if(!simpleRings(flat.value))return fail(problem('dialogue/bridge-crossing','连接桥发生自交，请减小宽度或弯曲'));
  return pathToRegion(path,fine,MANGA.booleanEdgesPerGroup);
}
/** Sweep bounding intervals first; also reject intersections between hole rings. */
function simpleRings(rings:Point[][]):boolean{
  const edges=rings.flatMap((points,ring)=>points.map((a,i)=>{const b=points[(i+1)%points.length];return{a,b,ring,i,n:points.length,minX:Math.min(a.x,b.x),maxX:Math.max(a.x,b.x),minY:Math.min(a.y,b.y),maxY:Math.max(a.y,b.y)};})).sort((a,b)=>a.minX-b.minX);
  let active:typeof edges=[];
  for(const e of edges){active=active.filter(v=>v.maxX>=e.minX-1e-9);for(const v of active){if(e.minY>v.maxY+1e-9||v.minY>e.maxY+1e-9||e.ring===v.ring&&(Math.abs(e.i-v.i)===1||Math.abs(e.i-v.i)===e.n-1))continue;if(segmentsIntersect(e.a,e.b,v.a,v.b,1e-9))return false;}active.push(e);}
  return true;
}
/** Smooth only new boolean intersection vertices; preserve authored sharp corners. */
export function smoothFusion(region:Region,sources:readonly Region[],radius:number,target:GeometryTarget):Result<ShapePath>{
  const original=sources.flatMap(r=>r.flatMap(p=>p.flatMap(ring=>ring.slice(0,-1)))),nearOriginal=(q:Point)=>original.some(([x,y])=>Math.hypot(q.x-x,q.y-y)<1e-6);
  for(let attempt=0;attempt<9;attempt++){
    const ops:ShapePath['ops']=[];
    for(const polygon of region)for(const ring of polygon){const p=ring.slice(0,-1).map(([x,y])=>({x,y})),cuts=p.map((q,i)=>{const prev=p[(i+p.length-1)%p.length],next=p[(i+1)%p.length],u=unit({x:q.x-prev.x,y:q.y-prev.y}),v=unit({x:next.x-q.x,y:next.y-q.y}),theta=Math.acos(Math.max(-1,Math.min(1,u.x*v.x+u.y*v.y))),d=nearOriginal(q)||!radius?0:Math.min(radius/2**attempt*Math.tan(theta/2),.45*Math.hypot(q.x-prev.x,q.y-prev.y),.45*Math.hypot(q.x-next.x,q.y-next.y));return{q,from:add(q,u,-d),to:add(q,v,d),d};});
      ops.push({op:'M',p:cuts[0].to});for(let k=1;k<=cuts.length;k++){const cut=cuts[k%cuts.length];ops.push({op:'L',p:cut.from});if(cut.d)ops.push({op:'Q',control:cut.q,p:cut.to});}ops.push({op:'Z'});
    }
    const path={ops,bounds:regionBounds(region)},flat=flattenForBoolean(path,{...target,tolerancePx:target.tolerancePx/4},MANGA.booleanEdgesPerGroup);if(!flat.ok)return flat;
    if(simpleRings(flat.value))return ok(path);
  }return fail(problem('dialogue/seam','接缝平滑产生自交，请减小圆滑半径或明确设为0'));
}
const cache=new Map<string,{value:PreparedDialogue;bytes:number}>();let cacheBytes=0;
export function clearDialogueCache():void{cache.clear();cacheBytes=0;}
export function prepareDialogue(project:Project,id:Id,target:GeometryTarget=LOCAL_TARGET,prepared?:ReadonlyMap<Id,MangaBubbleGeometry>):Result<PreparedDialogue>{
  const group=project.layers[id];if(group?.type!=='group'||!group.dialogue)return fail(problem('dialogue/target','目标不是对白组'));
  // Opacity changes paint coefficients, never the partition/boundary geometry.
  const key=JSON.stringify([id,{...group.dialogue,overlapOpacity:undefined},group.children.map(cid=>{const b=project.layers[cid];return b?.type==='bubble'?[cid,b.visible,b.matrix,b.width,b.height,b.style,b.shape,b.tail,b.handDrawn,b.contour,b.children.map(tid=>{const t=project.layers[tid];return t?.type==='bubbleTail'?t:[tid,t?.visible];})]:b;}),target]),entry=cache.get(key);
  if(entry){cache.delete(key);cache.set(key,entry);return ok(entry.value);}
  const result=prepareUncached(project,id,target,prepared);if(result.ok){const g=result.value,bytes=128*([g.border,g.lines,g.overlapRegion,g.fusionRegion??[],...g.bodyRegions.values(),...g.ownedFills.flatMap(p=>[p.exclusive,p.overlap])].reduce((sum,r)=>sum+regionEdges(r),0));if(bytes<=16*1024*1024){cache.set(key,{value:g,bytes});cacheBytes+=bytes;while(cache.size>32||cacheBytes>16*1024*1024){const entry=cache.entries().next().value!;cacheBytes-=entry[1].bytes;cache.delete(entry[0]);}}}return result;
}
function prepareUncached(project:Project,id:Id,target:GeometryTarget,prepared?:ReadonlyMap<Id,MangaBubbleGeometry>):Result<PreparedDialogue>{
  const group=project.layers[id];if(group?.type!=='group'||!group.dialogue)return fail(problem('dialogue/target','目标不是对白组'));
  const spec=group.dialogue,memberIds=group.children.filter(cid=>project.layers[cid]?.visible),regions=new Map<Id,Region>(),bodies=new Map<Id,Region>(),centers=new Map<Id,Point>(),geometries=new Map<Id,MangaBubbleGeometry>();
  for(const cid of memberIds){const layer=project.layers[cid];if(layer.type!=='bubble')return fail(problem('dialogue/member','对白组只能包含气泡'));
    const g=prepared?.get(cid),result=g?ok(g):composeBubble(project,cid,{...target,localToOutput:multiply(target.localToOutput,layer.matrix)});if(!result.ok)return result;
    geometries.set(cid,result.value);regions.set(cid,transformRegion(result.value.fillRegion,layer.matrix));const box=result.value.textBox;centers.set(cid,apply(layer.matrix,{x:box.x+box.width/2,y:box.y+box.height/2}));
    const body=pathToRegion(result.value.body,{localToOutput:multiply(target.localToOutput,layer.matrix),tolerancePx:target.tolerancePx/4});if(!body.ok)return body;bodies.set(cid,transformRegion(body.value,layer.matrix));
  }
  const bridgePaths:ShapePath[]=[],bridges:Region[]=[],lineRegions:Region[]=[];
  for(const link of spec.links){const a=bodies.get(link.from),b=bodies.get(link.to);if(!a||!b)continue;const path=linkPath(a,b,centers.get(link.from)!,centers.get(link.to)!,link);bridgePaths.push(path);
    if(spec.mode==='connector'){const ribbon=buildPressureRibbon(path,spec.fusionStyle.borderWidth,0,spec.seed,target);if(!ribbon.ok)return ribbon;try{lineRegions.push(clipping.difference(ribbon.value,regions.get(link.from)!,regions.get(link.to)!));}catch(e){return fail(problem('dialogue/line',(e as Error).message));}}
    if(spec.mode==='fused'&&!clipping.intersection(a,b).length){const ra=regionBounds(a),rb=regionBounds(b),distance=Math.hypot(centers.get(link.to)!.x-centers.get(link.from)!.x,centers.get(link.to)!.y-centers.get(link.from)!.y);if(distance>4*Math.max(Math.hypot(ra.width,ra.height),Math.hypot(rb.width,rb.height)))return fail(problem('dialogue/bridge-length','融合成员距离过远，请缩短距离或改用连接模式'));const joined=bridge(a,b,path,link.width,target);if(!joined.ok)return joined;const u=checkedUnion([a,b,joined.value],MANGA.booleanEdgesPerGroup);if(!u.ok)return u;if(!u.value.some(poly=>regionContains([poly],centers.get(link.from)!)&&regionContains([poly],centers.get(link.to)!)))return fail(problem('dialogue/bridge-disconnected','连接桥未能连接主体，请调整宽度或弯曲'));bridges.push(joined.value);}
  }
  let inner:Region=[],outer:Region=[];let fusionRegion:Region|null=null,border:Region=[],overlapRegion:Region=[],ownedFills:OwnedFill[]=[];
  if(spec.mode==='fused'&&memberIds.length){const sources=[...regions.values(),...bridges],u=checkedUnion(sources,MANGA.booleanEdgesPerGroup);if(!u.ok)return u;const smooth=smoothFusion(u.value,sources,spec.seamRadius,target);if(!smooth.ok)return smooth;const r=pathToRegion(smooth.value,{...target,tolerancePx:target.tolerancePx/4},MANGA.booleanEdgesPerGroup);if(!r.ok)return r;fusionRegion=r.value;if(hasStrokeBands(spec.fusionStyle)){const bands=buildBubbleStrokeBands(fusionRegion,spec.fusionStyle,spec.fusionPressure,spec.seed,target,MANGA.booleanEdgesPerGroup);if(!bands.ok)return bands;border=bands.value.center;inner=bands.value.inner;outer=bands.value.outer;}else{const ribbon=buildPressureRibbon(smooth.value,spec.fusionStyle.borderWidth,spec.fusionPressure,spec.seed,target,MANGA.booleanEdgesPerGroup);if(!ribbon.ok)return ribbon;border=ribbon.value;}}
  if(spec.mode==='overlap'){const partition=partitionOverlap(memberIds.map(cid=>({id:cid,region:regions.get(cid)!})));if(!partition.ok)return partition;overlapRegion=partition.value.overlap;ownedFills=partition.value.parts;}
  if(spec.mode==='fused')for(const cid of memberIds){const layer=project.layers[cid];if(layer.type!=='bubble')continue;const g=geometries.get(cid)!;const lines=g.tailLine?[g.tailLine]:g.tails.flatMap(t=>t.linePaths);for(const path of lines){const ribbon=buildPressureRibbon(path,spec.fusionStyle.borderWidth,spec.fusionPressure,spec.seed,{...target,localToOutput:multiply(target.localToOutput,layer.matrix)});if(!ribbon.ok)return ribbon;lineRegions.push(transformRegion(ribbon.value,layer.matrix));}}
  const lines=checkedUnion(lineRegions,MANGA.booleanEdgesPerGroup);if(!lines.ok)return lines;
  return ok({groupId:id,memberIds,bodyRegions:regions,bridgePaths,fusionRegion,overlapRegion,ownedFills,border,inner,outer,lines:lines.value,bounds:unionBounds([...regions.values(),...bridges,border,inner,outer,lines.value].filter(r=>r.length).map(regionBounds))??{x:0,y:0,width:0,height:0},textIds:memberIds.flatMap(cid=>{const t=mainBubbleText(project,cid);return t?.visible?[t.id]:[];})});
}
