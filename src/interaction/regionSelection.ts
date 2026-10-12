import clipping from 'polygon-clipping';
import {fail,ok,problem,type Id,type Mat,type Point,type Project,type Rect,type Result,type Viewport} from '../domain/types';
import {inverse,multiply,screenMatrix,worldMatrix} from '../geometry/matrix';
import {buildRoundedPolygon,buildRoundedRect} from '../geometry/roundedPolygon';
import {polygonRegion,type Region} from '../geometry/pathRegion';
import {pathToRegion,regionBounds} from '../geometry/renderRegion';
import {polyBounds,segmentsIntersect} from '../geometry/polygon';
import {distanceToSegment} from '../geometry/simplePolygon';
import {layerScreenBounds} from '../render/screenBounds';
import {effectiveLayerFlags} from '../state/effectiveFlags';
import {resolveCrop} from '../images/crop';
import type {ShapePath} from '../geometry/types';

export type AreaTool='marquee'|'lasso';
export type SelectionCombination='replace'|'add'|'subtract'|'intersect';
export type SelectionMatch='intersects'|'contains';
export type SelectionTarget='scope'|'images';
export interface AreaSelectionOptions {combination:SelectionCombination;match:SelectionMatch;target:SelectionTarget}
export interface AreaCandidate {id:Id;bounds:Rect}
export interface AreaShape {kind:AreaTool;points:Point[]}
export const DEFAULT_AREA_OPTIONS:AreaSelectionOptions={combination:'replace',match:'intersects',target:'scope'};
export function rectPoints(b:Rect):Point[]{return[{x:b.x,y:b.y},{x:b.x+b.width,y:b.y},{x:b.x+b.width,y:b.y+b.height},{x:b.x,y:b.y+b.height}];}
function ellipsePath(b:Rect):ShapePath{
  const x=b.x+b.width/2,y=b.y+b.height/2,rx=b.width/2,ry=b.height/2,k=.5522847498307936;
  return{bounds:b,ops:[{op:'M',p:{x:x+rx,y}},{op:'C',c1:{x:x+rx,y:y+k*ry},c2:{x:x+k*rx,y:y+ry},p:{x,y:y+ry}},{op:'C',c1:{x:x-k*rx,y:y+ry},c2:{x:x-rx,y:y+k*ry},p:{x:x-rx,y}},{op:'C',c1:{x:x-rx,y:y-k*ry},c2:{x:x-k*rx,y:y-ry},p:{x,y:y-ry}},{op:'C',c1:{x:x+k*rx,y:y-ry},c2:{x:x+rx,y:y-k*ry},p:{x:x+rx,y}},{op:'Z'}]};
}
/** One frozen candidate pass per stroke; no pixel alpha readback or painter-order changes. */
export function buildAreaCandidates(project:Project,pageId:Id,scopeId:Id|null,viewport:Viewport,target:SelectionTarget):Result<AreaCandidate[]>{
  const page=project.pages[pageId],scope=scopeId?project.layers[scopeId]:null;
  if(!page||!Number.isFinite(viewport.zoom)||viewport.zoom<=0||!Number.isFinite(viewport.pan.x)||!Number.isFinite(viewport.pan.y))return fail(problem('selection/context','选区页面或坐标无效'));
  if(scopeId&&(!scope||scope.pageId!==pageId||scope.type!=='group'||!effectiveLayerFlags(project,scopeId).visible||effectiveLayerFlags(project,scopeId).locked))return fail(problem('selection/scope','请先退出不可编辑的组'));
  const roots=scope?.type==='group'?scope.children:page.roots,ids:Id[]=[],seen=new Set<Id>();
  const collect=(id:Id)=>{if(seen.has(id))return;seen.add(id);const l=project.layers[id];if(!l)return;if(target==='scope'||l.type==='image')ids.push(id);else if('children'in l)l.children.forEach(collect);};roots.forEach(collect);
  const pageRegion=polygonRegion(rectPoints({x:viewport.pan.x,y:viewport.pan.y,width:page.width*viewport.zoom,height:page.height*viewport.zoom})),clips=new Map<Id,Region>(),boxes=new Map<Id,Rect|null>();
  const path=(shape:ShapePath,matrix:Mat):Region=>{const r=pathToRegion(shape,{localToOutput:matrix,tolerancePx:.25});if(!r.ok)throw Error(r.problems[0].message);return r.value.map(poly=>poly.map(ring=>ring.map(([x,y])=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]] as [number,number])));};
  const panelClip=(id:Id):Region=>{let region=clips.get(id);if(!region){const p=project.layers[id];if(p?.type!=='panel')throw Error('分镜裁剪目标无效');region=path(buildRoundedPolygon(p.geometry,p.style.borderRadius),screenMatrix(project,id,viewport));clips.set(id,region);}return region;};
  const visibleBox=(id:Id):Rect|null=>{
    if(boxes.has(id))return boxes.get(id)!;const l=project.layers[id];if(!l||l.pageId!==pageId||!effectiveLayerFlags(project,id).visible||l.type==='pageBackground')return null;
    const matrix=screenMatrix(project,id,viewport);if(!inverse(worldMatrix(project,id)).ok)throw Error('对象坐标系不可逆');
    let region:Region;
    if(l.type==='group'){
      const children=l.children.map(visibleBox).filter((b):b is Rect=>b!==null);if(!children.length&&!l.dialogue){boxes.set(id,null);return null;}
      const extra=l.dialogue?layerScreenBounds(project,id,viewport):null;
      const all=[...children,...(extra?[extra]:[])];region=all.length?clipping.union(...all.map(b=>polygonRegion(rectPoints(b))) as [Region,...Region[]]):[];
    }else if(l.type==='image'){
      let b:Rect={x:0,y:0,width:l.width,height:l.height};const parent=l.parentId?project.layers[l.parentId]:null;
      if(l.crop&&parent?.type==='panel'){const m=resolveCrop(parent.geometry,{x:l.width,y:l.height},l.crop);b={x:m.tx,y:m.ty,width:l.width*m.scale,height:l.height*m.scale};}
      region=path(buildRoundedRect(b,0),matrix);
      if(l.mask?.enabled){const m=l.mask,shape=m.shape==='ellipse'?ellipsePath(polyBounds(m.geometry)):m.shape==='rect'?buildRoundedRect(polyBounds(m.geometry),0):{ops:[...m.geometry.map((p,i)=>({op:i?'L' as const:'M' as const,p})),{op:'Z' as const}],bounds:polyBounds(m.geometry)};region=clipping.intersection(region,path(shape,multiply(matrix,m.matrix)));}
    }else{const b=layerScreenBounds(project,id,viewport);region=b?polygonRegion(rectPoints(b)):[];}
    const policy=l.type==='image'?l.panelClip:undefined;
    if((l.type!=='group'||l.dialogue)&&policy?.mode!=='whole')for(let parent=l.parentId;parent;parent=project.layers[parent]?.parentId??null){if(project.layers[parent]?.type!=='panel')continue;let clip=panelClip(parent);if(policy?.mode==='partial'){const r=policy.region,b=polyBounds(r.geometry),shape=r.shape==='ellipse'?ellipsePath(b):{ops:[...r.geometry.map((p,i)=>({op:i?'L' as const:'M' as const,p})),{op:'Z' as const}],bounds:b};clip=clipping.union(clip,path(shape,multiply(matrix,r.matrix)));}region=clipping.intersection(region,clip);}
    region=clipping.intersection(region,pageRegion);const b=region.length?regionBounds(region):null;const result=b&&b.width>0&&b.height>0&&Object.values(b).every(Number.isFinite)?b:null;boxes.set(id,result);return result;
  };
  try{const out:AreaCandidate[]=[];for(const id of ids){const l=project.layers[id],flags=effectiveLayerFlags(project,id);if(!l||!flags.visible||flags.locked||l.type==='pageBackground')continue;const bounds=visibleBox(id);if(bounds)out.push({id,bounds});}return ok(out);}catch(error){return fail(problem('selection/geometry',`无法建立选区：${(error as Error).message}`));}
}
const EPS=1e-6;
export function pointInArea(point:Point,points:readonly Point[]):boolean{
  let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[j],b=points[i];if(distanceToSegment(point,a,b)<=EPS)return true;if((a.y>point.y)!==(b.y>point.y)&&point.x<a.x+(point.y-a.y)*(b.x-a.x)/(b.y-a.y))inside=!inside;}return inside;
}
function inRect(p:Point,b:Rect,strict=false):boolean{return strict?p.x>b.x+EPS&&p.x<b.x+b.width-EPS&&p.y>b.y+EPS&&p.y<b.y+b.height-EPS:p.x>=b.x-EPS&&p.x<=b.x+b.width+EPS&&p.y>=b.y-EPS&&p.y<=b.y+b.height+EPS;}
function entersRect(a:Point,b:Point,r:Rect):boolean{
  let lo=0,hi=1;for(const [origin,delta,min,max]of [[a.x,b.x-a.x,r.x+EPS,r.x+r.width-EPS],[a.y,b.y-a.y,r.y+EPS,r.y+r.height-EPS]]){if(min>=max)return false;if(Math.abs(delta)<EPS){if(origin<=min||origin>=max)return false;continue;}const t1=(min-origin)/delta,t2=(max-origin)/delta;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));if(lo>=hi)return false;}return lo<hi;
}
export function areaHits(shape:AreaShape,candidates:readonly AreaCandidate[],match:SelectionMatch):Id[]{
  if(shape.points.some(v=>!Number.isFinite(v.x)||!Number.isFinite(v.y)))return[];
  const p=shape.points.filter((v,i)=>!i||Math.hypot(v.x-shape.points[i-1].x,v.y-shape.points[i-1].y)>EPS);
  if(shape.kind==='lasso'&&p.length>1&&Math.hypot(p[0].x-p.at(-1)!.x,p[0].y-p.at(-1)!.y)<=EPS)p.pop();
  if(p.length<(shape.kind==='marquee'?2:3))return[];
  const box=polyBounds(p);return candidates.filter(({bounds:b})=>{
    const overlap=Math.max(box.x,b.x)<=Math.min(box.x+box.width,b.x+b.width)+EPS&&Math.max(box.y,b.y)<=Math.min(box.y+box.height,b.y+b.height)+EPS;if(!overlap)return false;
    if(shape.kind==='marquee')return match==='intersects'||b.x>=box.x-EPS&&b.y>=box.y-EPS&&b.x+b.width<=box.x+box.width+EPS&&b.y+b.height<=box.y+box.height+EPS;
    const corners=rectPoints(b);if(match==='contains')return corners.every(c=>pointInArea(c,p))&&!p.some((a,i)=>entersRect(a,p[(i+1)%p.length],b));
    return corners.some(c=>pointInArea(c,p))||p.some(a=>inRect(a,b))||p.some((a,i)=>corners.some((c,j)=>segmentsIntersect(a,p[(i+1)%p.length],c,corners[(j+1)%4],EPS)));
  }).map(c=>c.id).filter((id,i,ids)=>ids.indexOf(id)===i);
}
export function combineAreaSelection(base:readonly Id[],hits:readonly Id[],mode:SelectionCombination):Id[]{const h=new Set(hits),b=[...new Set(base)];return mode==='replace'?[...h]:mode==='add'?[...new Set([...b,...h])]:b.filter(id=>mode==='intersect'?h.has(id):!h.has(id));}
export function areaCombination(options:AreaSelectionOptions,shift:boolean,alt:boolean):SelectionCombination{return shift&&alt?'intersect':shift?'add':alt?'subtract':options.combination;}
export function isAreaTool(mode:string):mode is AreaTool{return mode==='marquee'||mode==='lasso';}
