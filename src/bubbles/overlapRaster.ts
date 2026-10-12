import type { Mat, Project } from '../domain/types';
import type { PreparedDialogue } from './dialogueGeometry';
import { prepareCoverage, compileCoverageTile, rasterizeCoverageTile, type CoverageTile } from './overlapFill';
import { polyBounds } from '../geometry/polygon';
import { rectCorners } from '../geometry/matrix';
interface Tile {x:number;y:number;canvas:HTMLCanvasElement;coverage:CoverageTile}
interface Surface {geometry:PreparedDialogue;tiles:Tile[];bytes:number;multiplier:number}
const cache=new Map<string,Surface>();let usedBytes=0;
const MAX_BYTES=16*1024*1024;
export const overlapRasterCacheStats=()=>({entries:cache.size,bytes:usedBytes,limitBytes:MAX_BYTES,tiles:[...cache.values()].reduce((n,v)=>n+v.tiles.length,0)});
function dispose(surface:Pick<Surface,'tiles'>):void{for(const tile of surface.tiles)tile.canvas.width=tile.canvas.height=0;}
export function clearOverlapRasterCache():void{for(const entry of cache.values())dispose(entry);cache.clear();usedBytes=0;}
function repaint(tile:Tile,multiplier:number,pixels:ImageData):void{
  const raster=rasterizeCoverageTile(tile.coverage,multiplier,pixels.data,pixels.width);if(!raster.ok)throw Error(raster.problems[0].message);
  const context=tile.canvas.getContext('2d');if(!context)throw Error('无法创建交区积分画布');context.putImageData(pixels,0,0);
}
/** Device-aligned final tiles + unrounded coverage share the SAME16MiB budget.
 * Alpha-only edits reuse geometry/integrals, never blend/scale an extra alpha
 * bitmap. The scratch ImageData is temporary, not retained per tile. */
export function drawOverlapSurface(ctx:CanvasRenderingContext2D,geometry:PreparedDialogue,project:Project,multiplier:number):void{
  const transform=ctx.getTransform(),matrix:Mat=[transform.a,transform.b,transform.c,transform.d,transform.e,transform.f];
  const parts=geometry.ownedFills.flatMap(part=>{const layer=project.layers[part.id];return layer.type==='bubble'?[{region:part.exclusive,color:layer.style.fill,multiplier:1,shared:false},{region:part.overlap,color:layer.style.fill,multiplier:1,shared:true}]:[];});
  const box=polyBounds(rectCorners(geometry.bounds,matrix)),x0=Math.max(0,Math.floor(box.x)),y0=Math.max(0,Math.floor(box.y)),x1=Math.min(ctx.canvas.width,Math.ceil(box.x+box.width)),y1=Math.min(ctx.canvas.height,Math.ceil(box.y+box.height));
  const key=JSON.stringify([geometry.groupId,matrix,ctx.canvas.width,ctx.canvas.height,parts.map(p=>p.color)]),prior=cache.get(key),pixels=ctx.createImageData(128,128);
  ctx.save();ctx.setTransform(1,0,0,1,0,0);
  try{
    if(prior&&prior.geometry===geometry){
      try{
        if(prior.multiplier!==multiplier){for(const tile of prior.tiles)repaint(tile,multiplier,pixels);prior.multiplier=multiplier;}
        cache.delete(key);cache.set(key,prior);for(const tile of prior.tiles)ctx.drawImage(tile.canvas,tile.x,tile.y);return;
      }catch(error){cache.delete(key);usedBytes-=prior.bytes;dispose(prior);throw error;}
    }
    if(prior){cache.delete(key);usedBytes-=prior.bytes;dispose(prior);}
    const coverage=prepareCoverage(parts,matrix),tiles:Tile[]=[];let bytes=key.length*2+512,retain=true;
    try{
      for(let y=y0;y<y1;y+=128)for(let x=x0;x<x1;x+=128){
        const width=Math.min(128,x1-x),height=Math.min(128,y1-y),compiled=compileCoverageTile(coverage,{x,y,width,height});if(!compiled.ok)throw Error(compiled.problems[0].message);
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const tile={x,y,canvas,coverage:compiled.value};
        try{
          repaint(tile,multiplier,pixels);ctx.drawImage(canvas,x,y);
          const tileBytes=width*height*4+compiled.value.bytes+256;
          if(retain&&bytes+tileBytes>MAX_BYTES){retain=false;dispose({tiles});tiles.length=0;bytes=0;}
          if(retain){tiles.push(tile);bytes+=tileBytes;}else canvas.width=canvas.height=0;
        }catch(error){canvas.width=canvas.height=0;throw error;}
      }
      if(retain){cache.set(key,{geometry,tiles,bytes,multiplier});usedBytes+=bytes;while(cache.size>8||usedBytes>MAX_BYTES){const first=cache.entries().next().value!;cache.delete(first[0]);usedBytes-=first[1].bytes;dispose(first[1]);}}
    }catch(error){dispose({tiles});throw error;}
  }finally{ctx.restore();}
}
