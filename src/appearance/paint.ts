import type { Layer, Point } from '../domain/types';
import type { ShapePath } from '../geometry/types';
import { appendPath } from '../render/clipPolicy';
import { flattenForRender,maxSingularValue } from '../geometry/flattenForBoolean';
import { distanceToSegment } from '../geometry/simplePolygon';
import { compositeMode, presentation } from './model';
export function customStroke(layer:Layer):boolean {const s=layer.presentation?.stroke;return !!s&&(s.alignment!=='center'||s.dash!=='solid'||s.join!=='round'||!!s.edgeWidths);}

export function paintFill(ctx:CanvasRenderingContext2D,path:ShapePath,color:string,layer:Layer):void {
  ctx.save();ctx.globalCompositeOperation=compositeMode(presentation(layer).fillBlendMode);ctx.beginPath();appendPath(ctx,path);ctx.fillStyle=color;ctx.fill();ctx.restore();
}
export function paintBorderRegion(ctx:CanvasRenderingContext2D,path:ShapePath,color:string,layer:Layer):void {ctx.save();ctx.globalCompositeOperation=compositeMode(presentation(layer).strokeBlendMode);ctx.beginPath();appendPath(ctx,path);ctx.fillStyle=color;ctx.fill();ctx.restore();}
const pattern=(kind:string,w:number)=>kind==='dash'?[6*w,3*w]:kind==='dot'?[w,2*w]:kind==='dashdot'?[6*w,2*w,w,2*w]:[];
/** Variable-width edges are painted to one opaque coverage mask, then tinted once.
 * The dash phase is the cumulative perimeter length, rather than restarting at corners. */
