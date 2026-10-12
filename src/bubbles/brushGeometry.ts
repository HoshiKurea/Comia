import {fail,ok,problem,type BubbleBrushOptions,type BubbleContour,type Mat,type Point,type Result} from '../domain/types';
import {apply,multiply,translation} from '../geometry/matrix';
import {flattenForRender} from '../geometry/flattenForBoolean';
import {polyBounds,segmentsIntersect} from '../geometry/polygon';
import {buildContourPath} from './handDrawn';
import {parseBubbleBrushOptions} from './brushOptions';
interface StrokeContour {origin:Point;width:number;height:number;contour:BubbleContour}
const interpolate=(a:Point,b:Point,t:number):Point=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const distanceSquared=(p:Point,a:Point,b:Point)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1))),x=p.x-a.x-t*dx,y=p.y-a.y-t*dy;return x*x+y*y;};
/** Exact nearest-edge BVH. Bounding-box lower bounds prune work, never accuracy. */
function edgeQuery(points:readonly Point[]){
 type Edge={a:Point;b:Point;index:number};type Node={x0:number;y0:number;x1:number;y1:number;edges?:Edge[];left?:Node;right?:Node};
 const build=(edges:Edge[]):Node=>{const x0=Math.min(...edges.flatMap(e=>[e.a.x,e.b.x])),x1=Math.max(...edges.flatMap(e=>[e.a.x,e.b.x])),y0=Math.min(...edges.flatMap(e=>[e.a.y,e.b.y])),y1=Math.max(...edges.flatMap(e=>[e.a.y,e.b.y]));if(edges.length<=6)return{x0,y0,x1,y1,edges};const x=x1-x0>=y1-y0;edges.sort((a,b)=>(x?a.a.x+a.b.x-b.a.x-b.b.x:a.a.y+a.b.y-b.a.y-b.b.y)||a.index-b.index);const half=edges.length>>1;return{x0,y0,x1,y1,left:build(edges.slice(0,half)),right:build(edges.slice(half))};};
 const root=build(points.map((a,i)=>({a,b:points[(i+1)%points.length],index:i})));
 return(p:Point)=>{let squared=Infinity,index=0;const bound=(n:Node)=>{const dx=Math.max(n.x0-p.x,0,p.x-n.x1),dy=Math.max(n.y0-p.y,0,p.y-n.y1);return dx*dx+dy*dy;};const visit=(n:Node)=>{if(bound(n)>squared+1e-12)return;if(n.edges){for(const e of n.edges){const d=distanceSquared(p,e.a,e.b);if(d<squared||d===squared&&e.index<index){squared=d;index=e.index;}}}else{const a=n.left!,b=n.right!;if(bound(a)<=bound(b)){visit(a);visit(b);}else{visit(b);visit(a);}}};visit(root);return{squared,index};};
}
/** Fit in screen space; geometry and persisted nodes stay in the owning container's coordinates. */
export function bubbleContourFromStroke(raw:readonly Point[],options:BubbleBrushOptions,localToScreen:Mat):Result<StrokeContour>{
 const parsed=parseBubbleBrushOptions(options);if(!parsed.ok)return parsed;
 if(raw.length<3||raw.length>4096||raw.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return fail(problem('bubble-brush/points','单笔需要3～4096个有限点'));
 if(localToScreen.length!==6||localToScreen.some(v=>!Number.isFinite(v))||Math.abs(localToScreen[0]*localToScreen[3]-localToScreen[1]*localToScreen[2])<1e-8)return fail(problem('bubble-brush/matrix','屏幕矩阵必须有限且可逆'));
 const points=raw.filter((p,i)=>!i||Math.hypot(p.x-raw[i-1].x,p.y-raw[i-1].y)>1e-9).map(p=>({...p})),screen=points.map(p=>apply(localToScreen,p));
 if(screen.length<3)return fail(problem('bubble-brush/short','请画出完整轮廓'));
 if(Math.hypot(screen[0].x-screen.at(-1)!.x,screen[0].y-screen.at(-1)!.y)>options.closeScreenPx)return fail(problem('bubble-brush/open','轮廓未闭合，请将终点接近起点或继续修正'));
 if(Math.hypot(screen[0].x-screen.at(-1)!.x,screen[0].y-screen.at(-1)!.y)<1e-7){points.pop();screen.pop();}
 const bounds=polyBounds(points);if(bounds.width<16||bounds.height<16||bounds.width>16384||bounds.height>16384)return fail(problem('bubble-brush/size','气泡需要16～16384局部px宽高'));
 let area=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];area+=a.x*b.y-b.x*a.y;for(let j=i+1;j<points.length;j++){if(j===i+1||(j+1)%points.length===i)continue;if(segmentsIntersect(a,b,points[j],points[(j+1)%points.length],1e-9))return fail(problem('bubble-brush/self-intersection','笔迹自交，请重新圈出一个不相交轮廓'));}}
 if(Math.abs(area)/2<4)return fail(problem('bubble-brush/area','轮廓面积须不小于4px²'));
 const lengths=screen.map((p,i)=>Math.hypot(p.x-screen[(i+1)%screen.length].x,p.y-screen[(i+1)%screen.length].y)),positions=[0];lengths.forEach(n=>positions.push(positions.at(-1)!+n));const total=positions.at(-1)!;
 const at=(s:number)=>{let i=positions.findIndex((v,i)=>i<screen.length&&v<=s&&s<=positions[i+1]);if(i<0)i=screen.length-1;return interpolate(points[i],points[(i+1)%points.length],(s-positions[i])/(lengths[i]||1));};
 // Uniform samples give a certified <=eps discrete covering of each raw segment.
 const eps=Math.min(.0625,options.simplifyScreenPx/16),samples:{p:Point;s:number}[]=[];
 for(let i=0;i<screen.length;i++){const count=Math.max(1,Math.ceil(lengths[i]/(eps*2)));if(samples.length+count>65536)return fail(problem('bubble-brush/work-budget','笔迹核验超出工作预算，请缩短轮廓'));for(let j=0;j<count;j++)samples.push({p:interpolate(screen[i],screen[(i+1)%screen.length],j/count),s:positions[i]+lengths[i]*j/count});}
 const rawQuery=edgeQuery(screen);
 const anchors=Array.from({length:8},(_,i)=>i*total/8);
 let lastError='轮廓需要更多控制点';
 for(let count=8;count<=32;count++){
  anchors.sort((a,b)=>a-b);let greedyWorst=total*(count-.5)/count;
  // Nonuniform Catmull handles can overshoot after inserting near a neighbor.
  // Also certify a uniform candidate at the SAME node count and SAME tolerance;
  // never relax the fit threshold or refuse a representable closed oval.
  for(const candidate of [anchors,...(count>8?[Array.from({length:count},(_,i)=>i*total/count)]:[])]){
  const contour:BubbleContour={tension:options.smoothing,nodes:candidate.map(s=>{const p=at(s);return{x:(p.x-bounds.x)/bounds.width,y:(p.y-bounds.y)/bounds.height};})};
  const path=buildContourPath(contour,bounds.width,bounds.height);let curve:Point[]=[];
  if(path.ok){const flat=flattenForRender(path.value,{localToOutput:multiply(localToScreen,translation(bounds.x,bounds.y)),tolerancePx:eps});if(!flat.ok)return flat;curve=flat.value[0].points.map(p=>apply(localToScreen,{x:p.x+bounds.x,y:p.y+bounds.y}));}else lastError=path.problems[0].message;
  let maximum=-1,worst=total*(count-.5)/count;
  if(curve.length){
   const curveQuery=edgeQuery(curve);
   for(const sample of samples){const d=Math.sqrt(curveQuery(sample.p).squared);if(d>maximum+1e-9||Math.abs(d-maximum)<=1e-9&&sample.s<worst){maximum=d;worst=sample.s;}}
   // Reverse covering: vertices plus segment interior samples bound curves-to-raw distance.
   for(let i=0;i<curve.length;i++){const a=curve[i],b=curve[(i+1)%curve.length],n=Math.max(1,Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)/(eps*2)));for(let j=0;j<n;j++){const p=interpolate(a,b,j/n);const nearest=rawQuery(p),d=nearest.squared,k=nearest.index,pa=screen[k],pb=screen[(k+1)%screen.length],dx=pb.x-pa.x,dy=pb.y-pa.y,t=Math.max(0,Math.min(1,((p.x-pa.x)*dx+(p.y-pa.y)*dy)/(dx*dx+dy*dy||1))),s=positions[k]+lengths[k]*t;if(Math.sqrt(d)>maximum+1e-9){maximum=Math.sqrt(d);worst=s;}}}
   if(maximum+eps*2<=options.simplifyScreenPx)return ok({origin:{x:bounds.x,y:bounds.y},width:bounds.width,height:bounds.height,contour});
  }
  if(candidate===anchors)greedyWorst=worst;
  }
  let worst=greedyWorst;
  if(count===32)break;
  if(anchors.some(s=>Math.abs(s-worst)<total*1e-6)){let gap=-1,index=0;for(let i=0;i<anchors.length;i++){const length=(i+1===anchors.length?total:anchors[i+1])-anchors[i];if(length>gap){gap=length;index=i;}}worst=anchors[index]+gap/2;}
  anchors.push(Math.max(0,Math.min(total-1e-9,worst)));
 }
 return fail(problem('bubble-brush/fit',`32节点内未达到${options.simplifyScreenPx}px屏幕拟合精度（${lastError}），请降低轮廓复杂度或增加拟合容差`));
}
