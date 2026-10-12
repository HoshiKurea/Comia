import clipping from 'polygon-clipping';
import type { Id, Mat, Rect, RGBA, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import type { Region } from '../geometry/pathRegion';
import { checkedUnion, regionEdges, transformRegion } from '../geometry/renderRegion';
import { MANGA } from '../domain/limits';

export interface OwnedFill { id: Id; exclusive: Region; overlap: Region }
export function partitionOverlap(input: readonly { id: Id; region: Region }[]): Result<{ overlap: Region; parts: OwnedFill[] }> {
  try {
    let all: Region = [], overlap: Region = [], higher: Region = [];
    for (const item of input) { const intersections = clipping.intersection(all, item.region); const o=checkedUnion([overlap, intersections], MANGA.booleanEdgesPerGroup); if(!o.ok)return o; overlap=o.value; const u=checkedUnion([all,item.region],MANGA.booleanEdgesPerGroup);if(!u.ok)return u;all=u.value; }
    const parts: OwnedFill[] = [];
    for (const item of [...input].reverse()) {
      const owned=clipping.difference(item.region,higher), exclusive=clipping.difference(owned,overlap), shared=clipping.intersection(owned,overlap);
      if(regionEdges(exclusive)+regionEdges(shared)>MANGA.booleanEdgesPerGroup)return fail(problem('dialogue/partition-budget','交区划分超过边预算'));
      parts.unshift({id:item.id,exclusive,overlap:shared});const u=checkedUnion([higher,item.region],MANGA.booleanEdgesPerGroup);if(!u.ok)return u;higher=u.value;
    }
    return ok({overlap,parts});
  } catch(e) { return fail(problem('dialogue/partition',(e as Error).message)); }
}
export interface ColoredRegion { region: Region; color: RGBA; multiplier: number; shared?:boolean }
interface Edge { lo:number; hi:number; slope:number; intercept:number }
interface ScanPart { edges:Edge[]; color:number[]; alpha:number; shared:boolean }
/** Reusable output-coordinate active edges. No preview bitmap is scaled for export. */
export function prepareCoverage(parts: readonly ColoredRegion[], matrix:Mat): ScanPart[] {
  return parts.filter(p=>p.region.length).map(part=>{
    const edges:Edge[]=[];
    for(const polygon of transformRegion(part.region,matrix))for(const ring of polygon)for(let i=0;i+1<ring.length;i++){
      const a=ring[i],b=ring[i+1];if(a[1]===b[1])continue;const slope=(b[0]-a[0])/(b[1]-a[1]);edges.push({lo:Math.min(a[1],b[1]),hi:Math.max(a[1],b[1]),slope,intercept:a[0]-slope*a[1]});
    }
    edges.sort((a,b)=>a.lo-b.lo);
    const color=[0,1,2,3].map(i=>parseInt(part.color.slice(1+i*2,3+i*2),16));
    return {edges,color,alpha:color[3]/255*part.multiplier,shared:part.shared??false};
  });
}
export interface CoverageTile {
  width:number;height:number;owners:Uint8Array;
  pixels:Uint16Array;partIds:Uint8Array;weights:Float64Array;
  parts:readonly {color:readonly number[];alpha:number;shared:boolean}[];bytes:number;
}
/** Retain unrounded geometric area: one owner byte for full pixels,
 * Float64 weights for boundary mixtures. Use the same vertex/integer-x cuts. */
export function compileCoverageTile(parts:readonly ScanPart[],tile:Rect):Result<CoverageTile>{
  const {x,y,width,height}=tile;
  if(![x,y,width,height].every(Number.isInteger)||width<1||height<1||width>128||height>128||parts.length>32)return fail(problem('dialogue/tile','积分块须为整数坐标、不超过128×128和32个互斥填充'));
  const owners=new Uint8Array(width*height),fractions:{pixel:number;part:number;weight:number}[]=[];
  parts.forEach((part,partId)=>{
    if(part.alpha===0)return;const sums=new Float64Array(width*height),candidates=part.edges.filter(e=>e.lo<y+height&&e.hi>y);
    for(let row=0;row<height;row++){
      const low=y+row,high=low+1,edges=candidates.filter(e=>e.lo<high&&e.hi>low),cuts=[low,high];
      for(const edge of edges){if(edge.lo>low)cuts.push(edge.lo);if(edge.hi<high)cuts.push(edge.hi);
        if(edge.slope!==0){const a=Math.max(low,edge.lo),b=Math.min(high,edge.hi),xa=edge.slope*a+edge.intercept,xb=edge.slope*b+edge.intercept;
          for(let k=Math.max(x,Math.ceil(Math.min(xa,xb)));k<=Math.min(x+width,Math.floor(Math.max(xa,xb)));k++){const yy=(k-edge.intercept)/edge.slope;if(yy>a&&yy<b)cuts.push(yy);}
        }
      }
      const ys=[...new Set(cuts)].sort((a,b)=>a-b);
      for(let band=1;band<ys.length;band++){
        const a=ys[band-1],b=ys[band],mid=(a+b)/2,active=edges.filter(e=>e.lo<=mid&&e.hi>mid).sort((p,q)=>(p.slope-q.slope)*mid+p.intercept-q.intercept);
        for(let i=0;i+1<active.length;i+=2){const l=active[i],r=active[i+1],la=l.slope*a+l.intercept,lb=l.slope*b+l.intercept,ra=r.slope*a+r.intercept,rb=r.slope*b+r.intercept;
          const first=Math.max(x,Math.floor(Math.min(la,lb))),last=Math.min(x+width-1,Math.ceil(Math.max(ra,rb))-1);
          for(let px=first;px<=last;px++){const wa=Math.max(0,Math.min(px+1,ra)-Math.max(px,la)),wb=Math.max(0,Math.min(px+1,rb)-Math.max(px,lb));sums[row*width+px-x]+=(b-a)*(wa+wb)/2;}
        }
      }
    }
    for(let pixel=0;pixel<sums.length;pixel++){const weight=sums[pixel];if(weight===1&&!owners[pixel])owners[pixel]=partId+1;else if(weight>0)fractions.push({pixel,part:partId,weight});}
  });
  fractions.sort((a,b)=>a.pixel-b.pixel||a.part-b.part);
  const pixels=Uint16Array.from(fractions.map(f=>f.pixel)),partIds=Uint8Array.from(fractions.map(f=>f.part)),weights=Float64Array.from(fractions.map(f=>f.weight));
  return ok({width,height,owners,pixels,partIds,weights,parts:parts.map(({color,alpha,shared})=>({color,alpha,shared})),bytes:owners.byteLength+pixels.byteLength+partIds.byteLength+weights.byteLength+parts.length*128});
}
/** premultRGB=sum(area_i*alpha_i*color_i), A=sum(area_i*alpha_i).
 * Re-evaluate shared alpha, unpremultiply and quantize ONCE. Optional stride
 * lets every tile reuse one128×128 ImageData without retained pixel copies. */
export function rasterizeCoverageTile(tile:CoverageTile,multiplier:number,data?:Uint8ClampedArray,stride=tile.width):Result<Uint8ClampedArray>{
  if(!Number.isFinite(multiplier)||multiplier<0||multiplier>1||!Number.isInteger(stride)||stride<tile.width||data&&data.length<stride*tile.height*4)return fail(problem('dialogue/coverage-output','交区透明系数或输出缓冲无效'));
  const output=data??new Uint8ClampedArray(stride*tile.height*4);output.fill(0);
  const alphas=tile.parts.map(p=>p.alpha*(p.shared?multiplier:1));let next=0;
  for(let pixel=0;pixel<tile.owners.length;pixel++){
    const owner=tile.owners[pixel]-1;let red=0,green=0,blue=0,alpha=0;
    if(owner>=0){const color=tile.parts[owner].color;alpha=alphas[owner];red=alpha*color[0];green=alpha*color[1];blue=alpha*color[2];}
    while(next<tile.pixels.length&&tile.pixels[next]===pixel){const part=tile.partIds[next],color=tile.parts[part].color,a=tile.weights[next]*alphas[part];alpha+=a;red+=a*color[0];green+=a*color[1];blue+=a*color[2];next++;}
    if(alpha>0){const index=(Math.floor(pixel/tile.width)*stride+pixel%tile.width)*4;output[index]=red/alpha;output[index+1]=green/alpha;output[index+2]=blue/alpha;output[index+3]=Math.min(1,alpha)*255;}
  }
  return ok(output);
}
/** Exact polygon coverage integral, split at vertices and integer-x crossings.
 * All mutually exclusive parts accumulate premultiplied values into ONE surface. */
export function rasterizeOwnedFills(parts:readonly ScanPart[], tile:Rect): Result<{data:Uint8ClampedArray;width:number;height:number}> {
  const {x,y,width,height}=tile;
  if(![x,y,width,height].every(Number.isInteger)||width<1||height<1||width>128||height>128)return fail(problem('dialogue/tile','积分块须为整数坐标且不超过128×128'));
  const sums=new Float64Array(width*height*4),data=new Uint8ClampedArray(width*height*4);
  for(const part of parts){if(part.alpha===0)continue;
    const candidates=part.edges.filter(e=>e.lo<y+height&&e.hi>y);
    for(let row=0;row<height;row++){
      const low=y+row,high=low+1,edges=candidates.filter(e=>e.lo<high&&e.hi>low),cuts=[low,high];
      for(const edge of edges){if(edge.lo>low)cuts.push(edge.lo);if(edge.hi<high)cuts.push(edge.hi);
        if(edge.slope!==0){const a=Math.max(low,edge.lo),b=Math.min(high,edge.hi),xa=edge.slope*a+edge.intercept,xb=edge.slope*b+edge.intercept;
          for(let k=Math.max(x,Math.ceil(Math.min(xa,xb)));k<=Math.min(x+width,Math.floor(Math.max(xa,xb)));k++){const yy=(k-edge.intercept)/edge.slope;if(yy>a&&yy<b)cuts.push(yy);}
        }
      }
      const ys=[...new Set(cuts)].sort((a,b)=>a-b);
      for(let band=1;band<ys.length;band++){
        const a=ys[band-1],b=ys[band],mid=(a+b)/2;
        const active=edges.filter(e=>e.lo<=mid&&e.hi>mid).sort((p,q)=>(p.slope-q.slope)*mid+p.intercept-q.intercept);
        for(let i=0;i+1<active.length;i+=2){const l=active[i],r=active[i+1],la=l.slope*a+l.intercept,lb=l.slope*b+l.intercept,ra=r.slope*a+r.intercept,rb=r.slope*b+r.intercept;
          const first=Math.max(x,Math.floor(Math.min(la,lb))),last=Math.min(x+width-1,Math.ceil(Math.max(ra,rb))-1);
          for(let px=first;px<=last;px++){const wa=Math.max(0,Math.min(px+1,ra)-Math.max(px,la)),wb=Math.max(0,Math.min(px+1,rb)-Math.max(px,lb)),coverage=(b-a)*(wa+wb)/2,alpha=coverage*part.alpha,index=(row*width+px-x)*4;
            sums[index]+=alpha*part.color[0];sums[index+1]+=alpha*part.color[1];sums[index+2]+=alpha*part.color[2];sums[index+3]+=alpha;
          }
        }
      }
    }
  }
  for(let i=0;i<data.length;i+=4){const alpha=sums[i+3];if(alpha>0){data[i]=sums[i]/alpha;data[i+1]=sums[i+1]/alpha;data[i+2]=sums[i+2]/alpha;data[i+3]=Math.min(1,alpha)*255;}}
  return ok({data,width,height});
}