export function paintStroke(ctx:CanvasRenderingContext2D,path:ShapePath,color:string,width:number,layer:Layer,vertices?:Point[]):void {
  const s=presentation(layer).stroke, widths=s.edgeWidths;
  if(!widths?.some(w=>w>0)&&width<=0)return;
  if(!layer.presentation)s.join='round';
  const alignment=s.alignment, variable=vertices?.length===4&&widths&&widths.some(w=>w!==widths[0]);
  ctx.save();ctx.globalCompositeOperation=compositeMode(presentation(layer).strokeBlendMode);ctx.strokeStyle=color;ctx.lineCap=s.cap;ctx.lineJoin=s.join;ctx.miterLimit=s.miterLimit;
  if(alignment!=='center'){ctx.beginPath();if(alignment==='outside'){const t=ctx.getTransform().inverse(),corners=[{x:0,y:0},{x:ctx.canvas.width,y:0},{x:ctx.canvas.width,y:ctx.canvas.height},{x:0,y:ctx.canvas.height}].map(p=>t.transformPoint(p));corners.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();}appendPath(ctx,path);ctx.clip(alignment==='outside'?'evenodd':'nonzero');}
  const factor=alignment==='center'?1:2;
  if(!variable){ctx.lineWidth=(widths?.[0]??width)*factor;ctx.setLineDash(pattern(s.dash,Math.max(1,widths?.[0]??width)));ctx.beginPath();appendPath(ctx,path);ctx.stroke();ctx.restore();return;}
  const t=ctx.getTransform(),flat=flattenForRender(path,{localToOutput:[t.a,t.b,t.c,t.d,0,0],tolerancePx:.25});if(!flat.ok){ctx.restore();throw Error(flat.problems[0].message);}
  const b=path.bounds,pad=Math.ceil(Math.max(...widths!)*factor*s.miterLimit*maxSingularValue([t.a,t.b,t.c,t.d,0,0])),points=[{x:b.x,y:b.y},{x:b.x+b.width,y:b.y},{x:b.x+b.width,y:b.y+b.height},{x:b.x,y:b.y+b.height}].map(p=>t.transformPoint(p)),x=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x)))-pad),y=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y)))-pad),right=Math.min(ctx.canvas.width,Math.ceil(Math.max(...points.map(p=>p.x)))+pad),bottom=Math.min(ctx.canvas.height,Math.ceil(Math.max(...points.map(p=>p.y)))+pad);
  if(right<=x||bottom<=y){ctx.restore();return;}
  const canvas=document.createElement('canvas');canvas.width=right-x;canvas.height=bottom-y;
  if(canvas.width*canvas.height*4>64*1024*1024){canvas.width=canvas.height=0;ctx.restore();throw Error('四边描边缓冲超过64MiB，未降低输出清晰度');}
  const mask=canvas.getContext('2d')!;mask.setTransform(t.a,t.b,t.c,t.d,t.e-x,t.f-y);mask.strokeStyle='#fff';mask.lineCap=s.cap;mask.lineJoin=s.join;mask.miterLimit=s.miterLimit;const dash=pattern(s.dash,Math.max(1,width));mask.setLineDash(dash);
  for(const sub of flat.value){let offset=0;const points=sub.closed?[...sub.points,sub.points[0]]:sub.points;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};let edge=0,best=Infinity;vertices!.forEach((v,j)=>{const d=distanceToSegment(mid,v,vertices![(j+1)%4]);if(d<best){best=d;edge=j;}});const w=widths![edge]*factor;if(w>0){mask.lineWidth=w;mask.lineDashOffset=-offset;mask.beginPath();mask.moveTo(a.x,a.y);mask.lineTo(b.x,b.y);mask.stroke();}offset+=Math.hypot(b.x-a.x,b.y-a.y);}}
  // Join the unequal offset lines, rather than letting disjoint butt ends leave
  // a corner gap. Rounded paths already replace these authored sharp vertices.
  mask.setLineDash([]);mask.fillStyle='#fff';
  const cross=(a:Point,b:Point)=>a.x*b.y-a.y*b.x,unit=(a:Point,b:Point)=>{const d=Math.hypot(b.x-a.x,b.y-a.y);return{x:(b.x-a.x)/d,y:(b.y-a.y)/d};};
  for(let i=0;i<4;i++){
    const v=vertices![i],prev=vertices![(i+3)%4],next=vertices![(i+1)%4],wp=widths![(i+3)%4]*factor/2,wc=widths![i]*factor/2;
    if(wp<=0||wc<=0||!flat.value.some(sub=>sub.points.some(p=>Math.hypot(p.x-v.x,p.y-v.y)<1e-6)))continue;
    const phase=vertices!.slice(0,i).reduce((n,p,j)=>n+Math.hypot(vertices![j+1].x-p.x,vertices![j+1].y-p.y),0),period=dash.reduce((a,b)=>a+b,0);let at=period?phase%period:0,on=true;for(let j=0;j<dash.length;j++){if(at<dash[j]){on=j%2===0;break;}at-=dash[j];}if(!on)continue;
    const a=unit(prev,v),b=unit(v,next),den=cross(a,b);if(Math.abs(den)<1e-8)continue;
    for(const sign of[-1,1]){const A={x:v.x-a.y*wp*sign,y:v.y+a.x*wp*sign},B={x:v.x-b.y*wc*sign,y:v.y+b.x*wc*sign},delta={x:B.x-A.x,y:B.y-A.y},distance=cross(delta,b)/den,q={x:A.x+distance*a.x,y:A.y+distance*a.y};mask.beginPath();mask.moveTo(v.x,v.y);mask.lineTo(A.x,A.y);if(s.join==='round')mask.quadraticCurveTo(q.x,q.y,B.x,B.y);else{if(s.join==='miter'&&Math.hypot(q.x-v.x,q.y-v.y)<=Math.max(wp,wc)*s.miterLimit)mask.lineTo(q.x,q.y);mask.lineTo(B.x,B.y);}mask.closePath();mask.fill();}
  }
  mask.setTransform(1,0,0,1,0,0);mask.globalCompositeOperation='source-in';mask.fillStyle=color;mask.fillRect(0,0,canvas.width,canvas.height);ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(canvas,x,y);canvas.width=canvas.height=0;ctx.restore();
}
