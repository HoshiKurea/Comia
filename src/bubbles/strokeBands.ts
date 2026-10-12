import clipping from 'polygon-clipping';
import { fail,ok,problem,type BubbleStyle,type Rect,type Result } from '../domain/types';
import type { Region } from '../geometry/pathRegion';
import { regionBounds,regionEdges,regionToPath } from '../geometry/renderRegion';
import { unionBounds } from '../geometry/bounds';
import { LOCAL_TARGET,type GeometryTarget } from '../geometry/flattenForBoolean';
import { MANGA } from '../domain/limits';
import { buildPressureRibbon } from './strokeRibbon';
import { parseStrokeBand } from '../domain/extensionValidation';
export interface BubbleStrokeBands {inner:Region;outer:Region;center:Region;bounds:Rect}
export const hasStrokeBands=(style:BubbleStyle)=>!!(style.innerStroke?.enabled&&style.innerStroke.width||style.outerStroke?.enabled&&style.outerStroke.width);
/** Each band is filled once; holes and disjoint regions retain their winding. */
export function buildBubbleStrokeBands(fill:Region,style:BubbleStyle,pressure:number,seed:number,target:GeometryTarget=LOCAL_TARGET,budget:number=MANGA.booleanEdgesPerMember):Result<BubbleStrokeBands>{
 const precise={...target,tolerancePx:target.tolerancePx/2},path=regionToPath(fill),center=buildPressureRibbon(path,style.borderWidth,pressure,seed,precise,budget);if(!center.ok)return center;
 const bands:{inner:Region;outer:Region}={inner:[],outer:[]};
 for(const [name,field] of [['inner','innerStroke'],['outer','outerStroke']] as const){const band=style[field];if(!band)continue;const parsed=parseStrokeBand(band,field);if(!parsed.ok)return parsed;if(!band.enabled||band.width===0)continue;
  const ribbon=buildPressureRibbon(path,band.width*2,pressure,seed,precise,budget,512);if(!ribbon.ok)return ribbon;
  try{const region=name==='inner'?clipping.intersection(ribbon.value,fill):clipping.difference(ribbon.value,fill);if(regionEdges(region)>budget)return fail(problem('bubble/band-budget','描边结果超过边预算，未降低精度'));bands[name]=region;}catch(error){return fail(problem('bubble/band-boolean',(error as Error).message));}
 }
 const bounds=unionBounds([fill,center.value,bands.inner,bands.outer].filter(r=>r.length).map(regionBounds))??{x:0,y:0,width:0,height:0};return ok({...bands,center:center.value,bounds});
}
