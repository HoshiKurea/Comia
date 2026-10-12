import type { Id, Project, Rect, TextLayer } from '../domain/types';
import { resolveBubbleTextFrame } from './bubbleTextFrame';
import { actualFont } from './fonts';
import { runtimeStore } from '../state/runtimeStore';
import { applyCanvasTextPolicy } from './canvasStyle';
let context:CanvasRenderingContext2D|null=null;
const cache=new WeakMap<TextLayer,{key:string;box:Rect;safe:Rect}>();
/** Hit testing and transform feedback share the exact rendered frame; never infer from char count. */
export function bubbleFrameBounds(project:Project,id:Id):{box:Rect;safe:Rect}|null{
  const layer=project.layers[id];if(layer?.type!=='text'||layer.bubbleFrame?.placement!=='center'||!layer.parentId)return null;
  const parent=project.layers[layer.parentId],geometry=parent?.type==='bubble'?[parent.shape,parent.width,parent.height,parent.style,parent.handDrawn,parent.contour,parent.edgeStyle]:null,font=actualFont(layer.text.font.family),key=JSON.stringify([layer.text,layer.bubbleFrame,geometry,runtimeStore.getState().fontGeneration,font]),saved=cache.get(layer);if(saved?.key===key)return{box:saved.box,safe:saved.safe};
  if(typeof document==='undefined')return null;context??=document.createElement('canvas').getContext('2d');if(!context)return null;applyCanvasTextPolicy(context);
  const r=resolveBubbleTextFrame(project,id,context,font);if(!r.ok)return null;const value={key,box:r.value.box,safe:r.value.safeBox};cache.set(layer,value);return{box:value.box,safe:value.safe};
}
