import type { InkStroke, Point } from '../domain/types';
import type { BackgroundFillSpec, PaintLayerSpec } from './types';
import { PAINT_LIMITS } from './model';
import { segmentsIntersect } from '../geometry/polygon';

export function strokeHit(s: InkStroke, p: Point, tolerance = 0): boolean {
  const radius=(pressure:number)=>s.width/2*(s.pressureMode==='pen'?.2+.8*pressure:1);
  return s.points.some((b,i)=>{const a=s.points[Math.max(0,i-1)],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
    return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)<=radius(a.pressure+(b.pressure-a.pressure)*t)+tolerance;});
}
/** Tests the swept eraser segments, so fast pointer jumps cannot miss a crossed line. */
export function strokeCrossesBrush(stroke:InkStroke,brush:InkStroke):boolean {
  const radius=(s:InkStroke,p:number)=>s.width/2*(s.pressureMode==='pen'?.2+.8*p:1);
  const near=(p:InkStroke['points'][0],source:InkStroke,a:InkStroke['points'][0],b:InkStroke['points'][0],other:InkStroke)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)<=radius(source,p.pressure)+radius(other,a.pressure+(b.pressure-a.pressure)*t);};
  return stroke.points.some((b,i)=>{const a=stroke.points[Math.max(0,i-1)];return brush.points.some((d,j)=>{const c=brush.points[Math.max(0,j-1)];return ((a.x!==b.x||a.y!==b.y)&&(c.x!==d.x||c.y!==d.y)&&segmentsIntersect(a,b,c,d,1e-8))||near(a,stroke,c,d,brush)||near(b,stroke,c,d,brush)||near(c,brush,a,b,stroke)||near(d,brush,a,b,stroke);});});
}
/** One filled nonzero path: translucent pressure strokes never darken at joins. */
const strokePaths=new WeakMap<InkStroke,Path2D>();
export function paintVectorStroke(ctx: CanvasRenderingContext2D, s: InkStroke, color=s.color): void {
  let path=strokePaths.get(s);if(!path){path=new Path2D();
  const target=path;
  const radius=(pressure:number)=>s.width/2*(s.pressureMode==='pen'?.2+.8*pressure:1);
  for(let i=0;i<s.points.length;i++){
    const b=s.points[i],rb=radius(b.pressure);target.moveTo(b.x+rb,b.y);target.arc(b.x,b.y,rb,0,2*Math.PI);
    if(!i)continue;const a=s.points[i-1],ra=radius(a.pressure),dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);if(d<=Math.abs(rb-ra)||!d)continue;
    const ex=dx/d,ey=dy/d,k=(ra-rb)/d,q=Math.sqrt(1-k*k),nx=ex*k-ey*q,ny=ey*k+ex*q,mx=ex*k+ey*q,my=ey*k-ex*q;
    target.moveTo(a.x+mx*ra,a.y+my*ra);target.lineTo(b.x+mx*rb,b.y+my*rb);target.lineTo(b.x+nx*rb,b.y+ny*rb);target.lineTo(a.x+nx*ra,a.y+ny*ra);target.closePath();
  }
  strokePaths.set(s,path);}
  ctx.save();ctx.globalAlpha*=s.opacity;ctx.fillStyle=color;ctx.fill(path,'nonzero');ctx.restore();
}
const TILE=256,cache=new Map<string,HTMLCanvasElement>(),ids=new WeakMap<InkStroke,number>();let sequence=0;
const id=(s:InkStroke)=>{let n=ids.get(s);if(!n){n=++sequence;ids.set(s,n);}return n;};
export const paintCacheStats=()=>({tiles:cache.size,bytes:cache.size*TILE*TILE*4});
export function clearPaintCache(): void {for(const c of cache.values())c.width=c.height=0;cache.clear();}
function tilesFor(s:InkStroke,width:number,height:number): Set<string> {
  const out=new Set<string>();
  // Segment boxes, not the entire diagonal's bounding box.
  s.points.forEach((b,i)=>{const a=s.points[Math.max(0,i-1)],r=s.width/2+1,x0=Math.max(0,Math.floor((Math.min(a.x,b.x)-r)/TILE)),x1=Math.min(Math.ceil(width/TILE)-1,Math.floor((Math.max(a.x,b.x)+r)/TILE)),y0=Math.max(0,Math.floor((Math.min(a.y,b.y)-r)/TILE)),y1=Math.min(Math.ceil(height/TILE)-1,Math.floor((Math.max(a.y,b.y)+r)/TILE));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const dx=b.x-a.x,dy=b.y-a.y,tests=[[-dx,a.x-(x*TILE-r)],[dx,(x+1)*TILE+r-a.x],[-dy,a.y-(y*TILE-r)],[dy,(y+1)*TILE+r-a.y]];let enter=0,leave=1,hit=true;
      for(const [p,q]of tests){if(Math.abs(p)<1e-12){if(q<0){hit=false;break;}}else if(p<0)enter=Math.max(enter,q/p);else leave=Math.min(leave,q/p);}
      if(hit&&enter<=leave)out.add(`${x},${y}`);
    }});return out;
}
export function paintLayer(ctx:CanvasRenderingContext2D,spec:PaintLayerSpec): void {
  ctx.save();ctx.beginPath();ctx.rect(0,0,spec.width,spec.height);ctx.clip();
  try{
    if(spec.mode==='vector'){for(const s of spec.strokes)paintVectorStroke(ctx,s);return;}
    const tiles=new Map<string,InkStroke[]>();for(const s of spec.strokes)for(const key of tilesFor(s,spec.width,spec.height)){const row=tiles.get(key)??[];row.push(s);tiles.set(key,row);}
    for(const [location,strokes] of tiles){const [x,y]=location.split(',').map(Number);ctx.drawImage(rasterTile(x,y,strokes),x*TILE,y*TILE);}
  }finally{ctx.restore();}
}
function rasterTile(x:number,y:number,strokes:InkStroke[]):HTMLCanvasElement {
  const key=`${x},${y}:`+strokes.map(id).join(',');let canvas=cache.get(key);
  if(canvas){cache.delete(key);cache.set(key,canvas);return canvas;}
  canvas=document.createElement('canvas');canvas.width=canvas.height=TILE;const c=canvas.getContext('2d')!;c.translate(-x*TILE,-y*TILE);
  for(const s of strokes){c.save();c.globalCompositeOperation=s.tool==='eraser'?'destination-out':'source-over';paintVectorStroke(c,s,s.tool==='eraser'?'#000000FF':s.color);c.restore();}
  cache.set(key,canvas);while(cache.size*TILE*TILE*4>PAINT_LIMITS.tileBytes){const oldest=cache.keys().next().value!,old=cache.get(oldest)!;cache.delete(oldest);old.width=old.height=0;}return canvas;
}
export function paintContains(spec:PaintLayerSpec,p:Point):boolean {
  if(p.x<0||p.y<0||p.x>=spec.width||p.y>=spec.height)return false;
  if(spec.mode==='vector')return spec.strokes.some(s=>s.opacity>0&&s.color.slice(-2)!=='00'&&strokeHit(s,p));
  const x=Math.floor(p.x/TILE),y=Math.floor(p.y/TILE),key=`${x},${y}`,strokes=spec.strokes.filter(s=>tilesFor(s,spec.width,spec.height).has(key));if(!strokes.length)return false;
  return rasterTile(x,y,strokes).getContext('2d')!.getImageData(Math.floor(p.x)-x*TILE,Math.floor(p.y)-y*TILE,1,1).data[3]>0;
}
/** Tone frequency is lines per inch: native period=dpi/LPI. No document pixels are stored. */
export function paintBackgroundFill(ctx:CanvasRenderingContext2D,s:BackgroundFillSpec): void {
  ctx.save();ctx.beginPath();ctx.rect(0,0,s.width,s.height);ctx.clip();
  try{
    if(s.mode==='solid'){ctx.fillStyle=s.color;ctx.fillRect(0,0,s.width,s.height);return;}
    const angle=s.angle*Math.PI/180;
    if(s.mode==='gradient'){const dx=Math.cos(angle),dy=Math.sin(angle),extent=Math.abs(dx)*s.width/2+Math.abs(dy)*s.height/2,g=ctx.createLinearGradient(s.width/2-dx*extent,s.height/2-dy*extent,s.width/2+dx*extent,s.height/2+dy*extent);g.addColorStop(0,s.color);g.addColorStop(1,s.secondary);ctx.fillStyle=g;ctx.fillRect(0,0,s.width,s.height);return;}
    ctx.fillStyle=s.secondary;ctx.fillRect(0,0,s.width,s.height);if(s.density===0)return;if(s.density===100){ctx.fillStyle=s.color;ctx.fillRect(0,0,s.width,s.height);return;}
    const period=s.dpi/s.frequency,side=64,tile=document.createElement('canvas');tile.width=tile.height=side;const c=tile.getContext('2d')!,rho=s.density/100;
    if(rho>.5){c.fillStyle=s.color;c.fillRect(0,0,side,side);c.globalCompositeOperation='destination-out';}
    c.fillStyle=rho>.5?'#000000':s.color;c.beginPath();c.arc(side/2,side/2,side*Math.sqrt((rho>.5?1-rho:rho)/Math.PI),0,2*Math.PI);c.fill();
    const pattern=ctx.createPattern(tile,'repeat');if(!pattern)throw Error('无法创建网点图案');pattern.setTransform(new DOMMatrix().translate(s.width/2,s.height/2).rotate(s.angle).scale(period/side));ctx.fillStyle=pattern;ctx.fillRect(0,0,s.width,s.height);
  }finally{ctx.restore();}
}
