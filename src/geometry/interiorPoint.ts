import type { Point } from '../domain/types';
import { regionArea, regionContains, type Region } from './pathRegion';
import { regionBounds } from './renderRegion';
import { distanceToSegment } from './simplePolygon';

function signedDistance(region:Region,p:Point):number{let d=Infinity;for(const poly of region)for(const ring of poly)for(let i=0;i+1<ring.length;i++)d=Math.min(d,distanceToSegment(p,{x:ring[i][0],y:ring[i][1]},{x:ring[i+1][0],y:ring[i+1][1]}));return(regionContains(region,p)?1:-1)*d;}
/** Editor-derived center only. Area centroid first, bounded polylabel fallback for concave shapes. */
export function regionInteriorPoint(region:Region):Point|null{
  if(regionArea(region)<=1e-8)return null;
  let area=0,cx=0,cy=0;
  for(const poly of region)for(const [index,ring] of poly.entries()){
    let a=0,x=0,y=0;for(let i=0;i+1<ring.length;i++){const p=ring[i],q=ring[i+1],c=p[0]*q[1]-q[0]*p[1];a+=c;x+=(p[0]+q[0])*c;y+=(p[1]+q[1])*c;}
    const sign=(index?-1:1)*Math.sign(a);area+=a*sign;cx+=x*sign;cy+=y*sign;
  }
  const centroid={x:cx/(3*area),y:cy/(3*area)};if(regionContains(region,centroid))return centroid;
  const bounds=regionBounds(region);
  type Cell={x:number;y:number;h:number;d:number;max:number};
  const heap:Cell[]=[],create=(x:number,y:number,h:number):Cell=>{const d=signedDistance(region,{x,y});return{x,y,h,d,max:d+h*Math.SQRT2};};
  const better=(a:Cell,b:Cell)=>a.max>b.max||a.max===b.max&&(a.y<b.y||a.y===b.y&&a.x<b.x);
  const push=(cell:Cell)=>{heap.push(cell);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(!better(cell,heap[p]))break;heap[i]=heap[p];i=p;}heap[i]=cell;};
  const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&better(heap[j+1],heap[j]))j++;if(!better(heap[j],last))break;heap[i]=heap[j];i=j;}heap[i]=last;}return first;};
  let best=create(bounds.x+bounds.width/2,bounds.y+bounds.height/2,0);
  push(create(best.x,best.y,Math.max(bounds.width,bounds.height)/2));
  for(let visited=0;heap.length&&visited<8192;visited++){
    const cell=pop();if(cell.d>best.d||cell.d===best.d&&(cell.y<best.y||cell.y===best.y&&cell.x<best.x))best=cell;
    if(cell.max-best.d<=.25)continue;const h=cell.h/2;
    for(const dx of [-h,h])for(const dy of [-h,h])push(create(cell.x+dx,cell.y+dy,h));
  }
  return best.d>=0?{x:best.x,y:best.y}:null;
}
