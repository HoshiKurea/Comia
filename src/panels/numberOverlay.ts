import type { Id, Layer, Point, Project } from '../domain/types';
import { buildRoundedPolygon } from '../geometry/roundedPolygon';
import { worldMatrix } from '../geometry/matrix';
import { polygonRegion, pathPolygon, intersectRegions, regionArea } from '../geometry/pathRegion';
import { rectangle } from './presets';
import { polyBounds } from '../geometry/polygon';

export interface PanelNumberLabel { id: Id; number: number; pageTopLeft: Point }
const cache = new WeakMap<Layer, { ancestors: Layer[]; width: number; height: number; topLeft: Point | null }>();
export function getPanelNumberLabels(project: Project, pageId: Id): readonly PanelNumberLabel[] {
  const page=project.pages[pageId];if(!page)return [];const labels:PanelNumberLabel[]=[];
  for(const layer of Object.values(project.layers)){
    if(layer.pageId!==pageId||layer.type!=='panel'||layer.role!=='leaf'||layer.editorNumber===undefined)continue;
    const ancestors:Layer[]=[];for(let p:Layer|undefined=layer;p;p=p.parentId?project.layers[p.parentId]:undefined)ancestors.push(p);
    if(ancestors.some(p=>!p.visible))continue;
    let saved=cache.get(layer);
    if(!saved||saved.width!==page.width||saved.height!==page.height||saved.ancestors.length!==ancestors.length||saved.ancestors.some((p,i)=>p!==ancestors[i])){
      const regions=[polygonRegion(rectangle({x:0,y:0,width:page.width,height:page.height}))];
      for(const p of ancestors)if(p.type==='panel')regions.push(pathPolygon(buildRoundedPolygon(p.geometry,p.style.borderRadius),worldMatrix(project,p.id)));
      const visible=intersectRegions(...regions),bounds=regionArea(visible)>1e-6?polyBounds(visible.flatMap(poly=>poly[0].map(([x,y])=>({x,y})))):null;
      saved={ancestors,width:page.width,height:page.height,topLeft:bounds?{x:bounds.x,y:bounds.y}:null};cache.set(layer,saved);
    }
    if(saved.topLeft)labels.push({id:layer.id,number:layer.editorNumber,pageTopLeft:saved.topLeft});
  }
  return labels;
}
