import type {Id,Project,TextLayer} from '../domain/types';
import {resolveBubbleTextFrame} from './bubbleTextFrame';
import {layoutText} from './layout';
import {actualFont,fontCss} from './fonts';
import {applyCanvasTextPolicy} from './canvasStyle';
/** Leaving a bubble freezes its layout position, while retaining editable text and word wrapping. */
export function freezeBubbleText(project:Project,id:Id):TextLayer{
 const original=project.layers[id];if(original?.type!=='text')throw Error('文字目标已不存在');const layer=structuredClone(original);
 if(original.bubbleFrame?.placement==='center'){
  if(original.bubbleFrame.mode==='manual'&&original.text.direction==='horizontal')layer.text.wrapMode='word';
  const ctx=typeof document==='undefined'?null:document.createElement('canvas').getContext('2d');if(ctx){applyCanvasTextPolicy(ctx);ctx.font=fontCss(original.text.font.family,original.text.font.size,original.text.font.bold,original.text.font.italic);const frame=resolveBubbleTextFrame(project,id,ctx,actualFont(original.text.font.family));if(frame.ok){layer.box={...frame.value.box};const native=layoutText(layer.text,layer.box,ctx),a=frame.value.layout.runs[0],b=native.runs[0];if(a&&b){layer.box.x+=a.origin.x-b.origin.x;layer.box.y+=original.text.direction==='horizontal'?a.baseline-b.baseline:a.origin.y-b.origin.y;}}}
 }
 delete layer.bubbleFrame;return layer;
}
