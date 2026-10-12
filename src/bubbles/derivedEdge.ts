import {fail,ok,problem,type BubbleEdgeStyle,type Point,type Result} from '../domain/types';
import type {ShapePath} from '../geometry/types';
import {flattenForRender,maxSingularValue,type GeometryTarget} from '../geometry/flattenForBoolean';
import {polyBounds,segmentsIntersect} from '../geometry/polygon';
import {MANGA} from '../domain/limits';
import {mulberry32} from './handDrawn';
/** Closed arc-length normal offset. Author control points are never mutated. */
export function deriveBubbleEdge(base:ShapePath,width:number,height:number,edge:BubbleEdgeStyle,target:GeometryTarget):Result<ShapePath>{
 if(!edge.wobble)return ok(base);const flat=flattenForRender(base,{...target,tolerancePx:target.tolerancePx/8});if(!flat.ok)return flat;
 if(flat.value.length!==1||!flat.value[0].closed)return fail(problem('bubble/edge-base','抖动需要单个闭合主体'));
 const p=flat.value[0].points,lengths=p.map((a,i)=>Math.hypot(a.x-p[(i+1)%p.length].x,a.y-p[(i+1)%p.length].y)),L=lengths.reduce((a,b)=>a+b,0);if(!L||lengths.some(n=>n<1e-12))return fail(problem('bubble/edge-length','抖动基础含零边'));
 const A=edge.wobble*Math.min(width,height),m=Math.max(3,Math.round(L/Math.max(8,.08*Math.min(width,height)))),k=2*Math.PI*m/L,random=mulberry32(edge.seed),phi1=random()*Math.PI*2,phi2=random()*Math.PI*2,scale=maxSingularValue(target.localToOutput);
 let area=0;for(let i=0;i<p.length;i++)area+=p[i].x*p[(i+1)%p.length].y-p[(i+1)%p.length].x*p[i].y;
 const outward=Math.sign(area),units=p.map((a,i)=>{const b=p[(i+1)%p.length];return{x:outward*(b.y-a.y)/lengths[i],y:-outward*(b.x-a.x)/lengths[i]};}),normals=p.map((_,i)=>{const a=units[(i+p.length-1)%p.length],b=units[i],len=Math.hypot(a.x+b.x,a.y+b.y);return len<1e-8?b:{x:(a.x+b.x)/len,y:(a.y+b.y)/len};});
 const out:Point[]=[];let arc=0;
 for(let i=0;i<p.length;i++){
  const a=p[i],b=p[(i+1)%p.length],n0=normals[i],n1=normals[(i+1)%p.length],dot=Math.max(-1,Math.min(1,n0.x*n1.x+n0.y*n1.y)),minLength=Math.sqrt((1+dot)/2);if(minLength<.1)return fail(problem('bubble/edge-corner','角度过尖，无法可靠计算抖动法向'));
  const v=Math.hypot(n1.x-n0.x,n1.y-n0.y)/lengths[i],dn=2*v/minLength,ddn=6*v*v/(minLength*minLength),second=A*(2.2*k*k+2*1.4*k*dn+ddn),step=second?Math.sqrt(8*(target.tolerancePx/(8*scale))/second):lengths[i],count=Math.max(1,Math.ceil(lengths[i]/step));
  if(out.length+count>MANGA.booleanEdgesPerMember)return fail(problem('bubble/edge-budget','边缘抖动超出精度预算，请减小抖动或尺寸；未降低输出精度'));
  for(let j=0;j<count;j++){const t=j/count,s=arc+t*lengths[i],x=n0.x+(n1.x-n0.x)*t,y=n0.y+(n1.y-n0.y)*t,len=Math.hypot(x,y),offset=A*(.6*Math.sin(k*s+phi1)+.4*Math.sin(2*k*s+phi2));out.push({x:a.x+(b.x-a.x)*t+offset*x/len,y:a.y+(b.y-a.y)*t+offset*y/len});}arc+=lengths[i];
 }
 // Sweep checks the actual derived polygon, including the closed seam.
 const edges=out.map((a,i)=>{const b=out[(i+1)%out.length];return{a,b,i,minX:Math.min(a.x,b.x),maxX:Math.max(a.x,b.x),minY:Math.min(a.y,b.y),maxY:Math.max(a.y,b.y)};}).sort((a,b)=>a.minX-b.minX||a.i-b.i);let active:typeof edges=[],derivedArea=0;
 for(const e of edges){derivedArea+=e.a.x*e.b.y-e.b.x*e.a.y;active=active.filter(q=>q.maxX>=e.minX-1e-9);for(const q of active){if(Math.abs(e.i-q.i)===1||Math.abs(e.i-q.i)===out.length-1||q.maxY<e.minY||e.maxY<q.minY)continue;if(segmentsIntersect(e.a,e.b,q.a,q.b,1e-9))return fail(problem('bubble/edge-self-intersection','当前抖动导致边缘自交，请减小抖动或修正基础节点'));}active.push(e);}
 if(Math.abs(derivedArea)/2<4)return fail(problem('bubble/edge-area','抖动后的主体面积过小'));
 const ops:ShapePath['ops']=out.map((p,i)=>({op:i?'L':'M',p}));ops.push({op:'Z'});return ok({ops,bounds:polyBounds(out)});
}
