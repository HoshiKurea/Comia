import type {AreaSelectionGesture} from '../interaction/areaSelectionGesture';
import {rectPoints} from '../interaction/regionSelection';
import {polyBounds} from '../geometry/polygon';
export function drawAreaSelection(ctx:CanvasRenderingContext2D,g:AreaSelectionGesture):void{
  const points=g.shape.kind==='marquee'?rectPoints(polyBounds(g.shape.points)):g.shape.points;if(!points.length)return;
  ctx.save();ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle='rgba(65,145,210,0.08)';ctx.fill('evenodd');ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.strokeStyle='#17222d';ctx.lineDashOffset=0;ctx.stroke();ctx.strokeStyle='#ffffff';ctx.lineDashOffset=4;ctx.stroke();ctx.restore();
}
