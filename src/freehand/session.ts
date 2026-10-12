import { createStore } from 'zustand/vanilla';
import type { BubbleEdgeStyle, BubbleLayer, BubbleStyle, FreehandBubbleSource, FreehandMaterialSource, Id, InkStroke, Layer, Mat, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { newId } from '../domain/id';
import { createLayer } from '../domain/factories';
import { getDocument } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { validateTransform } from '../domain/validate';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { cancelActiveGesture } from '../interaction/activeGesture';
import { parseBubbleStyle } from '../domain/mangaValidation';
import { IDENTITY } from '../geometry/matrix';
import { DRAWING_LIMITS, parseDrawingSource, parseInkStroke } from './model';
import { applyBubbleShapeEdit, captureBubbleRing, freehandRegion } from './geometry';

interface BaseDrawingObject { id:Id;name:string;matrix:Mat;visible:boolean }
export type DrawingObject = BaseDrawingObject & ({kind:'bubble';source:FreehandBubbleSource;style:BubbleStyle;edge:BubbleEdgeStyle}|{kind:'material';source:FreehandMaterialSource});
export interface DrawingSnapshot {objects:DrawingObject[];activeId:Id|null}
export interface DrawingSession extends DrawingSnapshot {
  projectId:Id;pageId:Id;epoch:number;stateId:Id;targetId:Id|null;parentId:Id|null;
  width:number;height:number;dirty:boolean;past:DrawingSnapshot[];future:DrawingSnapshot[];
}
export const drawingWindowStore=createStore<{active:DrawingSession|null}>(()=>({active:null}));
export const currentDrawingSession=()=>drawingWindowStore.getState().active;
export function cancelDrawingWindow():void{drawingWindowStore.setState({active:null});}
export function openDrawingWindow(targetId?:Id):Result<void>{
  if(currentDrawingSession())return fail(problem('drawing/active','请先应用或取消当前绘画'));
  const finish=finishActiveTextEdit();if(!finish.ok)return finish;cancelActiveGesture();
  const doc=getDocument(),s=sessionStore.getState(),page=doc.project.pages[s.activePageId];if(!page)return fail(problem('drawing/page','当前页面不存在'));
  let objects:DrawingObject[]=[],width=1024,height=768,parentId=s.scopeId;
  if(parentId){while(parentId){const node:Layer|undefined=doc.project.layers[parentId];if(!node||node.pageId!==page.id)return fail(problem('drawing/scope','当前编辑范围已失效'));if(effectiveLayerFlags(doc.project,parentId).locked||!effectiveLayerFlags(doc.project,parentId).visible)return fail(problem('drawing/locked','请先显示并解锁当前编辑范围'));if(node.type==='group'&&!node.dialogue)break;parentId=node.parentId;}}
  if(targetId){
    const layer=doc.project.layers[targetId];if(!layer||layer.pageId!==page.id||(effectiveLayerFlags(doc.project,targetId).locked||!effectiveLayerFlags(doc.project,targetId).visible))return fail(problem('drawing/target','绘画目标已失效、锁定或隐藏'));
    const id=newId();
    if(layer.type==='bubble'){
      if(layer.shape!=='freehand'||!layer.freehandSource)return fail(problem('drawing/target','请选择由绘画窗口创建的气泡'));
      const source=structuredClone(layer.freehandSource);width=Math.min(4096,Math.max(1024,source.width+128));height=Math.min(4096,Math.max(768,source.height+128));
      objects=[{id,name:layer.name,kind:'bubble',matrix:[1,0,0,1,(width-source.width)/2,(height-source.height)/2],visible:true,source,style:structuredClone(layer.style),edge:structuredClone(layer.edgeStyle??{recipe:'normal-offset-v1',wobble:0,seed:42})}];
    }else if(layer.type==='image'){
      const source=doc.project.assets[layer.assetId]?.drawingSource;if(!source)return fail(problem('drawing/target','请选择手绘素材；导入图片继续使用裁剪和遮罩工具'));
      width=source.width;height=source.height;objects=[{id,name:layer.name,kind:'material',matrix:IDENTITY,visible:true,source:structuredClone(source)}];
    }else return fail(problem('drawing/target','请选择手绘气泡或素材'));
    parentId=layer.parentId;
  }
  drawingWindowStore.setState({active:{projectId:doc.project.id,pageId:page.id,epoch:doc.epoch,stateId:doc.history.stateId,targetId:targetId??null,parentId,width,height,objects,activeId:objects[0]?.id??null,dirty:false,past:[],future:[]}});return ok(undefined);
}
function publish(snapshot:DrawingSnapshot):Result<void>{
  const a=currentDrawingSession();if(!a)return fail(problem('drawing/inactive','没有活动绘画窗口'));
  if(JSON.stringify([a.objects,a.activeId])===JSON.stringify([snapshot.objects,snapshot.activeId]))return ok(undefined);
  drawingWindowStore.setState({active:{...a,...snapshot,dirty:true,past:[...a.past,{objects:a.objects,activeId:a.activeId}].slice(-200),future:[]}});return ok(undefined);
}
export function addDrawingObject(kind:'bubble'|'material'):Result<Id>{
  const a=currentDrawingSession();if(!a)return fail(problem('drawing/inactive','没有绘画窗口'));
  if(a.targetId)return fail(problem('drawing/reedit','重开窗口只编辑目标对象；新作品请打开新的绘画窗口'));
  if(a.objects.length>=DRAWING_LIMITS.objects)return fail(problem('drawing/objects','一个窗口最多16个对象'));
  const id=newId(),base={id,name:kind==='bubble'?'手绘气泡':'手绘素材',matrix:IDENTITY,visible:true},source={version:1 as const,width:a.width,height:a.height};
  const b=kind==='bubble'?createLayer('bubble',a.pageId) as BubbleLayer:null;
  const object:DrawingObject=b?{...base,kind:'bubble',source:{...source,baseRing:[],edits:[]},style:structuredClone(b.style),edge:{recipe:'normal-offset-v1',wobble:0,seed:42}}:{...base,kind:'material',source:{...source,strokes:[]}};
  const r=publish({objects:[...a.objects,object],activeId:id});return r.ok?ok(id):r;
}
export function selectDrawingObject(id:Id):void{const a=currentDrawingSession();if(a?.objects.some(o=>o.id===id))drawingWindowStore.setState({active:{...a,activeId:id}});}
export function updateDrawingObject(id:Id,patch:Partial<BaseDrawingObject>&{style?:BubbleStyle;edge?:BubbleEdgeStyle}):Result<void>{
  const a=currentDrawingSession(),o=a?.objects.find(o=>o.id===id);if(!a||!o)return fail(problem('drawing/object','绘画对象不存在'));
  if(patch.name!==undefined&&(!patch.name.trim()||Array.from(patch.name).length>80))return fail(problem('drawing/name','名称需要1～80个字符'));
  if(patch.matrix){const transform=validateTransform(patch.matrix);if(!transform.ok)return transform;}
  if(patch.style){const parsed=parseBubbleStyle(patch.style,'drawing.style');if(!parsed.ok)return parsed;}
  if(patch.edge&&(!Number.isFinite(patch.edge.wobble)||patch.edge.wobble<0||patch.edge.wobble>.03))return fail(problem('drawing/edge','边缘抖动范围为0～0.03'));
  return publish({objects:a.objects.map(item=>item.id===id?{...item,...structuredClone(patch)} as DrawingObject:item),activeId:a.activeId});
}
export function deleteDrawingObject(id:Id):Result<void>{const a=currentDrawingSession();if(!a)return fail(problem('drawing/inactive','没有绘画窗口'));if(a.targetId)return fail(problem('drawing/reedit','删除目标请取消窗口后在主画布删除'));const objects=a.objects.filter(o=>o.id!==id);return publish({objects,activeId:a.activeId===id?objects.at(-1)?.id??null:a.activeId});}
export function setDrawingBoard(width:number,height:number):Result<void>{const a=currentDrawingSession();if(!a||a.targetId||a.objects.length)return fail(problem('drawing/board','请在创建对象前设置画板尺寸'));if(!Number.isInteger(width)||!Number.isInteger(height)||width<16||height<16||width>4096||height>4096)return fail(problem('drawing/board','画板每边需要16～4096整数像素'));drawingWindowStore.setState({active:{...a,width,height}});return ok(undefined);}
export function commitDrawingStroke(stroke:InkStroke,mode:'contour'|'add'|'subtract'|'ink',forceClose=false):Result<void>{
  const a=currentDrawingSession(),o=a?.objects.find(o=>o.id===a.activeId);if(!a||!o)return fail(problem('drawing/select','请先创建或选择一个绘画对象'));
  const parsed=parseInkStroke(stroke);if(!parsed.ok)return parsed;
  let next:DrawingObject;
  if(o.kind==='material'){next={...o,source:{...o.source,strokes:[...o.source.strokes,parsed.value]}};const valid=parseDrawingSource(next.source,'material');if(!valid.ok)return valid;}
  else if(mode==='contour'){
    const first=stroke.points[0],last=stroke.points.at(-1)!;
    if(!forceClose&&Math.hypot(first.x-last.x,first.y-last.y)>12)return fail(problem('drawing/open-ring','轮廓未闭合；点击“闭合轮廓”预览并连接端点，或重新绘制'));
    const ring=captureBubbleRing(stroke.points);if(!ring.ok)return ring;next={...o,source:{...o.source,baseRing:ring.value,edits:[]}};
  }else{
    if(!o.source.baseRing.length)return fail(problem('drawing/ring','请先画闭合主体'));
    const region=freehandRegion(o.source);if(!region.ok)return region;const changed=applyBubbleShapeEdit(region.value,stroke,mode==='subtract'?'subtract':'add');if(!changed.ok)return changed;
    next={...o,source:{...o.source,edits:[...o.source.edits,{id:newId(),mode:mode==='subtract'?'subtract':'add',stroke:parsed.value}]}};
    const valid=parseDrawingSource(next.source,'bubble');if(!valid.ok)return valid;
  }
  return publish({objects:a.objects.map(item=>item.id===o.id?next:item),activeId:o.id});
}
export function travelDrawingHistory(direction:'undo'|'redo'):void{
  const a=currentDrawingSession();if(!a)return;const src=direction==='undo'?a.past:a.future,entry=src.at(-1);if(!entry)return;
  const current={objects:a.objects,activeId:a.activeId};drawingWindowStore.setState({active:{...a,...entry,dirty:true,past:direction==='undo'?a.past.slice(0,-1):[...a.past,current],future:direction==='redo'?a.future.slice(0,-1):[...a.future,current]}});
}
export function sessionCurrent(a:DrawingSession):boolean{const doc=getDocument();return doc.epoch===a.epoch&&doc.history.stateId===a.stateId&&doc.project.id===a.projectId&&sessionStore.getState().activePageId===a.pageId;}
