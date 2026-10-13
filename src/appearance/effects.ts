import type { LayerEffect, Mat } from '../domain/types';
import { maxSingularValue } from '../geometry/flattenForBoolean';

/** Felzenszwalb's squared Euclidean distance transform, O(width*height).
 * No circular sampling approximation, independent of the radius. */
export function alphaDistance(alpha:Uint8ClampedArray,width:number,height:number):Float32Array {
  const result=new Float32Array(width*height),temp=new Float32Array(width*height),length=Math.max(width,height),f=new Float64Array(length),d=new Float64Array(length),v=new Int32Array(length),z=new Float64Array(length+1),INF=1e20;
  const transform=(n:number)=>{let k=0;v[0]=0;z[0]=-Infinity;z[1]=Infinity;for(let q=1;q<n;q++){let s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k]);while(s<=z[k]&&k>0){k--;s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k]);}k++;v[k]=q;z[k]=s;z[k+1]=Infinity;}k=0;for(let q=0;q<n;q++){while(z[k+1]<q)k++;d[q]=(q-v[k])**2+f[v[k]];}};
  for(let y=0;y<height;y++){for(let x=0;x<width;x++)f[x]=alpha[(y*width+x)*4+3]>0?0:INF;transform(width);for(let x=0;x<width;x++)temp[y*width+x]=d[x];}
  for(let x=0;x<width;x++){for(let y=0;y<height;y++)f[y]=temp[y*width+x];transform(height);for(let y=0;y<height;y++)result[y*width+x]=Math.sqrt(d[y]);}return result;
}
export function effectPadding(effects:LayerEffect[]):number {return effects.filter(e=>e.enabled).reduce((n,e)=>Math.max(n,e.width+3*e.blur+Math.hypot(e.offsetX,e.offsetY)),0);}
export function paintEffects(target:CanvasRenderingContext2D,source:HTMLCanvasElement,effects:LayerEffect[],matrix:Mat):void {
  const enabled=effects.filter(e=>e.enabled);if(!enabled.length)return;
  const scale=maxSingularValue(matrix),w=source.width,h=source.height,mask=document.createElement('canvas');mask.width=w;mask.height=h;const ctx=mask.getContext('2d')!;
  let pixels:ImageData|undefined,distance:Float32Array|undefined;
  try{for(const e of [...enabled].reverse()){
    if(e.kind==='outline'&&e.width===0)continue;
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,w,h);ctx.globalCompositeOperation='source-over';
    if(e.kind==='shadow')ctx.drawImage(source,0,0);
    else{pixels??=source.getContext('2d')!.getImageData(0,0,w,h);distance??=alphaDistance(pixels.data,w,h);const data=ctx.createImageData(w,h),r=e.width*scale;for(let i=0;i<distance.length;i++){const a=pixels.data[i*4+3]/255,coverage=Math.min(1,Math.max(0,r+.5-distance[i]));data.data[i*4+3]=Math.round(255*(e.kind==='outline'?coverage*(1-a):r>0?Math.max(a,coverage):a));}ctx.putImageData(data,0,0);}
    ctx.globalCompositeOperation='source-in';ctx.fillStyle=e.color;ctx.fillRect(0,0,w,h);
    target.save();target.globalAlpha*=e.opacity;target.filter=e.blur>0?`blur(${e.blur*scale}px)`:'none';target.drawImage(mask,matrix[0]*e.offsetX+matrix[2]*e.offsetY,matrix[1]*e.offsetX+matrix[3]*e.offsetY);target.restore();
  }}finally{mask.width=mask.height=0;}
}
