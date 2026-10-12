import type { BubbleLayer, Id, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import type { ShapePath } from '../geometry/types';
import type { Region } from '../geometry/pathRegion';
import { checkedUnion, pathToRegion, regionBounds, regionToPath, regionEdges } from '../geometry/renderRegion';
import { LOCAL_TARGET, type GeometryTarget } from '../geometry/flattenForBoolean';
import { buildBubble, type BubbleGeometry } from './geometry';
import { bubbleTails, legacyBubbleTail } from './ownership';
import { mangaBodyPath } from './handDrawn';
import { buildTailAppearance, type PreparedTail } from './tailGeometry';
import { buildPressureRibbon } from './strokeRibbon';
import {buildBubbleStrokeBands,hasStrokeBands} from './strokeBands';
import { unionBounds } from '../geometry/bounds';

export interface MangaBubbleGeometry extends BubbleGeometry {
  body: ShapePath; fillRegion: Region; borderRegion?: Region; innerRegion?:Region;outerRegion?:Region;
  tails: PreparedTail[]; bounds: ShapePath['bounds'];
}
const cache=new Map<string,{id:Id;geometry:MangaBubbleGeometry;bytes:number}>();let cacheBytes=0;
const variants=new Map<Id,string[]>();
function evict(key:string):void{const value=cache.get(key);if(!value)return;cache.delete(key);cacheBytes-=value.bytes;const keys=(variants.get(value.id)??[]).filter(k=>k!==key);if(keys.length)variants.set(value.id,keys);else variants.delete(value.id);}
const baseCache=new Map<string,BubbleGeometry>();
const bodyCache=new Map<string,{base:BubbleGeometry;body:ShapePath}>();
export function clearMangaGeometryCache():void{cache.clear();bodyCache.clear();baseCache.clear();variants.clear();cacheBytes=0;}
export function composeBubble(project: Pick<Project,'layers'|'schemaVersion'>,id:Id,target:GeometryTarget=LOCAL_TARGET):Result<MangaBubbleGeometry>{
  if(target.localToOutput.length!==6||target.localToOutput.some(v=>!Number.isFinite(v)))return fail(problem('geometry/target','输出坐标矩阵须为六个有限数值'));
  target={...target,localToOutput:[target.localToOutput[0],target.localToOutput[1],target.localToOutput[2],target.localToOutput[3],0,0]};
  const b=project.layers[id];if(b?.type!=='bubble')return fail(problem('bubble/target','主体已不存在'));
  const key=JSON.stringify([id,project.schemaVersion,b.shape,b.width,b.height,b.style,b.handDrawn,b.contour,b.edgeStyle,b.tail,bubbleTails(project,id).map(({appearance,attachment,tip,route,beads,zigzag,legacySplice,visible})=>[appearance,attachment,tip,route,beads,zigzag,legacySplice,visible]),target]);
  const entry=cache.get(key);if(entry){cache.delete(key);cache.set(key,entry);return ok(entry.geometry);}
  const result=composeUncached(project,id,target);if(result.ok){const bytes=128*(regionEdges(result.value.fillRegion)+regionEdges(result.value.borderRegion??[])+regionEdges(result.value.innerRegion??[])+regionEdges(result.value.outerRegion??[])+result.value.outline.ops.length+result.value.tails.reduce((n,t)=>n+t.samples.length+t.fillRegions.reduce((s,r)=>s+regionEdges(r),0),0));if(bytes<=16*1024*1024){const prior=variants.get(id)??[];while(prior.length>=4){const oldest=prior.shift()!;evict(oldest);}cache.set(key,{id,geometry:result.value,bytes});cacheBytes+=bytes;variants.set(id,[...prior,key]);while(cache.size>128||cacheBytes>16*1024*1024)evict(cache.keys().next().value!);}}return result;
}
function composeUncached(project:Pick<Project,'layers'|'schemaVersion'>,id:Id,target:GeometryTarget):Result<MangaBubbleGeometry>{
  const bubble=project.layers[id];if(bubble?.type!=='bubble')return fail(problem('bubble/target','主体已不存在'));
  const legacy=legacyBubbleTail(project,bubble);
  const bodyKey=JSON.stringify([bubble.shape,bubble.width,bubble.height,bubble.style,bubble.handDrawn,bubble.contour,bubble.edgeStyle,target]);let cachedBody=bodyCache.get(bodyKey);
  if(!cachedBody){const baseKey=JSON.stringify([bubble.shape,bubble.width,bubble.height,bubble.style,bubble.handDrawn,bubble.contour,bubble.edgeStyle]);let base=baseCache.get(baseKey);if(!base){const r=buildBubble(bubble.shape,bubble.width,bubble.height,bubble.style,null,bubble);if(!r.ok)return r;base=r.value;baseCache.set(baseKey,base);if(baseCache.size>128)baseCache.delete(baseCache.keys().next().value!);}const body=mangaBodyPath(bubble,target);if(!body.ok)return body;cachedBody={base,body:body.value};bodyCache.set(bodyKey,cachedBody);if(bodyCache.size>128)bodyCache.delete(bodyCache.keys().next().value!);}
  const base=legacy?buildBubble(bubble.shape,bubble.width,bubble.height,bubble.style,legacy,bubble):ok(cachedBody.base);if(!base.ok)return base;const body=cachedBody.body;
  const hasFeature=hasStrokeBands(bubble.style)||!!bubble.edgeStyle?.wobble||!!bubble.handDrawn||!!bubble.contour||['handOval','handPolygon','wave'].includes(bubble.shape),children=bubbleTails(project,id).filter(t=>t.visible);
  if(!hasFeature&&(project.schemaVersion<6||children.length===0||legacy!==null)){
    const fill=pathToRegion(base.value.outline,{...target,tolerancePx:target.tolerancePx/4});if(!fill.ok)return fill;
    return ok({...base.value,body,fillRegion:fill.value,tails:[],bounds:base.value.outline.bounds});
  }
  const fillBase=pathToRegion(body,{...target,tolerancePx:target.tolerancePx/4});if(!fillBase.ok)return fillBase;
  // A fixed-width stroke on a simple derived body needs no polygon union.
  // Canvas draws the same rounded center stroke directly, at the full output
  // precision. Keep legacy/pressure/band/tail paths on their regional contract.
  if(bubble.edgeStyle?.wobble && !hasStrokeBands(bubble.style) && !bubble.handDrawn?.pressure && children.length===0){
    const r=bubble.style.borderWidth/2,b=body.bounds;
    return ok({outline:body,tailLine:null,textBox:base.value.textBox,body,fillRegion:fillBase.value,tails:[],bounds:{x:b.x-r,y:b.y-r,width:b.width+2*r,height:b.height+2*r}});
  }
  const regions:Region[]=[fillBase.value],tails:PreparedTail[]=[],lines:ShapePath[]=[];
  for(const tail of children){
    const prepared=buildTailAppearance(project,tail.id,target);if(!prepared.ok)return prepared;
    tails.push(prepared.value);regions.push(...prepared.value.fillRegions);lines.push(...prepared.value.linePaths);
  }
  const fill=checkedUnion(regions);if(!fill.ok)return fill;
  const strokeTarget=hasStrokeBands(bubble.style)||bubble.edgeStyle?.wobble?{...target,tolerancePx:target.tolerancePx/2}:target;const outline=regionToPath(fill.value),bands=hasStrokeBands(bubble.style)?buildBubbleStrokeBands(fill.value,bubble.style,bubble.handDrawn?.pressure??0,bubble.handDrawn?.seed??42,strokeTarget):null;if(bands&&!bands.ok)return bands;const stroke=bands?.ok?ok(bands.value.center):buildPressureRibbon(outline,bubble.style.borderWidth,bubble.handDrawn?.pressure??0,bubble.handDrawn?.seed??42,strokeTarget);if(!stroke.ok)return stroke;
  const strokeRegions=[stroke.value];
  for(const line of lines){const border=buildPressureRibbon(line,bubble.style.borderWidth,bubble.handDrawn?.pressure??0,bubble.handDrawn?.seed??42,strokeTarget);if(!border.ok)return border;strokeRegions.push(border.value);}
  const border=checkedUnion(strokeRegions);if(!border.ok)return border;
  const bounds=unionBounds([...(bands?.ok?[bands.value.bounds]:[]),regionBounds(fill.value),...(border.value.length?[regionBounds(border.value)]:[])]);
  return ok({outline,tailLine:null,textBox:base.value.textBox,body,fillRegion:fill.value,borderRegion:border.value,...(bands?.ok?{innerRegion:bands.value.inner,outerRegion:bands.value.outer}:{}),tails,bounds:bounds??outline.bounds});
}
export function bubbleBaseGeometry(bubble:BubbleLayer):Result<BubbleGeometry>{return buildBubble(bubble.shape,bubble.width,bubble.height,bubble.style,null,bubble);}
