import type { Id, Project } from '../domain/types';
import type { ScenePaintOp } from '../render/paintOps';
import { applyPanelClipPolicy } from '../render/clipPolicy';
import { layerScreenBounds } from '../render/screenBounds';
import { worldMatrix, multiply } from '../geometry/matrix';
import { presentation, compositeMode } from './model';
import { paintEffects } from './effects';
import { effectPadding } from './effects';
import { maxSingularValue } from '../geometry/flattenForBoolean';
import type { Mat,Rect } from '../domain/types';

export const STYLE_BUFFER_BUDGET=256*1024*1024;
let allocated=0;
export const styleBufferBytes=()=>allocated;
function surface(w:number,h:number){if(w<1||h<1||w>32767||h>32767||allocated+w*h*4>STYLE_BUFFER_BUDGET)throw Error('图层外观缓冲超过256MiB预算，未降低输出清晰度');const c=document.createElement('canvas');c.width=w;c.height=h;allocated+=w*h*4;return c;}
function release(c:HTMLCanvasElement){allocated-=c.width*c.height*4;c.width=c.height=0;}
function isolated(p:Project,id:Id){const l=p.layers[id],owner=l?.parentId?p.layers[l.parentId]:null;if(l?.type==='bubble'&&owner?.type==='group'&&owner.dialogue)return false;const s=l?.presentation;return !!s&&(s.opacity!==1||s.blendMode!=='normal'||s.fillBlendMode!=='normal'||s.strokeBlendMode!=='normal'||s.effects.some(e=>e.enabled));}
export function styleRasterBox(project:Project,id:Id,t:Mat,size:{width:number;height:number}):Rect|null {
  const bounds=layerScreenBounds(project,id,{zoom:1,pan:{x:0,y:0}});if(!bounds)return null;const s=presentation(project.layers[id]),world=multiply(t,worldMatrix(project,id)),halo=Math.ceil((effectPadding(s.effects)+2)*maxSingularValue(world))+2;
  const points=[{x:bounds.x,y:bounds.y},{x:bounds.x+bounds.width,y:bounds.y},{x:bounds.x+bounds.width,y:bounds.y+bounds.height},{x:bounds.x,y:bounds.y+bounds.height}].map(p=>({x:t[0]*p.x+t[2]*p.y+t[4],y:t[1]*p.x+t[3]*p.y+t[5]}));
  const x=Math.max(-halo,Math.floor(Math.min(...points.map(p=>p.x)))-2),y=Math.max(-halo,Math.floor(Math.min(...points.map(p=>p.y)))-2),right=Math.min(size.width+halo,Math.ceil(Math.max(...points.map(p=>p.x)))+2),bottom=Math.min(size.height+halo,Math.ceil(Math.max(...points.map(p=>p.y)))+2);return right>x&&bottom>y?{x,y,width:right-x,height:bottom-y}:null;
}
export function styleMemoryEstimate(project:Project,pageId:Id,scale:number):number {
  const page=project.pages[pageId];let maximum=0;const visit=(id:Id,held:number)=>{const l=project.layers[id],owner=l?.parentId?project.layers[l.parentId]:null;if(!l?.visible||l.presentation?.opacity===0&&!(l.type==='bubble'&&owner?.type==='group'&&owner.dialogue))return;const box=isolated(project,id)?styleRasterBox(project,id,[scale,0,0,scale,0,0],{width:Math.round(page.width*scale),height:Math.round(page.height*scale)}):null,n=box?box.width*box.height:0;maximum=Math.max(maximum,held+40*n);if('children'in l)l.children.forEach(c=>visit(c,held+8*n));};page.roots.forEach(id=>visit(id,0));return maximum;
}
export function paintStyledOps(ctx:CanvasRenderingContext2D,project:Project,ops:readonly ScenePaintOp[],paint:(ctx:CanvasRenderingContext2D,op:ScenePaintOp)=>void,skip:ReadonlySet<Id>=new Set()):void {
  for(let i=0;i<ops.length;){const first=ops[i],id=first.lineage.find(id=>!skip.has(id)&&isolated(project,id));if(!id){paint(ctx,first);i++;continue;}
    let end=i+1;while(end<ops.length&&ops[end].lineage.includes(id))end++;const chunk=ops.slice(i,end),layer=project.layers[id],style=presentation(layer);if(style.opacity===0){i=end;continue;}const t=ctx.getTransform(),box=styleRasterBox(project,id,[t.a,t.b,t.c,t.d,t.e,t.f],ctx.canvas);if(!box){i=end;continue;}
    const {x,y,width:w,height:h}=box;
    // Reserve source + effected + coverage/result + EDT workspace conservatively.
    if(allocated+w*h*40>STYLE_BUFFER_BUDGET)throw Error('图层效果所需临时内存超过256MiB，未降低输出清晰度');
    const buffers:HTMLCanvasElement[]=[],allocate=()=>{const c=surface(w,h);buffers.push(c);return c;},next=new Set(skip);next.add(id);
    const common=layer.type==='image'?first.panelClips:first.panelClips.filter(c=>chunk.every(op=>{const l=project.layers[op.layerId];return op.panelClips.some(v=>v.panelId===c.panelId)&&!(l?.type==='image'&&l.panelClip?.mode&&l.panelClip.mode!=='normal');}));
    const scoped=chunk.map(op=>({...op,panelClips:op.panelClips.filter(c=>!common.includes(c)&&!common.some(v=>v.panelId===c.panelId))}));
    try{const raw=allocate(),output=allocate(),rawCtx=raw.getContext('2d'),out=output.getContext('2d');if(!rawCtx||!out)throw Error('无法创建原尺寸外观缓冲');rawCtx.setTransform(t.a,t.b,t.c,t.d,t.e-x,t.f-y);paintStyledOps(rawCtx,project,scoped,paint,next);
      if(style.fillBlendMode!=='normal'||style.strokeBlendMode!=='normal'){
        const result=allocate(),back=allocate();const r=result.getContext('2d')!,b=back.getContext('2d')!;b.drawImage(ctx.canvas,-x,-y);r.drawImage(back,0,0);r.setTransform(t.a,t.b,t.c,t.d,t.e-x,t.f-y);paintStyledOps(r,project,scoped,paint,next);
        const coverage=rawCtx.getImageData(0,0,w,h),res=r.getImageData(0,0,w,h),backdrop=b.getImageData(0,0,w,h);for(let j=0;j<coverage.data.length;j+=4){const a=coverage.data[j+3]/255,ar=res.data[j+3]/255,ab=backdrop.data[j+3]/255;for(let k=0;k<3;k++)coverage.data[j+k]=a?Math.round((res.data[j+k]*ar-(1-a)*backdrop.data[j+k]*ab)/a):0;}rawCtx.setTransform(1,0,0,1,0,0);rawCtx.putImageData(coverage,0,0);
      }
      const matrix=multiply([t.a,t.b,t.c,t.d,0,0],worldMatrix(project,id));paintEffects(out,raw,style.effects,matrix);out.drawImage(raw,0,0);
      ctx.save();applyPanelClipPolicy(ctx,project,{...first,panelClips:common});ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha*=style.opacity;ctx.globalCompositeOperation=compositeMode(style.blendMode);ctx.drawImage(output,x,y);ctx.restore();
    }finally{buffers.forEach(release);}i=end;
  }
}
