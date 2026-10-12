import type { FreehandMaterialSource, InkStroke, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import type { DecodedAsset } from '../assets/importImage';
import { decodeImage } from '../assets/importImage';
import { drawingSourceHash, parseDrawingSource } from './model';
import { strokeRadius } from './geometry';

export function paintInkStroke(ctx: CanvasRenderingContext2D, stroke: InkStroke): void {
  ctx.fillStyle = stroke.color; ctx.strokeStyle = stroke.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (stroke.pressureMode === 'fixed') {
    ctx.lineWidth = stroke.width; ctx.beginPath(); stroke.points.forEach((p,i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y)); ctx.stroke();
    if (stroke.points.length === 1) { const p = stroke.points[0]; ctx.beginPath(); ctx.arc(p.x,p.y,stroke.width/2,0,2*Math.PI); ctx.fill(); }
    return;
  }
  const points = stroke.points;
  for (let i=0;i<points.length;i++) {
    const p=points[i], prior=points[Math.max(0,i-1)], steps=Math.max(1,Math.ceil(Math.hypot(p.x-prior.x,p.y-prior.y)/Math.max(.1,Math.min(strokeRadius(stroke,p.pressure),strokeRadius(stroke,prior.pressure))/2)));
    for(let j=0;j<=steps;j++){const t=j/steps;ctx.beginPath();ctx.arc(prior.x+(p.x-prior.x)*t,prior.y+(p.y-prior.y)*t,strokeRadius(stroke,prior.pressure+(p.pressure-prior.pressure)*t),0,2*Math.PI);ctx.fill();}
  }
}
/** One opaque intermediate surface per stroke; alpha is applied once at composition. */
export function replayMaterial(source: FreehandMaterialSource, canvas: HTMLCanvasElement): Result<void> {
  if(canvas.width!==source.width||canvas.height!==source.height)return fail(problem('drawing/canvas-size','绘画缓冲尺寸与源不符'));
  const ctx=canvas.getContext('2d'), temp=document.createElement('canvas');temp.width=source.width;temp.height=source.height;const ink=temp.getContext('2d');
  if(!ctx||!ink)return fail(problem('drawing/canvas','当前浏览器无法创建绘画缓冲'));
  ctx.clearRect(0,0,canvas.width,canvas.height);
  try {
    for(const s of source.strokes){ink.clearRect(0,0,temp.width,temp.height);paintInkStroke(ink,{...s,color:s.tool==='eraser'?'#000000FF':s.color.slice(0,7)+'FF'});ctx.save();ctx.globalAlpha=s.opacity*(s.tool==='eraser'?1:parseInt(s.color.slice(7),16)/255);ctx.globalCompositeOperation=s.tool==='eraser'?'destination-out':'source-over';ctx.drawImage(temp,0,0);ctx.restore();}
    return ok(undefined);
  } catch(e){return fail(problem('drawing/replay',(e as Error).message));} finally{temp.width=temp.height=0;}
}
export async function prepareMaterialAsset(source: FreehandMaterialSource,name:string,signal:AbortSignal):Promise<Result<DecodedAsset>>{
  const parsed=parseDrawingSource(source,'material');if(!parsed.ok)return parsed;
  const canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
  try {
    const painted=replayMaterial(source,canvas);if(!painted.ok)return painted;
    const pixels=canvas.getContext('2d')!.getImageData(0,0,source.width,source.height).data;let visible=false;for(let i=3;i<pixels.length;i+=4)if(pixels[i]){visible=true;break;}
    if(!visible)return fail(problem('drawing/empty','手绘素材已完全透明，请补画或删除空对象'));
    const png=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));if(signal.aborted)return fail(problem('drawing/cancelled','绘画应用已取消'));
    if(!png)return fail(problem('drawing/png','无法编码透明PNG，草稿仍保留'));
    const hash=await drawingSourceHash(parsed.value);if(signal.aborted)return fail(problem('drawing/cancelled','绘画应用已取消'));
    const decoded=await decodeImage(new File([png],name+'.png',{type:'image/png'}),signal);if(!decoded.ok)return decoded;
    decoded.value.meta.name=name;decoded.value.meta.drawingSource=parsed.value;decoded.value.meta.drawingSourceHash=hash;return decoded;
  }catch(e){return fail(problem('drawing/material',(e as Error).message));}finally{canvas.width=canvas.height=0;}
}
