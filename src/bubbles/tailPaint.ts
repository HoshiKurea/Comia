import type { Id, Project, Rect, Result, BubbleStyle } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { LOCAL_TARGET, type GeometryTarget } from '../geometry/flattenForBoolean';
import { checkedUnion, regionBounds, regionToPath } from '../geometry/renderRegion';
import type { Region } from '../geometry/pathRegion';
import { unionBounds } from '../geometry/bounds';
import { buildTailAppearance, type PreparedTail } from './tailGeometry';
import { effectiveBubbleStyle } from './ownership';
import {buildBubbleStrokeBands,hasStrokeBands} from './strokeBands';
import { buildPressureRibbon } from './strokeRibbon';
export interface TailPaint {geometry:PreparedTail;fill:Region;border:Region;inner?:Region;outer?:Region;bounds:Rect;style:BubbleStyle}
const boundCache=new WeakMap<object,{owner:object|null;key:string;bounds:Rect}>();
/** Selection/culling needs a complete bound, not a separately unioned stroke.
 * w(u)<=width*(1+pressure); add the local flatten error as well. This also
 * covers the bound tail's actual pressure phase on the WHOLE owner outline. */
export function tailVisualBounds(project:Project,id:Id):Result<Rect>{
  const tail=project.layers[id];if(tail?.type!=='bubbleTail')return fail(problem('tail/target','尾巴已不存在'));const owner=tail.parentId?project.layers[tail.parentId]??null:null,effective=owner?.type==='bubble'?effectiveBubbleStyle(project,owner):null,style=tail.style??effective?.style,pressure=tail.stroke?.pressure??effective?.pressure??0;if(!style)return fail(problem('tail/style','尾巴缺少样式'));
  const key=JSON.stringify([style.borderWidth,style.outerStroke,pressure]),cached=boundCache.get(tail);if(cached?.owner===owner&&cached.key===key)return ok(cached.bounds);
  const geometry=buildTailAppearance(project,id);if(!geometry.ok)return geometry;const box=geometry.value.bounds,pad=Math.max(style.borderWidth/2,style.outerStroke?.enabled?style.outerStroke.width:0)*(1+pressure)+.25,bounds={x:box.x-pad,y:box.y-pad,width:box.width+pad*2,height:box.height+pad*2};boundCache.set(tail,{owner,key,bounds});return ok(bounds);
}
export function prepareTailPaint(project:Project,id:Id,target:GeometryTarget=LOCAL_TARGET):Result<TailPaint>{
  const tail=project.layers[id];if(tail?.type!=='bubbleTail')return fail(problem('tail/target','尾巴已不存在'));
  const owner=tail.parentId?project.layers[tail.parentId]:null,inherited=owner?.type==='bubble'?effectiveBubbleStyle(project,owner):null,style=tail.style??inherited?.style,pressure=tail.stroke?.pressure??inherited?.pressure??0,seed=tail.stroke?.seed??inherited?.seed??42;
  if(!style)return fail(problem('tail/style','尾巴缺少样式'));const geometry=buildTailAppearance(project,id,target);if(!geometry.ok)return geometry;
  const fill=checkedUnion(geometry.value.fillRegions);if(!fill.ok)return fill;const ribbons:Region[]=[];
  for(const path of[regionToPath(fill.value),...geometry.value.linePaths]){const ribbon=buildPressureRibbon(path,style.borderWidth,pressure,seed,target);if(!ribbon.ok)return ribbon;ribbons.push(ribbon.value);}
  const border=checkedUnion(ribbons);if(!border.ok)return border;const bands=hasStrokeBands(style)?buildBubbleStrokeBands(fill.value,style,pressure,seed,target):null;if(bands&&!bands.ok)return bands;return ok({geometry:geometry.value,fill:fill.value,border:border.value,...(bands?.ok?{inner:bands.value.inner,outer:bands.value.outer}:{}),bounds:unionBounds([...(bands?.ok?[bands.value.bounds]:[]),geometry.value.bounds,...(border.value.length?[regionBounds(border.value)]:[])])!,style});
}
