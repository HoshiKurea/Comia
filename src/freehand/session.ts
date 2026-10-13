import { createStore } from 'zustand/vanilla';
import type { FreehandMaterialSource, Id, InkStroke, Layer, Mat, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { newId } from '../domain/id';
import { getDocument } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { validateTransform } from '../domain/validate';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { cancelActiveGesture } from '../interaction/activeGesture';
import { IDENTITY } from '../geometry/matrix';
import { DRAWING_LIMITS, parseDrawingSource, parseInkStroke } from './model';

interface BaseDrawingObject { id:Id;name:string;matrix:Mat;visible:boolean }
export type DrawingObject = BaseDrawingObject & {kind:'material';source:FreehandMaterialSource};
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
    if(layer.type==='image'){
      const source=doc.project.assets[layer.assetId]?.drawingSource;if(!source)return fail(problem('drawing/target','请选择手绘素材；导入图片继续使用裁剪和遮罩工具'));
      width=source.width;height=source.height;objects=[{id,name:layer.name,kind:'material',matrix:IDENTITY,visible:true,source:structuredClone(source)}];
    }else return fail(problem('drawing/target','绘画窗口只编辑手绘素材；气泡请用独立手绘气泡工具'));
    parentId=layer.parentId;
  }
  drawingWindowStore.setState({active:{projectId:doc.project.id,pageId:page.id,epoch:doc.epoch,stateId:doc.history.stateId,targetId:targetId??null,parentId,width,height,objects,activeId:objects[0]?.id??null,dirty:false,past:[],future:[]}});return ok(undefined);
}
function publish(snapshot:DrawingSnapshot):Result<void>{
  const a=currentDrawingSession();if(!a)return fail(problem('drawing/inactive','没有活动绘画窗口'));
  if(JSON.stringify([a.objects,a.activeId])===JSON.stringify([snapshot.objects,snapshot.activeId]))return ok(undefined);
  drawingWindowStore.setState({active:{...a,...snapshot,dirty:true,past:[...a.past,{objects:a.objects,activeId:a.activeId}].slice(-200),future:[]}});return ok(undefined);
}
export function addDrawingObject(kind:'material'):Result<Id>{
  const a=currentDrawingSession();if(!a)return fail(problem('drawing/inactive','没有绘画窗口'));
  if(a.targetId)return fail(problem('drawing/reedit','重开窗口只编辑目标对象；新作品请打开新的绘画窗口'));
  if(a.objects.length>=DRAWING_LIMITS.objects)return fail(problem('drawing/objects','一个窗口最多16个对象'));
  if(kind!=='material')return fail(problem('drawing/kind','绘画窗口只创作素材；气泡请使用B手绘气泡工具'));
  const id=newId(),object:DrawingObject={id,name:'手绘素材',matrix:IDENTITY,visible:true,kind:'material',source:{version:1,width:a.width,height:a.height,strokes:[]}};
  const r=publish({objects:[...a.objects,object],activeId:id});return r.ok?ok(id):r;
}
export function selectDrawingObject(id:Id):void{const a=currentDrawingSession();if(a?.objects.some(o=>o.id===id))drawingWindowStore.setState({active:{...a,activeId:id}});}
export function updateDrawingObject(id:Id,patch:Partial<BaseDrawingObject>):Result<void>{
  const a=currentDrawingSession(),o=a?.objects.find(o=>o.id===id);if(!a||!o)return fail(problem('drawing/object','绘画对象不存在'));
  if(patch.name!==undefined&&(!patch.name.trim()||Array.from(patch.name).length>80))return fail(problem('drawing/name','名称需要1～80个字符'));
  if(patch.matrix){const transform=validateTransform(patch.matrix);if(!transform.ok)return transform;}
  return publish({objects:a.objects.map(item=>item.id===id?{...item,...structuredClone(patch)} as DrawingObject:item),activeId:a.activeId});
}
export function deleteDrawingObject(id:Id):Result<void>{const a=currentDrawingSession();if(!a)return fail(problem('drawing/inactive','没有绘画窗口'));if(a.targetId)return fail(problem('drawing/reedit','删除目标请取消窗口后在主画布删除'));const objects=a.objects.filter(o=>o.id!==id);return publish({objects,activeId:a.activeId===id?objects.at(-1)?.id??null:a.activeId});}
export function setDrawingBoard(width:number,height:number):Result<void>{const a=currentDrawingSession();if(!a||a.targetId||a.objects.length)return fail(problem('drawing/board','请在创建对象前设置画板尺寸'));if(!Number.isInteger(width)||!Number.isInteger(height)||width<16||height<16||width>4096||height>4096)return fail(problem('drawing/board','画板每边需要16～4096整数像素'));drawingWindowStore.setState({active:{...a,width,height}});return ok(undefined);}
export function commitDrawingStroke(stroke:InkStroke,mode:'ink'='ink'):Result<void>{
  const a=currentDrawingSession(),o=a?.objects.find(o=>o.id===a.activeId);if(!a||!o)return fail(problem('drawing/select','请先创建或选择素材'));
  if(mode!=='ink'||o.kind!=='material')return fail(problem('drawing/kind','绘画窗口只编辑素材笔迹'));
  const parsed=parseInkStroke(stroke);if(!parsed.ok)return parsed;
  const next:DrawingObject={...o,source:{...o.source,strokes:[...o.source.strokes,parsed.value]}};
  const valid=parseDrawingSource(next.source,'material');if(!valid.ok)return valid;
  return publish({objects:a.objects.map(item=>item.id===o.id?next:item),activeId:o.id});
}
export function travelDrawingHistory(direction:'undo'|'redo'):void{
  const a=currentDrawingSession();if(!a)return;const src=direction==='undo'?a.past:a.future,entry=src.at(-1);if(!entry)return;
  const current={objects:a.objects,activeId:a.activeId};drawingWindowStore.setState({active:{...a,...entry,dirty:true,past:direction==='undo'?a.past.slice(0,-1):[...a.past,current],future:direction==='redo'?a.future.slice(0,-1):[...a.future,current]}});
}
export function sessionCurrent(a:DrawingSession):boolean{const doc=getDocument();return doc.epoch===a.epoch&&doc.history.stateId===a.stateId&&doc.project.id===a.projectId&&sessionStore.getState().activePageId===a.pageId;}
