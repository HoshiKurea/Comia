import type { Point } from '../domain/types';
import { segmentsIntersect } from './polygon';
interface Edge {a:Point;b:Point;path:number;index:number;n:number;closed:boolean;minX:number;maxX:number;minY:number;maxY:number;length:number}
/** The exact narrow-phase predicate is unchanged. Broad phase preserves its
 * scaled epsilon for short segments and excludes only adjacent edges. */
export function pathsHaveIntersection(paths:readonly {points:readonly Point[];closed:boolean}[],eps=1e-8):boolean{
  const edges:Edge[]=paths.flatMap(({points,closed},path)=>points.slice(0,points.length-(closed?0:1)).map((a,index)=>{const b=points[(index+1)%points.length];return{a,b,path,index,n:points.length,closed,minX:Math.min(a.x,b.x),maxX:Math.max(a.x,b.x),minY:Math.min(a.y,b.y),maxY:Math.max(a.y,b.y),length:Math.hypot(a.x-b.x,a.y-b.y)};}));
  const maxLength=Math.max(1,...edges.map(e=>e.length)),minLength=Math.min(...edges.map(e=>e.length)),padding=minLength>0?2*eps*maxLength/minLength:Infinity;
  edges.sort((a,b)=>a.minX-b.minX);let active:Edge[]=[];
  for(const e of edges){active=active.filter(v=>v.maxX>=e.minX-padding);for(const v of active){if(e.minY>v.maxY+padding||v.minY>e.maxY+padding||e.path===v.path&&(Math.abs(e.index-v.index)===1||e.closed&&Math.abs(e.index-v.index)===e.n-1))continue;if(segmentsIntersect(e.a,e.b,v.a,v.b,eps))return true;}active.push(e);}
  return false;
}
