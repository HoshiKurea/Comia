import type { BubbleContour, BubbleLayer, BubbleEdgeStyle, HandDrawnStyle, Point, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import type { ShapePath } from '../geometry/types';
import { polyBounds, segmentsIntersect } from '../geometry/polygon';
import { pathBounds } from '../geometry/bounds';
import { IDENTITY } from '../geometry/matrix';
import { flattenForBoolean, LOCAL_TARGET,type GeometryTarget } from '../geometry/flattenForBoolean';
import {deriveBubbleEdge} from './derivedEdge';
import { legacyBodyPath } from './body';
import { parseBubbleContour } from '../domain/mangaValidation';
import { freehandBody } from '../freehand/geometry';

type BodyInput = Pick<BubbleLayer, 'shape' | 'width' | 'height' | 'style' | 'handDrawn' | 'contour' | 'freehandSource'> & {edgeStyle?:BubbleEdgeStyle};
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function handDrawnPreset(preset: 'soft' | 'rough', seed = 42): HandDrawnStyle {
  return preset === 'soft' ? { preset, seed, wobble: .004, irregularity: .035, pressure: .15 } : { preset, seed, wobble: .012, irregularity: .08, pressure: .4 };
}
function sampleArc(points: Point[], fraction: number): Point {
  const lengths = points.map((p, i) => Math.hypot(p.x - points[(i + 1) % points.length].x, p.y - points[(i + 1) % points.length].y));
  const target = fraction * lengths.reduce((a,b)=>a+b,0); let s = 0;
  for (let i=0;i<points.length;i++) { if (s + lengths[i] >= target) { const t = (target-s)/(lengths[i]||1), a=points[i], b=points[(i+1)%points.length]; return { x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t }; } s += lengths[i]; }
  return points[0];
}
export function buildContourPath(contour: BubbleContour, w: number, h: number, angular = false): Result<ShapePath> {
  const parsed = parseBubbleContour(contour, 'contour'); if (!parsed.ok || !parsed.value) return parsed.ok ? fail(problem('bubble/contour', '手调轮廓不能为空')) : parsed;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 16 || h < 16 || w > 16384 || h > 16384) return fail(problem('bubble/size', '气泡宽高16～16384'));
  const points = contour.nodes.map(p=>({x:p.x*w,y:p.y*h})), ops: ShapePath['ops'] = [{op:'M',p:points[0]}], n=points.length, k=(1-contour.tension)/6;
  for(let i=0;i<n;i++){
    const prev=points[(i+n-1)%n], a=points[i], b=points[(i+1)%n], next=points[(i+2)%n];
    if(angular) ops.push({op:'L',p:b});
    else ops.push({op:'C',c1:{x:a.x+k*(b.x-prev.x),y:a.y+k*(b.y-prev.y)},c2:{x:b.x-k*(next.x-a.x),y:b.y-k*(next.y-a.y)},p:b});
  }
  ops.push({op:'Z'}); const draft={ops,bounds:polyBounds(points)}, bounds=pathBounds(draft,IDENTITY);
  if(!bounds || bounds.x < -.05*w-1e-8 || bounds.y < -.05*h-1e-8 || bounds.x+bounds.width > 1.05*w+1e-8 || bounds.y+bounds.height > 1.05*h+1e-8) return fail(problem('bubble/contour-bounds','轮廓超出主体允许范围'));
  const flat=flattenForBoolean(draft,LOCAL_TARGET);if(!flat.ok)return flat;
  const ring=flat.value[0];let area=0;
  for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length];area+=a.x*b.y-b.x*a.y;
    if(Math.hypot(a.x-b.x,a.y-b.y)<1e-8)return fail(problem('bubble/contour-edge','轮廓含重复点'));
  }
  const edges=ring.map((a,i)=>{const b=ring[(i+1)%ring.length];return{a,b,i,minX:Math.min(a.x,b.x),maxX:Math.max(a.x,b.x),minY:Math.min(a.y,b.y),maxY:Math.max(a.y,b.y)};}).sort((a,b)=>a.minX-b.minX||a.i-b.i);
  let active: typeof edges=[];
  for(const edge of edges){active=active.filter(e=>e.maxX>=edge.minX-1e-8);for(const e of active){if(e.maxY<edge.minY-1e-8||edge.maxY<e.minY-1e-8||Math.abs(e.i-edge.i)===1||Math.abs(e.i-edge.i)===ring.length-1)continue;if(segmentsIntersect(edge.a,edge.b,e.a,e.b,1e-8))return fail(problem('bubble/contour-self-intersection','轮廓存在自交，请修正节点'));}active.push(edge);}
  if(Math.abs(area)/2<4)return fail(problem('bubble/contour-area','轮廓面积须不小于4px²'));
  return ok({ops,bounds});
}
export function generateContour(bubble: BodyInput): Result<BubbleContour> {
  if(bubble.contour){const checked=buildContourPath(bubble.contour,bubble.width,bubble.height,bubble.shape==='spiky');return checked.ok?ok(structuredClone(bubble.contour)):checked;}
  const hand=bubble.handDrawn??handDrawnPreset('soft'), n=bubble.shape==='cloud'||bubble.shape==='spiky'||bubble.shape==='wave'?24:hand.preset==='rough'?16:12;
  const random=mulberry32(hand.seed), phases=Array.from({length:4},()=>random()*2*Math.PI);
  let source:Point[]|null=null;
  if(['rect','roundRect','circle'].includes(bubble.shape)){
    const flat=flattenForBoolean(legacyBodyPath(bubble.shape as 'rect'|'roundRect'|'circle',bubble.width,bubble.height,bubble.style));if(!flat.ok)return flat;source=flat.value[0];
  }
  for(let attempt=0;attempt<8;attempt++){
    const q=hand.irregularity*2**(-attempt),j=hand.wobble*2**(-attempt);
    const nodes=Array.from({length:n},(_,i)=>{
      const theta=2*Math.PI*i/n,low=q*(.6*Math.sin(theta+phases[0])+.4*Math.sin(2*theta+phases[1])), high=j*(.5*Math.sin(5*theta+phases[2])+.5*Math.sin(9*theta+phases[3]));
      const factor=(1+low+high)/(1+q+j);let rx=.5,ry=.5,r=1;
      if(bubble.shape==='wave')r=(1+.07*Math.cos(6*theta))/1.07;
      else if(bubble.shape==='cloud')r=(1+.08*Math.cos(12*theta))/1.08;
      else if(bubble.shape==='spiky')r=i%2===0?1:.76;
      else if(bubble.shape==='handPolygon')rx=ry=Math.min(.46/Math.abs(Math.cos(theta)),.46/Math.abs(Math.sin(theta)));
      if(source){const p=sampleArc(source,i/n),prior=sampleArc(source,(i/n-1/(n*8)+1)%1),next=sampleArc(source,(i/n+1/(n*8))%1),dx=p.x-bubble.width/2,dy=p.y-bubble.height/2,tx=next.x-prior.x,ty=next.y-prior.y,len=Math.hypot(tx,ty)||1;let nx=-ty/len,ny=tx/len;if(nx*dx+ny*dy<0){nx=-nx;ny=-ny;}const displacement=high*Math.min(bubble.width,bubble.height),scale=(1+low)/(1+q+j);return{x:.5+(dx*scale+nx*displacement)/bubble.width,y:.5+(dy*scale+ny*displacement)/bubble.height};}
      return{x:.5+rx*r*factor*Math.cos(theta),y:.5+ry*r*factor*Math.sin(theta)};
    });
    const contour={nodes,tension:.2},path=buildContourPath(contour,bubble.width,bubble.height,bubble.shape==='spiky');if(path.ok)return ok(contour);
  }
  return fail(problem('bubble/generation','该尺寸无法生成合法手绘轮廓，原形状保留'));
}
export function mangaBaseBodyPath(bubble: BodyInput): Result<ShapePath> {
  if(bubble.shape==='freehand')return bubble.freehandSource?freehandBody(bubble.freehandSource,bubble.width,bubble.height):fail(problem('drawing/source','自由气泡缺少绘画源'));
  // A manual contour is already the authored input. Build/validate it once;
  // generateContour would validate, clone, and then validate the same curve
  // again. Keep the complete legality/bounds/self-intersection checks.
  if(bubble.contour)return buildContourPath(bubble.contour,bubble.width,bubble.height,bubble.shape==='spiky');
  if(!bubble.contour&&(!bubble.handDrawn||bubble.handDrawn.wobble===0&&bubble.handDrawn.irregularity===0)&&['rect','roundRect','circle','cloud','spiky'].includes(bubble.shape))return ok(legacyBodyPath(bubble.shape as 'rect'|'roundRect'|'circle'|'cloud'|'spiky',bubble.width,bubble.height,bubble.style));
  const contour=generateContour(bubble);return contour.ok?buildContourPath(contour.value,bubble.width,bubble.height,bubble.shape==='spiky'):contour;
}
export function mangaBodyPath(bubble:BodyInput,target:GeometryTarget=LOCAL_TARGET):Result<ShapePath>{
 if(bubble.shape==='freehand'){
   if(!bubble.freehandSource)return fail(problem('drawing/source','自由气泡缺少绘画源'));
   const path=freehandBody(bubble.freehandSource,bubble.width,bubble.height,target);
   return path.ok&&bubble.edgeStyle?.wobble?deriveBubbleEdge(path.value,bubble.width,bubble.height,bubble.edgeStyle,target):path;
 }
 const derived=bubble.edgeStyle?.recipe==='normal-offset-v1'&&((bubble.edgeStyle.wobble>0)||!bubble.handDrawn?.wobble);
 const base=mangaBaseBodyPath(derived&&bubble.handDrawn?{...bubble,handDrawn:{...bubble.handDrawn,wobble:0}}:bubble);return base.ok&&derived&&bubble.edgeStyle?deriveBubbleEdge(base.value,bubble.width,bubble.height,bubble.edgeStyle,target):base;
}
