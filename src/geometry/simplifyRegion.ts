import type {Mat,Point,Result} from '../domain/types';
import {fail,ok,problem} from '../domain/types';
import type {Region} from './pathRegion';
import {apply} from './matrix';
import {distanceToSegment} from './simplePolygon';
import {segmentsIntersect} from './polygon';
import {regionEdges} from './renderRegion';
/** RDP's complete subchain remains in the endpoint capsule, proving both directed distances. */
export function rdpPoints(points:readonly Point[],matrix:Mat,tolerance:number):Point[]{
 if(points.length<3)return [...points];const keep=new Set<number>([0,points.length-1]),stack=[[0,points.length-1]];
 while(stack.length){const [lo,hi]=stack.pop()!;let best=tolerance,index=-1,a=apply(matrix,points[lo]),b=apply(matrix,points[hi]);for(let i=lo+1;i<hi;i++){const d=distanceToSegment(apply(matrix,points[i]),a,b);if(d>best){best=d;index=i;}}if(index>=0){keep.add(index);stack.push([lo,index],[index,hi]);}}
 return [...keep].sort((a,b)=>a-b).map(i=>({...points[i]}));
}
export function simplifyRegion(region:Region,matrix:Mat,tolerance:number,budget:number):Result<Region>{
 const simplified=region.map(poly=>poly.map(ring=>{const p=ring.slice(0,-1).map(([x,y])=>({x,y}));let split=1,dist=-1;for(let i=1;i<p.length;i++){const a=apply(matrix,p[i]),b=apply(matrix,p[0]),d=Math.hypot(a.x-b.x,a.y-b.y);if(d>dist){dist=d;split=i;}}
  const out=[...rdpPoints(p.slice(0,split+1),matrix,tolerance).slice(0,-1),...rdpPoints([...p.slice(split),p[0]],matrix,tolerance).slice(0,-1)];return [...out,out[0]].map(p=>[p.x,p.y] as [number,number]);}));
 const area=(r:readonly [number,number][])=>r.slice(0,-1).reduce((n,p,i)=>n+p[0]*r[i+1][1]-r[i+1][0]*p[1],0);
 if(simplified.some((poly,pi)=>poly.some((r,ri)=>r.length<4||Math.abs(area(r))<1e-12||Math.sign(area(r))!==Math.sign(area(region[pi][ri]))))||regionEdges(simplified)>budget)return fail(problem('geometry/region-budget','保持精度后描边仍超过边预算，未降低精度'));
 const edges=simplified.flatMap((poly,pi)=>poly.flatMap((ring,ri)=>ring.slice(0,-1).map(([x,y],i)=>{const [bx,by]=ring[i+1];return{pi,ri,i,n:ring.length-1,a:{x,y},b:{x:bx,y:by},minX:Math.min(x,bx),maxX:Math.max(x,bx),minY:Math.min(y,by),maxY:Math.max(y,by)};}))).sort((a,b)=>a.minX-b.minX);let active:typeof edges=[];
 for(const e of edges){active=active.filter(q=>q.maxX>=e.minX-1e-9);for(const q of active){if(q.maxY<e.minY||e.maxY<q.minY||q.pi===e.pi&&q.ri===e.ri&&(Math.abs(q.i-e.i)===1||Math.abs(q.i-e.i)===e.n-1))continue;if(segmentsIntersect(e.a,e.b,q.a,q.b,1e-9))return fail(problem('geometry/simplify-topology','精确简化会改变描边拓扑，未应用'));}active.push(e);}
 return ok(simplified);
}
