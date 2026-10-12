import type { Point, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import type { ShapePath } from './types';
import { apply } from './matrix';
import { distanceToSegment } from './simplePolygon';
import { LOCAL_TARGET, type GeometryTarget } from './flattenForBoolean';
/** Actual Bezier projection under the output metric, retaining its source span.
 * Subdivide by control-hull chord error, then minimize |A B(t)-A q|² in each
 * bracket. Golden-section refinement uses32 steps; authored vertices remain intact. */
export function closestPathPoint(path:ShapePath,q:Point,target:GeometryTarget=LOCAL_TARGET):Result<{point:Point;afterIndex:number;distance:number}>{
  if(![q.x,q.y,...target.localToOutput,target.tolerancePx].every(Number.isFinite)||target.tolerancePx<=0)return fail(problem('geometry/closest-input','曲线投影坐标或精度无效'));
  let cursor:Point|null=null,index=0,count=0,best={point:{x:0,y:0},afterIndex:0,distance:Infinity};const out=apply(target.localToOutput,q);
  const evaluate=(p:Point[],t:number):Point=>{let levels=p.map(v=>({...v}));while(levels.length>1)levels=levels.slice(1).map((v,i)=>({x:levels[i].x+(v.x-levels[i].x)*t,y:levels[i].y+(v.y-levels[i].y)*t}));return levels[0];};
  const consider=(original:Point[],t:number,span:number)=>{const p=evaluate(original,t),s=apply(target.localToOutput,p),distance=Math.hypot(s.x-out.x,s.y-out.y);if(distance<best.distance-1e-9)best={point:p,afterIndex:span,distance};};
  const refine=(original:Point[],a:number,b:number,span:number)=>{
    const metric=(t:number)=>{const p=apply(target.localToOutput,evaluate(original,t));return(p.x-out.x)**2+(p.y-out.y)**2;};const g=(Math.sqrt(5)-1)/2;let lo=a,hi=b,x=hi-g*(hi-lo),y=lo+g*(hi-lo),fx=metric(x),fy=metric(y);
    for(let i=0;i<32;i++){if(fx<=fy){hi=y;y=x;fy=fx;x=hi-g*(hi-lo);fx=metric(x);}else{lo=x;x=y;fx=fy;y=lo+g*(hi-lo);fy=metric(y);}}
    for(const t of[a,b,(lo+hi)/2])consider(original,t,span);
  };
  const curve=(p:Point[],original:Point[],a:number,b:number,span:number,depth:number):void=>{
    const transformed=p.map(v=>apply(target.localToOutput,v));if(transformed.slice(1,-1).every(v=>distanceToSegment(v,transformed[0],transformed.at(-1)!)<=target.tolerancePx/4)){if(++count>8192)throw Error('投影超出8192段预算');refine(original,a,b,span);return;}if(depth>=20)throw Error('投影递归无法达到精度');
    const levels=[p];while(levels.at(-1)!.length>1){const last=levels.at(-1)!;levels.push(last.slice(1).map((v,i)=>({x:(v.x+last[i].x)/2,y:(v.y+last[i].y)/2})));}const mid=(a+b)/2;curve(levels.map(v=>v[0]),original,a,mid,span,depth+1);curve(levels.map(v=>v.at(-1)!).reverse(),original,mid,b,span,depth+1);
  };
  try{for(const op of path.ops){if(op.op==='M')cursor=op.p;else if(op.op!=='Z'){if(!cursor)throw Error('曲线缺少起点');const p=op.op==='L'?[cursor,op.p]:op.op==='Q'?[cursor,op.control,op.p]:[cursor,op.c1,op.c2,op.p];curve(p,p,0,1,index++,0);cursor=op.p;}}}catch(error){return fail(problem('geometry/closest-budget',(error as Error).message));}
  return Number.isFinite(best.distance)?ok(best):fail(problem('geometry/closest-empty','路径没有可投影的边'));
}
