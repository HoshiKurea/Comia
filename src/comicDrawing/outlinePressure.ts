import { fail, ok, problem, type BubbleLayer, type InkStroke, type Point, type Result } from '../domain/types';
import type { ShapePath } from '../geometry/types';
import { flattenForRender, maxSingularValue, type GeometryTarget } from '../geometry/flattenForBoolean';

/** Pressure stays attached to arc length when the user offsets/wobbles the body. */
export function recordedOutlineStroke(b:BubbleLayer,body:ShapePath,target:GeometryTarget):Result<InkStroke> {
  if(!b.penOutline||!b.freehandSource)return fail(problem('bubble/pressure-source','气泡缺少笔压轮廓'));
  const source=b.penOutline.points.map(p=>({...p,x:p.x*b.width/b.freehandSource!.width,y:p.y*b.height/b.freehandSource!.height}));
  if(!b.edgeStyle?.wobble)return ok({...b.penOutline,width:b.style.borderWidth,points:source});
  const flat=flattenForRender(body,{...target,tolerancePx:target.tolerancePx/8});if(!flat.ok)return flat;
  if(flat.value.length!==1||!flat.value[0].closed)return fail(problem('bubble/pressure-body','笔压需要单条闭合轮廓'));
  const original=[0];for(let i=1;i<source.length;i++)original.push(original[i-1]+Math.hypot(source[i].x-source[i-1].x,source[i].y-source[i-1].y));
  const ring=flat.value[0].points,closed=[...ring,ring[0]],arc=[0];for(let i=1;i<closed.length;i++)arc.push(arc[i-1]+Math.hypot(closed[i].x-closed[i-1].x,closed[i].y-closed[i-1].y));
  let cursor=0;const total=original.at(-1)!,length=arc.at(-1)!;
  if(!total||!length)return fail(problem('bubble/pressure-length','笔压轮廓长度必须大于0'));
  return ok({...b.penOutline,width:b.style.borderWidth,points:closed.map((p,i)=>{const distance=arc[i]/length*total;while(cursor<source.length-2&&original[cursor+1]<distance)cursor++;const t=(distance-original[cursor])/(original[cursor+1]-original[cursor]||1),pressure=source[cursor].pressure+(source[cursor+1].pressure-source[cursor].pressure)*t;return {...p,pressure:Math.max(0,Math.min(1,pressure)),dt:0};})});
}
/** Trace the merged silhouette, removing the neck seam while preserving pressure knots. */
export function compoundPressureStrokes(profile:InkStroke,outline:ShapePath,target:GeometryTarget):Result<InkStroke[]> {
  const flat=flattenForRender(outline,{...target,tolerancePx:target.tolerancePx/8});if(!flat.ok)return flat;
  const project=(p:Point,a:Point,b:Point)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));const q={x:a.x+t*dx,y:a.y+t*dy};return {t,p:q,d:Math.hypot(p.x-q.x,p.y-q.y)};};
  const pressure=(p:Point)=>{let distance=Infinity,value=profile.points[0].pressure;for(let i=1;i<profile.points.length;i++){const a=profile.points[i-1],b=profile.points[i],q=project(p,a,b);if(q.d<distance){distance=q.d;value=a.pressure+(b.pressure-a.pressure)*q.t;}}return value;};
  const loops=flat.value.map(s=>{const points=s.closed?[...s.points,s.points[0]]:[...s.points];return points.slice(0,-1).map((a,i)=>({a,b:points[i+1],knots:[] as {t:number;p:Point}[]}));});
  for(const p of profile.points){let best:{edge:typeof loops[number][number];t:number;p:Point;d:number}|null=null;for(const loop of loops)for(const edge of loop){const q=project(p,edge.a,edge.b);if(!best||q.d<best.d)best={edge,...q};}if(best&&best.d*maxSingularValue(target.localToOutput)<=target.tolerancePx/4&&best.t>1e-9&&best.t<1-1e-9)best.edge.knots.push({t:best.t,p:best.p});}
  return ok(loops.map(loop=>{const points:Point[]=[];for(const edge of loop){points.push(edge.a,...edge.knots.sort((a,b)=>a.t-b.t).map(k=>k.p));}if(loop.length)points.push(loop.at(-1)!.b);return {...profile,points:points.map(p=>({...p,pressure:pressure(p),dt:0}))};}));
}
