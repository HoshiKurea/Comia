import type {Id,Point,Project,Rect,Viewport} from '../domain/types';
import {apply,pageToScreen,worldMatrix} from '../geometry/matrix';
import {localLayerBounds} from '../interaction/layerBounds';
import {effectiveLayerFlags} from '../state/effectiveFlags';

export interface SelectionOutline {id:Id;points:Point[];locked:boolean}
/** Editing geometry only; deliberately independent of document rendering/export. */
export function selectionPolygon(project:Project,id:Id,viewport:Viewport):Point[]{
  const layer=project.layers[id];if(!layer)return [];
  let points:Point[];
  if(layer.type==='panel')points=layer.geometry;
  else if(layer.type==='decoration'&&layer.spec.kind==='shape')points=layer.spec.geometry;
  else{
    let bounds:Rect;
    if(layer.type==='bubble'||layer.type==='image')bounds={x:0,y:0,width:layer.width,height:layer.height};
    else if(layer.type==='text')bounds=bubbleFrameBounds(project,id)?.box??layer.box;
    else if(layer.type==='decoration')bounds={x:0,y:0,width:layer.spec.width,height:layer.spec.height};
    else{const b=localLayerBounds(project,id);if(!b)return [];bounds=b;}
    points=[{x:bounds.x,y:bounds.y},{x:bounds.x+bounds.width,y:bounds.y},{x:bounds.x+bounds.width,y:bounds.y+bounds.height},{x:bounds.x,y:bounds.y+bounds.height}];
  }
  const matrix=worldMatrix(project,id),result=points.map(p=>pageToScreen(apply(matrix,p),viewport));
  return result.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))?result:[];
}
export function selectionOutlines(project:Project,pageId:Id,ids:readonly Id[],viewport:Viewport):SelectionOutline[]{
  const result:SelectionOutline[]=[];
  for(const id of new Set(ids)){
    if(project.layers[id]?.pageId!==pageId)continue;
    const flags=effectiveLayerFlags(project,id);if(!flags.visible)continue;
    const points=selectionPolygon(project,id,viewport);if(points.length)result.push({id,points,locked:flags.locked});
  }
  return result;
}
export function drawSelectionOutlines(context:CanvasRenderingContext2D,outlines:readonly SelectionOutline[]):void{
  context.save();context.lineWidth=1.5;context.setLineDash([5,4]);
  for(const outline of outlines){context.strokeStyle=outline.locked?'#89999c':'#f17848';context.beginPath();outline.points.forEach((p,i)=>i?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y));context.closePath();context.stroke();}
  context.restore();
}
import { bubbleFrameBounds } from '../text/bubbleFrameBounds';
