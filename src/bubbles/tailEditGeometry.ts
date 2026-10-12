import type { BubbleTailLayer, Id, Point, Project, Result, TailRoute } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { apply, inverse, worldMatrix } from '../geometry/matrix';
import { flattenForRender, LOCAL_TARGET } from '../geometry/flattenForBoolean';
import { mangaBodyPath } from './handDrawn';
import { perimeter } from './geometry';
import { buildTailAppearance, tailAnchors } from './tailGeometry';

function valid(p:Project,id:Id,tail:BubbleTailLayer):boolean{return buildTailAppearance({...p,layers:{...p.layers,[id]:tail}},id).ok;}
export function moveTailTipLayer(p:Project,id:Id,point:Point):Result<BubbleTailLayer>{
  const tail=p.layers[id];if(tail?.type!=='bubbleTail'||!Number.isFinite(point.x)||!Number.isFinite(point.y))return fail(problem('tail/tip-input','尾巴或尖端坐标非法'));
  const owner=tail.parentId?p.layers[tail.parentId]:undefined,anchors=tailAnchors(tail,owner?.type==='bubble'?owner:undefined);if(!anchors.ok)return anchors;
  const base=anchors.value.base,max=owner?.type==='bubble'?4*Math.max(owner.width,owner.height):65536,dx=point.x-base.x,dy=point.y-base.y,length=Math.hypot(dx,dy),bounded=length>max?{x:base.x+dx*max/length,y:base.y+dy*max/length}:point;
  const at=(t:number):BubbleTailLayer=>({...tail,tip:{x:tail.tip.x+(bounded.x-tail.tip.x)*t,y:tail.tip.y+(bounded.y-tail.tip.y)*t}});
  if(!valid(p,id,tail))return fail(problem('tail/prior-invalid','当前尾巴不是合法起点'));
  let last=0;
  for(let step=1;step<=32;step++){
    const t=step/32;if(valid(p,id,at(t))){last=t;continue;}
    let lo=last,hi=t;for(let i=0;i<20;i++){const mid=(lo+hi)/2;if(valid(p,id,at(mid)))lo=mid;else hi=mid;}return ok(at(lo));
  }
  return ok(at(1));
}
export function moveTailAnchor(p:Project,id:Id,point:Point):Result<BubbleTailLayer>{
  const tail=p.layers[id],owner=tail?.parentId?p.layers[tail.parentId]:undefined;
  if(tail?.type!=='bubbleTail'||tail.attachment.mode!=='bubble'||owner?.type!=='bubble'||!Number.isFinite(point.x)||!Number.isFinite(point.y))return fail(problem('tail/anchor','请选择绑定尾巴的底座'));
  const path=mangaBodyPath(owner);if(!path.ok)return path;const flat=flattenForRender(path.value,{...LOCAL_TARGET,tolerancePx:1/64});if(!flat.ok)return flat;
  const points=flat.value[0].points,{positions,total}=perimeter(points);let dist=Infinity,u=tail.attachment.attachU;
  for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy,t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(length||1))),d=(point.x-a.x-dx*t)**2+(point.y-a.y-dy*t)**2;if(d<dist-1e-10){dist=d;u=((positions[i]+t*Math.sqrt(length))/total)%1;}}
  let delta=u-tail.attachment.attachU;if(delta>.5)delta-=1;else if(delta<-.5)delta+=1;
  const at=(t:number):BubbleTailLayer=>({...tail,legacySplice:false,attachment:{mode:'bubble',attachU:((tail.attachment.mode==='bubble'?tail.attachment.attachU:0)+delta*t+1)%1,baseWidth:tail.attachment.mode==='bubble'?tail.attachment.baseWidth:24}});
  if(!valid(p,id,tail))return fail(problem('tail/prior-invalid','当前尾巴不是合法起点'));
  let last=0;for(let step=1;step<=32;step++){const t=step/32;if(valid(p,id,at(t))){last=t;continue;}let lo=last,hi=t;for(let i=0;i<20;i++){const mid=(lo+hi)/2;if(valid(p,id,at(mid)))lo=mid;else hi=mid;}return ok(at(lo));}return ok(at(1));
}
export function setTailDirection(p:Project,id:Id,degrees:number,length:number):Result<BubbleTailLayer>{
  const tail=p.layers[id];if(tail?.type!=='bubbleTail'||!Number.isFinite(degrees)||!Number.isFinite(length)||length<4)return fail(problem('tail/direction','方向须有限，长度至少4px'));
  const owner=tail.parentId?p.layers[tail.parentId]:undefined,anchors=tailAnchors(tail,owner?.type==='bubble'?owner:undefined);if(!anchors.ok)return anchors;
  const world=worldMatrix(p,id),inv=inverse(world);if(!inv.ok)return inv;
  const priorBase=apply(world,anchors.value.base),oldTip=apply(world,tail.tip),theta=degrees*Math.PI/180,oldAngle=Math.atan2(oldTip.y-priorBase.y,oldTip.x-priorBase.x),oldLength=Math.hypot(oldTip.x-priorBase.x,oldTip.y-priorBase.y)||1,rotation=theta-oldAngle,cs=Math.cos(rotation),sn=Math.sin(rotation),ratio=length/oldLength;
  const candidate=structuredClone(tail);let base=priorBase;
  if(owner?.type==='bubble'&&tail.attachment.mode==='bubble'){
    const path=mangaBodyPath(owner);if(!path.ok)return path;const flat=flattenForRender(path.value,{...LOCAL_TARGET,tolerancePx:1/64});if(!flat.ok)return flat;
    const points=flat.value[0].points,{positions,total}=perimeter(points),center=apply(world,{x:owner.width/2,y:owner.height/2}),direction={x:Math.cos(theta),y:Math.sin(theta)};let chosen=-Infinity,u=tail.attachment.attachU;
    for(let i=0;i<points.length;i++){const a=apply(world,points[i]),b=apply(world,points[(i+1)%points.length]),ex=b.x-a.x,ey=b.y-a.y,den=direction.x*ey-direction.y*ex;if(Math.abs(den)<1e-12)continue;const dx=a.x-center.x,dy=a.y-center.y,t=(dx*ey-dy*ex)/den,v=(dx*direction.y-dy*direction.x)/den;if(t>=0&&v>=0&&v<=1&&t>chosen){chosen=t;u=(positions[i]+v*(positions[i+1]-positions[i]))/total;base={x:center.x+direction.x*t,y:center.y+direction.y*t};}}
    if(chosen===-Infinity)return fail(problem('tail/direction-anchor','此方向无法找到主体底座'));
    candidate.attachment={...tail.attachment,attachU:u%1};candidate.legacySplice=false;
  }
  const transform=(point:Point,factor=ratio):Point=>{const old=apply(world,point),dx=old.x-priorBase.x,dy=old.y-priorBase.y;return apply(inv.value,{x:base.x+factor*(cs*dx-sn*dy),y:base.y+factor*(sn*dx+cs*dy)});};
  if(candidate.attachment.mode==='free')candidate.attachment={mode:'free',baseA:transform(candidate.attachment.baseA,1),baseB:transform(candidate.attachment.baseB,1)};
  candidate.tip=apply(inv.value,{x:base.x+Math.cos(theta)*length,y:base.y+Math.sin(theta)*length});
  const route:TailRoute=tail.route.kind==='polyline'?{kind:'polyline',knots:tail.route.knots.map(point=>transform(point))}:tail.route.kind==='spline'?{kind:'spline',c1:transform(tail.route.c1),c2:transform(tail.route.c2)}:{kind:'straight'};candidate.route=route;
  const checked=buildTailAppearance({...p,layers:{...p.layers,[id]:candidate}},id);return checked.ok?ok(candidate):checked;
}
