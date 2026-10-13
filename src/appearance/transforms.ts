import { migrateProject } from '../storage/migrateProject';
import { freeImage } from '../images/freeImage';
import type { Id, Layer, Mat, Point, Project, Result, TransformHint } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { apply, decompose, multiply, rotationRad, scaling, translation } from '../geometry/matrix';
import { localLayerBounds, layerWorldBounds } from '../interaction/layerBounds';
import { transformSelectionDraft, selectionRoots, selectionTransformBounds } from '../interaction/selectionTransform';
import { getProject } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { execute } from '../history/commandBus';
import { validateTransform } from '../domain/validate';
import { appearanceGuard, propertyAnchor, propertyTransformStore } from './commands';
import { presentation } from './model';
import { resizeProject } from '../interaction/resize';
import { transformDimensions } from '../interaction/transformCommands';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { finishActiveTextEdit } from '../text/editLifecycle';

export function hintMatrix(h:TransformHint):Mat {
  const x=Math.tan(h.skewX*Math.PI/180),y=Math.tan(h.skewY*Math.PI/180);
  return multiply(multiply(multiply(rotationRad(h.rotation*Math.PI/180),[1,0,x,1,0,0]),[1,y,0,1,0,0]),scaling(h.sx,h.sy));
}
export function transformParts(layer:Layer):TransformHint {
  const hint=layer.presentation?.transformHint;
  if(hint&&hintMatrix(hint).slice(0,4).every((v,i)=>Math.abs(v-layer.matrix[i])<=1e-7*Math.max(1,Math.abs(v))))return hint;
  const d=decompose(layer.matrix);return{rotation:d.thetaRad*180/Math.PI,sx:d.sx,sy:d.sy,skewX:Math.atan(d.k)*180/Math.PI,skewY:0};
}
export function invalidateTransformHints(project:Project):void {for(const l of Object.values(project.layers)){const h=l.presentation?.transformHint;if(h&&hintMatrix(h).slice(0,4).some((v,i)=>Math.abs(v-l.matrix[i])>1e-7*Math.max(1,Math.abs(v))))delete l.presentation!.transformHint;}}
export function setTransformPart(id:Id,field:'rotation'|'skewX'|'skewY',value:number):Result<void>{
  const text=finishActiveTextEdit();if(!text.ok)return text;
  const p=getProject(),l=p.layers[id],guard=appearanceGuard(p,[id]);if(!guard.ok)return guard;
  const parent=l.parentId?p.layers[l.parentId]:null;if(l.type==='pageBackground'||parent?.type==='bubble'||parent?.type==='panel'&&!(l.type==='image'&&!l.crop))return fail(problem('transform/owned','该对象由容器控制，请选择所属容器'));
  if(!Number.isFinite(value)||field!=='rotation'&&Math.abs(value)>80)return fail(problem('transform/skew','倾斜角须在-80°～80°之间，旋转须为有限数值'));
  if(Math.abs(value-transformParts(l)[field])<1e-9)return ok(undefined);
  const h={...transformParts(l),[field]:field==='rotation'?((value+180)%360+360)%360-180:value},box=localLayerBounds(p,id);if(!box)return fail(problem('transform/empty','对象没有可用边界'));
  const origin=propertyAnchor(id),a={x:box.x+origin.x*box.width,y:box.y+origin.y*box.height},fixed=apply(l.matrix,a),linear=hintMatrix(h),m:Mat=[linear[0],linear[1],linear[2],linear[3],fixed.x-linear[0]*a.x-linear[2]*a.y,fixed.y-linear[1]*a.x-linear[3]*a.y];
  const valid=validateTransform(m);if(!valid.ok)return valid;
  const result=execute({label:field==='rotation'?'旋转图层':'倾斜图层',context:{pageId:l.pageId,selection:sessionStore.getState().selection},mutate(d){const upgrade=migrateProject(d);if(!upgrade.ok)throw Error(upgrade.problems[0].message);Object.assign(d,upgrade.value);d.layers[id].matrix=m;d.layers[id].presentation={...presentation(d.layers[id]),transformHint:h};}});return result.ok?ok(undefined):result;
}
export function setPropertyDimensions(id:Id,field:'width'|'height',value:number):Result<void>{
  const text=finishActiveTextEdit();if(!text.ok)return text;
  const p=getProject(),l=p.layers[id],guard=appearanceGuard(p,[id]);if(!guard.ok)return guard;
  const box=localLayerBounds(p,id),size=transformDimensions(id,p);if(!box||!size||!Number.isFinite(value)||value<16||value>16384)return fail(problem('transform/size','宽高须在16～16384px之间'));
  const s=propertyTransformStore.getState(),ratio=value/(field==='width'?size.width:size.height),linked=s.target===id&&s.ratioLinked||l.type==='bubble'&&l.shape==='circle',kx=field==='width'||linked?ratio:1,ky=field==='height'||linked?ratio:1,a=propertyAnchor(id);
  const fixed={x:box.x+a.x*box.width,y:box.y+a.y*box.height},next={x:fixed.x+(box.x-fixed.x)*kx,y:fixed.y+(box.y-fixed.y)*ky,width:box.width*kx,height:box.height*ky},preview=resizeProject(p,id,next);if(!preview.ok)return preview;
  const result=execute({label:'调整图层尺寸',context:{pageId:l.pageId,selection:sessionStore.getState().selection},mutate(d){for(const [key,v]of Object.entries(preview.value.layers))if(v!==p.layers[key])d.layers[key]=v;}});return result.ok?ok(undefined):result;
}
export type Alignment='left'|'hCenter'|'right'|'top'|'vCenter'|'bottom'|'hDistribute'|'vDistribute';
export function alignLayers(ids:Id[],kind:Alignment,reference:'page'|'selection'=propertyTransformStore.getState().alignReference):Result<void>{
  const text=finishActiveTextEdit();if(!text.ok)return text;
  const p=getProject(),roots=selectionRoots(p,ids),guard=appearanceGuard(p,roots);if(!guard.ok)return guard;
  if(roots.some(id=>!effectiveLayerFlags(p,id).visible))return fail(problem('align/hidden','请先显示要对齐或分布的对象'));
  const boundProject={...p,layers:{...p.layers}};for(const id of roots)if(p.layers[id].type==='image')boundProject.layers[id]=freeImage(p,id);
  const items=roots.map(id=>({id,box:layerWorldBounds(boundProject,id)}));if(items.some(i=>!i.box))return fail(problem('align/empty','空对象不能对齐'));
  const page=p.pages[p.layers[roots[0]].pageId],bounds=roots.length===1||reference==='page'?{x:0,y:0,width:page.width,height:page.height}:selectionTransformBounds(boundProject,roots)!;
  const offsets=new Map<Id,Point>(),horizontal=kind.startsWith('h'),distribute=kind.endsWith('Distribute');
  if(distribute){if(items.length<3)return fail(problem('align/count','分布需要至少3个可编辑对象'));const sorted=items.map((v,index)=>({...v,index})).sort((a,b)=>{const A=a.box!,B=b.box!;return(horizontal?A.x+A.width/2-B.x-B.width/2:A.y+A.height/2-B.y-B.height/2)||a.index-b.index;});const first=sorted[0].box!,last=sorted.at(-1)!.box!,begin=horizontal?first.x:first.y,end=horizontal?last.x+last.width:last.y+last.height,gap=(end-begin-sorted.reduce((n,v)=>n+(horizontal?v.box!.width:v.box!.height),0))/(items.length-1);let at=begin;for(const v of sorted){offsets.set(v.id,horizontal?{x:at-v.box!.x,y:0}:{x:0,y:at-v.box!.y});at+=(horizontal?v.box!.width:v.box!.height)+gap;}}
  else for(const {id,box:b}of items){const B=b!;offsets.set(id,{x:kind==='left'?bounds.x-B.x:kind==='right'?bounds.x+bounds.width-B.x-B.width:kind==='hCenter'?bounds.x+bounds.width/2-B.x-B.width/2:0,y:kind==='top'?bounds.y-B.y:kind==='bottom'?bounds.y+bounds.height-B.y-B.height:kind==='vCenter'?bounds.y+bounds.height/2-B.y-B.height/2:0});}
  const draft={...p,layers:{...p.layers}};for(const [id,d]of offsets){const changed=transformSelectionDraft(p,[id],translation(d.x,d.y));if(!changed.ok)return changed;draft.layers[id]=changed.value.layers[id];draft.schemaVersion=changed.value.schemaVersion;}
  const result=execute({label:distribute?'分布图层':'对齐图层',context:{pageId:page.id,selection:ids},mutate(d){for(const id of roots)d.layers[id]=draft.layers[id];d.schemaVersion=draft.schemaVersion;}});return result.ok?ok(undefined):result;
}
