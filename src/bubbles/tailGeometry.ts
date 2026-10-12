import type { BubbleLayer, BubbleTailLayer, Id, Point, Project, Rect, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import type { ShapePath } from '../geometry/types';
import { flattenForRender, LOCAL_TARGET, maxSingularValue, type GeometryTarget } from '../geometry/flattenForBoolean';
import { polyBounds, segmentsIntersect } from '../geometry/polygon';
import { distanceToSegment } from '../geometry/simplePolygon';
import { regionContains, type Region } from '../geometry/pathRegion';
import { closedPolygon, pathToRegion, regionBounds } from '../geometry/renderRegion';
import { mangaBodyPath } from './handDrawn';
import { atArc, perimeter, flattenPath, buildBubble } from './geometry';
import clipping from 'polygon-clipping';
import { pathsHaveIntersection } from '../geometry/pathIntersections';

export interface PreparedTail {
  ownerId: Id | null; baseA: Point; baseB: Point; base: Point;
  centerline: ShapePath; fillRegions: Region[]; linePaths: ShapePath[];
  bounds: Rect; samples: Point[]; lengths: number[]; totalLength: number;
}
interface BoundaryEdge {a:Point;b:Point;length:number;minX:number;maxX:number;minY:number;maxY:number}
const boundaryCache=new WeakMap<Region,{edges:BoundaryEdge[];bounds:Rect;minLength:number;maxLength:number}>();
function bodyBoundary(region:Region){let cached=boundaryCache.get(region);if(cached)return cached;const edges=region.flatMap(poly=>poly.flatMap(ring=>ring.slice(1).map((p,i)=>{const a={x:ring[i][0],y:ring[i][1]},b={x:p[0],y:p[1]};return{a,b,length:Math.hypot(a.x-b.x,a.y-b.y),minX:Math.min(a.x,b.x),maxX:Math.max(a.x,b.x),minY:Math.min(a.y,b.y),maxY:Math.max(a.y,b.y)};})));cached={edges,bounds:regionBounds(region),minLength:Math.min(...edges.map(e=>e.length)),maxLength:Math.max(1,...edges.map(e=>e.length))};boundaryCache.set(region,cached);return cached;}
function arcSample(points:Point[],lengths:number[],distance:number):Point{
  let i=0;while(i+1<lengths.length&&lengths[i+1]<distance)i++;
  const a=points[Math.min(i,points.length-1)],b=points[Math.min(i+1,points.length-1)],t=(distance-lengths[i])/(lengths[i+1]-lengths[i]||1);
  return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
}
function lineRoute(tail:BubbleTailLayer,base:Point):ShapePath{
  const ops:ShapePath['ops']=[{op:'M',p:base}];
  if(tail.route.kind==='spline')ops.push({op:'C',c1:tail.route.c1,c2:tail.route.c2,p:tail.tip});
  else{if(tail.route.kind==='polyline')for(const p of tail.route.knots)ops.push({op:'L',p});ops.push({op:'L',p:tail.tip});}
  return{ops,bounds:polyBounds([base,tail.tip,...(tail.route.kind==='spline'?[tail.route.c1,tail.route.c2]:tail.route.kind==='polyline'?tail.route.knots:[])])};
}
interface ArcTable {points:Point[];positions:number[];total:number;region:Region}
const arcCache=new Map<string,ArcTable>();let arcPoints=0;
export function clearTailGeometryCache():void{arcCache.clear();arcPoints=0;}
/** Tail trajectory checks reuse unchanged body geometry for all 32+bisection steps. */
export function bodyArcTable(owner:BubbleLayer,legacy=false):Result<ArcTable>{
  const key=JSON.stringify([owner.shape,owner.width,owner.height,owner.style.radius,owner.handDrawn,owner.contour,legacy]),cached=arcCache.get(key);if(cached){arcCache.delete(key);arcCache.set(key,cached);return ok(cached);}
  const path=mangaBodyPath(owner);if(!path.ok)return path;const flat=flattenForRender(path.value,{...LOCAL_TARGET,tolerancePx:1/64});if(!flat.ok)return flat;const points=legacy?flattenPath(path.value):flat.value[0]?.points;if(!points?.length)return fail(problem('tail/body','主体无有效轮廓'));
  const {positions,total}=perimeter(points),region=legacy?ok(closedPolygon(points)):pathToRegion(path.value);if(!region.ok)return region;
  const value={points,positions,total,region:region.value};arcCache.set(key,value);arcPoints+=points.length;while(arcCache.size>128||arcPoints>65536){const first=arcCache.entries().next().value!;arcPoints-=first[1].points.length;arcCache.delete(first[0]);}return ok(value);
}
export function tailAnchors(tail:BubbleTailLayer,owner?:BubbleLayer):Result<{a:Point;b:Point;base:Point;body:Region|null}>{
  if(tail.attachment.mode==='free')return ok({a:tail.attachment.baseA,b:tail.attachment.baseB,base:{x:(tail.attachment.baseA.x+tail.attachment.baseB.x)/2,y:(tail.attachment.baseA.y+tail.attachment.baseB.y)/2},body:null});
  if(!owner)return fail(problem('tail/owner','绑定尾缺少主体'));
  const table=bodyArcTable(owner,tail.legacySplice);if(!table.ok)return table;const {points,positions,total}=table.value,s=tail.attachment.attachU*total;
  if(tail.attachment.baseWidth<4||tail.attachment.baseWidth>Math.min(128,.2*total))return fail(problem('tail/base-width','底座宽须在4～min(128,20%主体周长)'));
  return ok({a:atArc(points,positions,total,s-tail.attachment.baseWidth/2),b:atArc(points,positions,total,s+tail.attachment.baseWidth/2),base:atArc(points,positions,total,s),body:table.value.region});
}
export function buildTailRoute(project:Pick<Project,'layers'>,tailId:Id,target:GeometryTarget=LOCAL_TARGET):Result<PreparedTail>{
  const tail=project.layers[tailId];if(tail?.type!=='bubbleTail')return fail(problem('tail/target','尾巴已不存在'));
  const owner=tail.parentId?project.layers[tail.parentId]:undefined,anchors=tailAnchors(tail,owner?.type==='bubble'?owner:undefined);if(!anchors.ok)return anchors;
  const {a,b,base,body}=anchors.value,centerline=lineRoute(tail,base),flat=flattenForRender(centerline,target);if(!flat.ok)return flat;
  const samples=flat.value[0]?.points??[],lengths=[0];
  if(samples.length<2)return fail(problem('tail/length','尾巴路线不能为零长'));
  for(let i=1;i<samples.length;i++){const step=Math.hypot(samples[i].x-samples[i-1].x,samples[i].y-samples[i-1].y);if(step<1e-8)return fail(problem('tail/route-points','路线含重复点'));lengths.push(lengths.at(-1)!+step);}
  const totalLength=lengths.at(-1)!;if(totalLength>65536)return fail(problem('tail/length','路线总长超过65536像素'));
  if(body&&owner?.type==='bubble'){
    const boundary=bodyBoundary(body),bounds=boundary.bounds;
    let gap=Infinity;
    for(const edge of boundary.edges)gap=Math.min(gap,distanceToSegment(tail.tip,edge.a,edge.b));
    if(regionContains(body,tail.tip)||gap<4-1e-6||Math.hypot(tail.tip.x-base.x,tail.tip.y-base.y)>4*Math.max(owner.width,owner.height)+1e-6)return fail(problem('tail/tip','尾尖须在主体外至少4像素且距底座不超过4倍主体长边'));
    for(let i=1;i<samples.length;i++){
      const a=samples[i-1],b=samples[i],minX=Math.min(a.x,b.x),maxX=Math.max(a.x,b.x),minY=Math.min(a.y,b.y),maxY=Math.max(a.y,b.y),la=Math.hypot(b.x-a.x,b.y-a.y),pad=2e-8*Math.max(la,boundary.maxLength)/Math.min(la,boundary.minLength);
      if(b.x>=bounds.x-1e-8&&b.x<=bounds.x+bounds.width+1e-8&&b.y>=bounds.y-1e-8&&b.y<=bounds.y+bounds.height+1e-8&&regionContains(body,b)&&Math.hypot(b.x-base.x,b.y-base.y)>2)return fail(problem('tail/route-body','尾巴路线穿过主体'));
      if(maxX<bounds.x-pad||minX>bounds.x+bounds.width+pad||maxY<bounds.y-pad||minY>bounds.y+bounds.height+pad)continue;
      for(const edge of boundary.edges){
        if(maxX<edge.minX-pad||edge.maxX<minX-pad||maxY<edge.minY-pad||edge.maxY<minY-pad)continue;
        if(segmentsIntersect(a,b,edge.a,edge.b,1e-8)&&distanceToSegment(base,edge.a,edge.b)>2)return fail(problem('tail/route-body','尾巴路线与主体再次相交'));
      }
    }
  }else if(distanceToSegment(tail.tip,a,b)<4)return fail(problem('tail/tip','自由尾尖与底座至少相距4像素'));
  if(pathsHaveIntersection([{points:samples,closed:false}]))return fail(problem('tail/route-self-intersection','尾巴路线存在自交'));
  return ok({ownerId:owner?.type==='bubble'?owner.id:null,baseA:a,baseB:b,base,centerline,fillRegions:[],linePaths:[],bounds:polyBounds([a,b,...samples]),samples,lengths,totalLength});
}
export function buildTailAppearance(project:Pick<Project,'layers'>,tailId:Id,target:GeometryTarget=LOCAL_TARGET):Result<PreparedTail>{
  const source=project.layers[tailId];
  if(source?.type==='bubbleTail'&&source.legacySplice&&source.attachment.mode==='bubble'){
    const owner=source.parentId?project.layers[source.parentId]:undefined;
    if(owner?.type!=='bubble'||owner.handDrawn||owner.contour||!['triangle','line'].includes(source.appearance))return fail(problem('tail/legacy-body','旧尾需要未改形的原主体'));
    const geometry=buildBubble(owner.shape,owner.width,owner.height,owner.style,{kind:source.appearance as 'triangle'|'line',attachU:source.attachment.attachU,baseWidth:source.attachment.baseWidth,tip:source.tip});if(!geometry.ok)return geometry;
    const anchors=tailAnchors(source,owner);if(!anchors.ok)return anchors;
    const centerline=lineRoute(source,anchors.value.base),totalLength=Math.hypot(source.tip.x-anchors.value.base.x,source.tip.y-anchors.value.base.y),fills:Region[]=[];
    if(source.appearance==='triangle'){
      const region=pathToRegion(geometry.value.outline,target);if(!region.ok)return region;
      try{fills.push(clipping.difference(region.value,anchors.value.body!));}catch(error){return fail(problem('tail/legacy-boolean',(error as Error).message));}
    }
    return ok({ownerId:owner.id,baseA:anchors.value.a,baseB:anchors.value.b,base:anchors.value.base,centerline,fillRegions:fills,linePaths:geometry.value.tailLine?[geometry.value.tailLine]:[],bounds:polyBounds([anchors.value.a,anchors.value.b,source.tip]),samples:[anchors.value.base,source.tip],lengths:[0,totalLength],totalLength});
  }
  const route=buildTailRoute(project,tailId,target);if(!route.ok)return route;
  const tail=project.layers[tailId] as BubbleTailLayer,prepared=route.value;
  if(tail.appearance==='line')return ok({...prepared,linePaths:[prepared.centerline]});
  const width=tail.attachment.mode==='bubble'?tail.attachment.baseWidth:Math.hypot(prepared.baseA.x-prepared.baseB.x,prepared.baseA.y-prepared.baseB.y);
  const {samples,lengths,totalLength,base,baseA,baseB}=prepared;
  const regions:Region[]=[];
  if(tail.appearance==='thought'){
    const n=tail.beads,powers=Array.from({length:n},(_,i)=>.76**i),s=1+powers.slice(1).reduce((sum,r,i)=>sum+r+powers[i],0),r0=Math.min(width/3,32,(totalLength-2*n)/s),gap=(totalLength-r0*s)/n;
    if(r0*powers.at(-1)!<1||gap<2)return fail(problem('tail/thought-length','这条路线太短，无法放入至少1像素的小泡及间隔'));
    let distance=r0+gap;const circles:{center:Point;radius:number}[]=[];
    const owner=prepared.ownerId?project.layers[prepared.ownerId]:null;
    let ownerRegion: Region | null = null;
    if(owner?.type==='bubble'){const body=mangaBodyPath(owner);if(!body.ok)return body;const region=pathToRegion(body.value);if(!region.ok)return region;ownerRegion=region.value;}
    for(let k=0;k<n;k++){
      const radius=r0*powers[k];if(k)distance+=r0*powers[k-1]+radius+gap;
      const center=arcSample(samples,lengths,distance);
      if(circles.some(c=>Math.hypot(c.center.x-center.x,c.center.y-center.y)<c.radius+radius+1))return fail(problem('tail/thought-overlap','小泡在该弯曲路线相互重叠，请拉长或调整弯曲'));
      if(ownerRegion){if(regionContains(ownerRegion,center))return fail(problem('tail/thought-body','圆泡进入主体'));for(const poly of ownerRegion)for(const ring of poly)for(let i=0;i+1<ring.length;i++)if(distanceToSegment(center,{x:ring[i][0],y:ring[i][1]},{x:ring[i+1][0],y:ring[i+1][1]})<radius+1)return fail(problem('tail/thought-body','圆泡与主体间隔不足'));}
      const outputRadius=radius*maxSingularValue(target.localToOutput),step=outputRadius>.25?2*Math.acos(Math.max(-1,1-target.tolerancePx/outputRadius)):Math.PI/2,count=Math.max(8,Math.ceil(2*Math.PI/step));
      if(count>8192)return fail(problem('tail/budget','圆泡超过几何预算'));
      regions.push(closedPolygon(Array.from({length:count},(_,i)=>({x:center.x+radius*Math.cos(2*Math.PI*i/count),y:center.y+radius*Math.sin(2*Math.PI*i/count)}))));circles.push({center,radius});
    }
  }else{
    const waveCount=tail.appearance==='jagged'?Math.ceil(2*Math.PI*tail.zigzag*Math.sqrt(width*.11*maxSingularValue(target.localToOutput)/(8*target.tolerancePx)))+1:0;
    const count=Math.max(samples.length,33,waveCount),left:Point[]=[],right:Point[]=[];
    const distances=[...new Set([...lengths,...Array.from({length:count},(_,i)=>i/(count-1)*totalLength)])].sort((a,b)=>a-b);
    if(distances.length*2>8192)return fail(problem('tail/budget','尾巴轮廓超过边预算，未降低精度'));
    for(const distance of distances){
      const t=distance/totalLength,p=arcSample(samples,lengths,distance),prior=arcSample(samples,lengths,Math.max(0,distance-totalLength/(count*4))),next=arcSample(samples,lengths,Math.min(totalLength,distance+totalLength/(count*4))),dx=next.x-prior.x,dy=next.y-prior.y,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;
      const f=tail.appearance==='flat'?1-.65*t:1-t,j=tail.appearance==='jagged'?.22*Math.sin(2*Math.PI*tail.zigzag*t):0;
      left.push({x:p.x+nx*width*f*(1+j)/2,y:p.y+ny*width*f*(1+j)/2});right.push({x:p.x-nx*width*f*(1-j)/2,y:p.y-ny*width*f*(1-j)/2});
    }
    const first=samples[1],nx=-(first.y-base.y),ny=first.x-base.x;
    if((baseA.x-base.x)*nx+(baseA.y-base.y)*ny>(baseB.x-base.x)*nx+(baseB.y-base.y)*ny){left[0]=baseA;right[0]=baseB;}else{left[0]=baseB;right[0]=baseA;}
    const dx=first.x-base.x,dy=first.y-base.y,len=Math.hypot(dx,dy)||1,cap={x:base.x-dx/len*2,y:base.y-dy/len*2};
    const points=[...left,...right.reverse()];if(prepared.ownerId)points.push(cap);
    // A pointed tip is one point, not two duplicate contour vertices.
    const clean=points.filter((p,i)=>i===0||Math.hypot(p.x-points[i-1].x,p.y-points[i-1].y)>1e-8);
    if(pathsHaveIntersection([{points:clean,closed:true}]))return fail(problem('tail/self-intersection','实心尾轮廓自交，请调整路由/底座宽'));
    regions.push(closedPolygon(clean));
  }
  const points=regions.flatMap(r=>{const b=regionBounds(r);return[{x:b.x,y:b.y},{x:b.x+b.width,y:b.y+b.height}];});
  return ok({...prepared,fillRegions:regions,bounds:points.length?polyBounds(points):prepared.bounds});
}
