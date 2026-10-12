import type { Point, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import type { ShapePath } from '../geometry/types';
import { flattenForRender, maxSingularValue, type GeometryTarget, LOCAL_TARGET } from '../geometry/flattenForBoolean';
import { checkedUnion, closedPolygon } from '../geometry/renderRegion';
import type { Region } from '../geometry/pathRegion';
import { mulberry32 } from './handDrawn';
import { MANGA } from '../domain/limits';
import {simplifyRegion} from '../geometry/simplifyRegion';

export function pressureWidth(width:number,pressure:number,seed:number,u:number):number{
  const random=mulberry32(seed),a=random()*2*Math.PI,b=random()*2*Math.PI;
  return width*(1+pressure*(.6*Math.sin(6*Math.PI*u+a)+.4*Math.sin(14*Math.PI*u+b)));
}
/** Union all stroke pieces once, so translucent joins never darken twice. */
export function buildPressureRibbon(path:ShapePath,width:number,pressure:number,seed:number,target:GeometryTarget=LOCAL_TARGET,budget:number=MANGA.booleanEdgesPerMember,widthLimit:256|512=256):Result<Region>{
  if(!Number.isInteger(budget)||budget<1||budget>MANGA.booleanEdgesPerGroup)return fail(problem('geometry/stroke-budget','笔压边预算非法'));
  if(![256,512].includes(widthLimit)||!Number.isFinite(width)||width<0||width>widthLimit||!Number.isFinite(pressure)||pressure<0||pressure>.65||!Number.isInteger(seed)||seed<0||seed>0xffffffff)return fail(problem('bubble/pressure','边宽、笔压或种子非法'));
  if(width===0)return ok([]);
  const precise={...target,tolerancePx:target.tolerancePx/4},flat=flattenForRender(path,precise,budget);if(!flat.ok)return flat;
  const scale=maxSingularValue(target.localToOutput),tolerance=precise.tolerancePx/scale,regions:Region[]=[];let inputEdges=0;
  for(const sub of flat.value){
    const source=sub.points;if(source.length<2)continue;
    const steps=source.length-(sub.closed?0:1),lengths=Array.from({length:steps},(_,i)=>Math.hypot(source[(i+1)%source.length].x-source[i].x,source[(i+1)%source.length].y-source[i].y)),total=lengths.reduce((a,b)=>a+b,0);if(total<1e-10)return fail(problem('bubble/pressure-length','描边路线长度为0'));
    const curvature=width*pressure*(.6*(6*Math.PI)**2+.4*(14*Math.PI)**2)/(total*total),maxStep=pressure?Math.min(total/128,Math.sqrt(8*tolerance/(curvature||1))):Infinity;
    let arc=0;const points:{p:Point;radius:number}[]=[];
    for(let i=0;i<steps;i++){
      const a=source[i],b=source[(i+1)%source.length],count=Math.max(1,Math.ceil(lengths[i]/maxStep));
      for(let j=0;j<count;j++){const t=j/count;points.push({p:{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},radius:pressureWidth(width,pressure,seed,(arc+t*lengths[i])/total)/2});}
      arc+=lengths[i];
    }
    if(!sub.closed)points.push({p:source.at(-1)!,radius:pressureWidth(width,pressure,seed,1)/2});
    if(points.length>budget)return fail(problem('geometry/stroke-budget','笔压采样超过边预算，未降低精度'));
    const segments=points.length-(sub.closed?0:1),strips:(Region|null)[]=[];
    for(let i=0;i<segments;i++){
      const a=points[i],b=points[(i+1)%points.length],dx=b.p.x-a.p.x,dy=b.p.y-a.p.y,len=Math.hypot(dx,dy);if(len<1e-12){strips.push(null);continue;}
      const nx=-dy/len,ny=dx/len;
      strips.push(closedPolygon([{x:a.p.x+nx*a.radius,y:a.p.y+ny*a.radius},{x:b.p.x+nx*b.radius,y:b.p.y+ny*b.radius},{x:b.p.x-nx*b.radius,y:b.p.y-ny*b.radius},{x:a.p.x-nx*a.radius,y:a.p.y-ny*a.radius}]));inputEdges+=4;
    }
    // Each small boolean batch follows one contiguous portion of the stroke.
    // Unioning all strips before all caps retained long, serrated intermediate
    // boundaries. Interleave the SAME strips/caps instead; sampling, budgets,
    // alpha compositing and the output error allocation stay unchanged.
    for(const [index,item] of points.entries()){
      const radius=item.radius*scale,angle=radius>precise.tolerancePx?2*Math.acos(Math.max(-1,Math.min(1,1-precise.tolerancePx/radius))):Math.PI/2,count=Math.max(8,Math.ceil(2*Math.PI/Math.max(angle,1e-8)));
      if((inputEdges+=count)>262144)return fail(problem('geometry/stroke-work-budget','笔压计算超过工作预算，未降低精度'));
      if(strips[index])regions.push(strips[index]!);
      const cap=Array.from({length:count},(_,i)=>({x:item.p.x+item.radius*Math.cos(2*Math.PI*i/count),y:item.p.y+item.radius*Math.sin(2*Math.PI*i/count)}));
      regions.push(closedPolygon(cap));
    }
  }
  // Keep the COMPLETE sampled circles; subtracting strip-covered areas created
  // fragile near-coincident seams. Smaller positive-union batches reduce the
  // simultaneous sweep work without adding new intersection vertices first.
  // Count every merge level against the SAME quarter of the .25px contract.
  let last:Result<Region>=fail(problem('geometry/boolean','描边求交失败'));
  for(const divisor of[65536,16384,4096,1024]){
    const grid=2**Math.floor(Math.log2(target.tolerancePx/(divisor*scale)));
    const error=Math.max(1,Math.ceil(Math.log(Math.max(1,regions.length))/Math.log(8)))*grid*scale*Math.SQRT2/2;
    if(error>target.tolerancePx/4)return fail(problem('geometry/boolean-precision','稳定求交超出分配的输出误差预算'));
    last=checkedUnion(regions,MANGA.booleanEdgesPerGroup,grid,8);if(last.ok){const count=last.value.reduce((n,p)=>n+p.reduce((sum,r)=>sum+r.length-1,0),0);return count<=budget?last:simplifyRegion(last.value,target.localToOutput,Math.max(0,target.tolerancePx/4-error),budget);}if(!last.problems.some(p=>p.code==='geometry/boolean'))return last;
  }return last;
}
