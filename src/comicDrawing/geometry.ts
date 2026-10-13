import type { InkSample, Mat, Point } from '../domain/types';
import { apply } from '../geometry/matrix';
import { polyBounds } from '../geometry/polygon';
import type { ShapePath } from '../geometry/types';
import { mulberry32 } from '../bubbles/handDrawn';
import type { BubblePenSettings, FlashOptions } from './types';
import { flashRayCount } from './model';

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x-a.x, dy = b.y-a.y, t = Math.max(0, Math.min(1, ((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
/** Screen-space RDP; smoothing never moves endpoints or protected sharp corners. */
export function correctPen(raw: readonly InkSample[], matrix: Mat, o: BubblePenSettings): InkSample[] {
  if (raw.length < 3) return raw.map(p=>({...p}));
  const screen = raw.map(p=>apply(matrix,p)), smooth = raw.map(p=>({...p}));
  for(let i=1;i<raw.length-1;i++) {
    const a=screen[i-1],b=screen[i],c=screen[i+1],u={x:a.x-b.x,y:a.y-b.y},v={x:c.x-b.x,y:c.y-b.y};
    const corner=(u.x*v.x+u.y*v.y)/((Math.hypot(u.x,u.y)*Math.hypot(v.x,v.y))||1)>-.5;
    if(o.sharpCorners&&corner)continue;
    const k=o.stabilization; smooth[i]={...raw[i],x:raw[i].x*(1-k)+(raw[i-1].x+raw[i+1].x)*k/2,y:raw[i].y*(1-k)+(raw[i-1].y+raw[i+1].y)*k/2};
  }
  if(o.postCorrection===0)return smooth;
  const points=smooth.map(p=>apply(matrix,p)),keep=new Set([0,raw.length-1]),stack:[[number,number]]|[number,number][]=[[0,raw.length-1]];
  const arc=[0];for(let i=1;i<points.length;i++)arc.push(arc[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y));
  while(stack.length){const[a,b]=stack.pop()!;let best=1,index=-1;for(let i=a+1;i<b;i++){const t=(arc[i]-arc[a])/(arc[b]-arc[a]||1),pressure=Math.abs(raw[i].pressure-raw[a].pressure-(raw[b].pressure-raw[a].pressure)*t),score=Math.max(segmentDistance(points[i],points[a],points[b])/o.postCorrection,o.pressure?pressure/.02:0);if(score>best){best=score;index=i;}}if(index>=0){keep.add(index);stack.push([a,index],[index,b]);}}
  return [...keep].sort((a,b)=>a-b).map(i=>smooth[i]);
}
/** Arc-length spaced rays on an elliptical reference line, with deterministic jitter. */
export function flashPaths(width: number, height: number, o: FlashOptions): ShapePath[] {
  const a=width/2,b=height/2,count=flashRayCount(width,height,o);
  if(count>2048)throw Error('效果线超过2048条，请增加间距；未自动降低密度');
  const random=mulberry32(o.seed),table: {t:number;s:number}[]=[{t:0,s:0}]; let last={x:a,y:0},arc=0;
  for(let i=1;i<=2048;i++){const t=i/2048*2*Math.PI,p={x:a*Math.cos(t),y:b*Math.sin(t)};arc+=Math.hypot(p.x-last.x,p.y-last.y);table.push({t,s:arc});last=p;}
  let cursor=0;const paths:ShapePath[]=[];
  for(let i=0;i<count;i++){
    const target=arc*(i+.35*random())/count;while(cursor<table.length-2&&table[cursor+1].s<target)cursor++;
    const lo=table[cursor],hi=table[cursor+1],t=o.spacingMode==='angle'?target/arc*2*Math.PI:lo.t+(hi.t-lo.t)*(target-lo.s)/(hi.s-lo.s);
    const dx=Math.cos(t),dy=Math.sin(t),r=o.spacingMode==='angle'?1/Math.sqrt((dx/a)**2+(dy/b)**2):Math.hypot(a*dx,b*dy),ux=o.spacingMode==='angle'?dx:a*dx/r,uy=o.spacingMode==='angle'?dy:b*dy/r;
    const jitter=(random()-.5)*2*o.referenceJitter,base=Math.max(r*.25,r+jitter), length=o.length*(1-o.lengthJitter*random()),w=o.brushSize*(.35+.65*random());
    const inner=Math.max(r*.25,base-(o.jagged?w*(1+random()*2):0)),outer=base+length;
    const p=(radius:number,side=0):Point=>({x:a+ux*radius-uy*side,y:b+uy*radius+ux*side});
    const ring=o.preset==='firework'?[p(base+length*.15),p(outer-length*.12,w/2),p(outer),p(outer-length*.12,-w/2)]:[p(inner),p(outer-length*.3,w/2),p(outer),p(outer-length*.3,-w/2)];
    paths.push({ops:[{op:'M',p:ring[0]},...ring.slice(1).map(p=>({op:'L' as const,p})),{op:'Z'}],bounds:polyBounds(ring)});
  }
  return paths;
}
