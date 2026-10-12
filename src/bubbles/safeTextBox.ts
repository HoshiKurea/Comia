import type { Point, Rect, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import type { ShapePath } from '../geometry/types';
import { pathToRegion } from '../geometry/renderRegion';
import { regionContains } from '../geometry/pathRegion';
import { regionInteriorPoint } from '../geometry/interiorPoint';
function distanceSquared(p:Point,a:Point,b:Point):number{const dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy,t=len?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len)):0,x=p.x-a.x-t*dx,y=p.y-a.y-t*dy;return x*x+y*y;}
import { segmentsIntersect } from '../geometry/polygon';

export function safeTextBox(body:ShapePath,borderMax:number):Result<Rect>{
  if(!Number.isFinite(borderMax)||borderMax<0)return fail(problem('bubble/safe-padding','对白描边内缩非法'));
  const parsed=pathToRegion(body);if(!parsed.ok)return parsed;
  const region=parsed.value,center=regionInteriorPoint(region);if(!center)return fail(problem('bubble/safe-area','主体没有有效内部区域'));
  const zero={x:center.x,y:center.y,width:0,height:0},padding=12+borderMax/2+.25;
  const segments: [Point,Point][]=[];
  for(const poly of region)for(const ring of poly)for(let i=0;i+1<ring.length;i++)segments.push([{x:ring[i][0],y:ring[i][1]},{x:ring[i+1][0],y:ring[i+1][1]}]);
  if(segments.some(([a,b])=>distanceSquared(center,a,b)<padding*padding))return ok(zero);
  const rectAt=(t:number):Rect=>{const width=t*body.bounds.width/Math.SQRT2,height=t*body.bounds.height/Math.SQRT2;return{x:center.x-width/2,y:center.y-height/2,width,height};};
  const accepts=(r:Rect):boolean=>{
    const corners=[{x:r.x,y:r.y},{x:r.x+r.width,y:r.y},{x:r.x+r.width,y:r.y+r.height},{x:r.x,y:r.y+r.height}];
    if(corners.some(p=>!regionContains(region,p)))return false;
    // With no boundary crossing and all four corners inside, the only possible
    // excluded component inside the rectangle is an entire hole. Test it too.
    if(region.some(poly=>poly.slice(1).some(ring=>ring.some(([x,y])=>x>=r.x&&x<=r.x+r.width&&y>=r.y&&y<=r.y+r.height))))return false;
    for(const [a,b] of segments){
      if(Math.max(a.x,b.x)<r.x-padding||Math.min(a.x,b.x)>r.x+r.width+padding||Math.max(a.y,b.y)<r.y-padding||Math.min(a.y,b.y)>r.y+r.height+padding)continue;
      for(let i=0;i<4;i++){
      const c=corners[i],d=corners[(i+1)%4];
      if(segmentsIntersect(a,b,c,d,1e-8)||Math.min(distanceSquared(a,c,d),distanceSquared(b,c,d),distanceSquared(c,a,b),distanceSquared(d,a,b))<padding*padding)return false;
    }
    }return true;
  };
  try{let lo=0,hi=1;for(let i=0;i<40;i++){const mid=(lo+hi)/2;if(accepts(rectAt(mid)))lo=mid;else hi=mid;}return ok(rectAt(lo));}catch(error){return fail(problem('bubble/safe-boolean',(error as Error).message));}
}
