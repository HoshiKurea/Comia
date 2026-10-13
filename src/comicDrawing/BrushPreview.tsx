import { useEffect, useRef } from 'react';
import type { BubbleBrushOptions, BubbleLayer } from '../domain/types';
import { createLayer, createProject } from '../domain/factories';
import { newId } from '../domain/id';
import { translation } from '../geometry/matrix';
import { composeBubble } from '../bubbles/composeBubble';
import { drawPage } from '../render/drawScene';
import type { FlashOptions } from './types';
import './comicDrawing.css';

/** Uses the same renderer as the artwork; this isolated swatch never edits a document. */
export function BrushPreview({bubble,flash}:{bubble?:BubbleBrushOptions;flash?:FlashOptions}) {
  const ref=useRef<HTMLCanvasElement>(null),key=JSON.stringify([bubble,flash]);
  useEffect(()=>{const c=ref.current;if(!c)return;const dpr=Math.min(2,window.devicePixelRatio||1);c.width=280*dpr;c.height=110*dpr;const ctx=c.getContext('2d')!;ctx.clearRect(0,0,c.width,c.height);
    const p=createProject({background:false}),page=p.pages[p.pageOrder[0]],b=createLayer('bubble',page.id,'笔刷样例') as BubbleLayer;page.width=2000;page.height=2000;b.width=180;b.height=70;b.matrix=translation(800,800);b.shape='ellipse';b.style.borderWidth=0;
    if(flash){b.flash=flash;b.style.borderColor=flash.preset==='inverse'?'#FFFFFFFF':'#000000FF';}
    if(bubble){const ring=Array.from({length:80},(_,i)=>({x:90+90*Math.cos(i/80*2*Math.PI),y:35+35*Math.sin(i/80*2*Math.PI)}));b.shape='freehand';b.freehandSource={version:2,width:180,height:70,baseRing:ring,edits:[],ink:[]};b.style={borderWidth:bubble.borderWidth,borderColor:bubble.borderColor,fill:bubble.fill,innerStroke:bubble.innerStroke,outerStroke:bubble.outerStroke,radius:0};b.edgeStyle={recipe:'normal-offset-v1',wobble:bubble.handDrawn?.wobble??0,seed:42};
      if(bubble.pen?.pressure)b.penOutline={id:newId(),tool:'pen',width:Math.max(1,bubble.borderWidth),color:bubble.borderColor,opacity:1,pressureMode:'pen',points:[...ring,ring[0]].map((q,i)=>({...q,pressure:.1+.9*(1+Math.sin(i/80*2*Math.PI))/2,dt:0}))};}
    p.layers[b.id]=b;page.roots=[b.id];const geometry=composeBubble(p,b.id);if(!geometry.ok){ctx.font='12px sans-serif';ctx.fillStyle='#b44224';ctx.fillText(geometry.problems[0].message,4,55);return;}
    const bounds=geometry.value.bounds,scale=Math.min(264/bounds.width,94/bounds.height)*dpr;ctx.translate((c.width-bounds.width*scale)/2,(c.height-bounds.height*scale)/2);ctx.scale(scale,scale);ctx.translate(-800-bounds.x,-800-bounds.y);drawPage(ctx,p,page.id,new Map());
  },[key]);
  return <canvas ref={ref} className="comic-brush-preview" aria-label="笔刷预览"/>;
}
