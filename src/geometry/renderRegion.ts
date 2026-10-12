import clipping from 'polygon-clipping';
import type { Mat, Point, Rect, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import type { ShapePath } from './types';
import { flattenForBoolean, type GeometryTarget, LOCAL_TARGET } from './flattenForBoolean';
import { polygonRegion, regionContains, type Region } from './pathRegion';
import { polyBounds } from './polygon';
import { apply } from './matrix';
import { MANGA } from '../domain/limits';

export function regionEdges(region: Region): number { return region.reduce((sum,poly)=>sum+poly.reduce((n,ring)=>n+Math.max(0,ring.length-1),0),0); }
export function checkedUnion(regions: readonly Region[], budget: number = MANGA.booleanEdgesPerMember, grid=0,batchSize=32): Result<Region> {
  if(!Number.isInteger(batchSize)||batchSize<2||batchSize>32)return fail(problem('geometry/merge-batch','合并批次须为2～32的整数'));
  try {
    const snap=(region:Region):Region=>{
      if(!grid)return region;
      const ringSnap=(ring:[number,number][]):[number,number][]=>{
        const points=ring.map(([x,y])=>[Math.round(x/grid)*grid,Math.round(y/grid)*grid] as [number,number]).filter((p,i,all)=>!i||p[0]!==all[i-1][0]||p[1]!==all[i-1][1]);
        if(points.length>1&&points[0][0]===points.at(-1)![0]&&points[0][1]===points.at(-1)![1])points.pop();
        if(points.length<3)return [];
        const origin=points[0];let area=0;
        for(let i=1;i+1<points.length;i++)area+=(points[i][0]-origin[0])*(points[i+1][1]-origin[1])-(points[i][1]-origin[1])*(points[i+1][0]-origin[0]);
        return area===0?[]:[...points,points[0]];
      };
      return region.flatMap(poly=>{const outer=ringSnap(poly[0]);return outer.length?[[outer,...poly.slice(1).map(ringSnap).filter(r=>r.length)]]:[];});
    };
    let chunks=regions.filter(r=>r.length).map(snap);
    if(!chunks.length)return ok([]);
    while(chunks.length>1){const next:Region[]=[];for(let i=0;i<chunks.length;i+=batchSize){const group=chunks.slice(i,i+batchSize);next.push(snap(clipping.union(group[0],...group.slice(1))));}chunks=next;}
    if(regionEdges(chunks[0])>budget)return fail(problem('geometry/region-budget','布尔结果超过轮廓边预算，未降低精度'));
    return ok(chunks[0]);
  } catch(error){return fail(problem('geometry/boolean',(error as Error).message));}
}
/** Canonical generated paths use the same winding for all outer rings and the opposite for holes. */
export function pathToRegion(path:ShapePath,target:GeometryTarget=LOCAL_TARGET,budget:number=MANGA.booleanEdgesPerMember):Result<Region>{
  const flat=flattenForBoolean(path,target,budget);if(!flat.ok)return flat;if(!flat.value.length)return ok([]);
  const entries=flat.value.map(points=>{let area=0;for(let i=0;i<points.length;i++){const p=points[i],q=points[(i+1)%points.length];area+=p.x*q.y-q.x*p.y;}return{points,area};});
  const main=entries.reduce((a,b)=>Math.abs(a.area)>=Math.abs(b.area)?a:b),sign=Math.sign(main.area);
  const outers=entries.filter(e=>Math.sign(e.area)===sign).map(e=>({...e,region:polygonRegion(e.points),holes:[] as Region[]}));
  for(const hole of entries.filter(e=>Math.sign(e.area)!==sign)){
    // A hole belongs to its nearest enclosing OUTER, not to the global union.
    // Subtracting all holes globally erases legitimate filled islands in holes.
    const owner=outers.filter(e=>Math.abs(e.area)>Math.abs(hole.area)&&regionContains(e.region,hole.points[0])).sort((a,b)=>Math.abs(a.area)-Math.abs(b.area))[0];
    if(!owner)return fail(problem('geometry/hole-owner','洞没有包含它的外轮廓'));
    owner.holes.push(polygonRegion(hole.points));
  }
  try{return checkedUnion(outers.map(e=>e.holes.length?clipping.difference(e.region,...e.holes):e.region),budget);}catch(error){return fail(problem('geometry/boolean',(error as Error).message));}
}
export function transformRegion(region:Region,matrix:Mat):Region{return region.map(poly=>poly.map(ring=>ring.map(([x,y])=>{const p=apply(matrix,{x,y});return[p.x,p.y] as [number,number];})));}
export function regionBounds(region:Region):Rect{return region.length?polyBounds(region.flatMap(poly=>poly.flatMap(ring=>ring.map(([x,y])=>({x,y}))))):{x:0,y:0,width:0,height:0};}
export function regionToPath(region:Region):ShapePath{
  const ops:ShapePath['ops']=[];
  for(const poly of region)for(const ring of poly){ring.slice(0,-1).forEach(([x,y],i)=>ops.push({op:i===0?'M':'L',p:{x,y}}));ops.push({op:'Z'});}
  return{ops,bounds:regionBounds(region)};
}
export function closedPolygon(points:readonly Point[]):Region{return polygonRegion(points);}
