import type { BubbleLayer, FreehandBubbleSource, Id, ImageLayer, Mat, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { createLayer } from '../domain/factories';
import { getDocument } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { runtimeStore } from '../state/runtimeStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { execute } from '../history/commandBus';
import { migrateProject } from '../storage/migrateProject';
import { validateProject } from '../domain/validate';
import { retainResources } from '../storage/blobRepository';
import { installDecodedAssets } from '../assets/libraryCommands';
import type { DecodedAsset } from '../assets/importImage';
import { apply, IDENTITY, inverse, multiply, scaling, translation, worldMatrix } from '../geometry/matrix';
import { regionBounds } from '../geometry/renderRegion';
import { closestTailU } from '../bubbles/tailCommands';
import { bubbleTails } from '../bubbles/ownership';
import { tailAnchors } from '../bubbles/tailGeometry';
import { composeBubble } from '../bubbles/composeBubble';
import { freehandRegion, validBubbleRegion } from './geometry';
import { DRAWING_LIMITS, parseDrawingSource } from './model';
import { prepareMaterialAsset } from './material';
import { cancelDrawingWindow, currentDrawingSession, sessionCurrent, type DrawingObject, type DrawingSession } from './session';

export interface DrawingCommitPlan { session:DrawingSession;afterProject:Project;selectedIds:Id[];resources:DecodedAsset[] }
function rebaseSource(source:FreehandBubbleSource,x:number,y:number,width:number,height:number):FreehandBubbleSource{
  return {version:1,width,height,baseRing:source.baseRing.map(p=>({x:p.x-x,y:p.y-y})),edits:source.edits.map(e=>({...e,stroke:{...e.stroke,points:e.stroke.points.map(p=>({...p,x:p.x-x,y:p.y-y}))}}))};
}
function append(p:Project,id:Id,parentId:Id|null,pageId:Id):void{const parent=parentId?p.layers[parentId]:null;if(parent&&'children'in parent)parent.children.push(id);else p.pages[pageId].roots.push(id);}
export function prepareBubbleObject(object:Extract<DrawingObject,{kind:'bubble'}>,pageId:Id):Result<{layer:BubbleLayer;offset:Mat}>{
  const parsed=parseDrawingSource(object.source,'bubble');if(!parsed.ok)return parsed;
  const region=freehandRegion(parsed.value);if(!region.ok)return region;const valid=validBubbleRegion(region.value);if(!valid.ok)return valid;
  const bounds=regionBounds(region.value),width=Math.max(16,bounds.width),height=Math.max(16,bounds.height);
  if(width>4096||height>4096)return fail(problem('drawing/size','气泡修形后的宽高超过4096'));
  const layer=createLayer('bubble',pageId,object.name) as BubbleLayer;layer.shape='freehand';layer.width=width;layer.height=height;layer.handDrawn=null;layer.contour=null;layer.freehandSource=rebaseSource(parsed.value,bounds.x,bounds.y,width,height);layer.style=structuredClone(object.style);layer.edgeStyle=structuredClone(object.edge);layer.visible=object.visible;
  const geometry=composeBubble({schemaVersion:10,layers:{[layer.id]:layer}},layer.id);if(!geometry.ok)return geometry;
  return ok({layer,offset:translation(bounds.x,bounds.y)});
}
export async function prepareDrawingCommit(session:DrawingSession,signal:AbortSignal,reservedBytes=0):Promise<Result<DrawingCommitPlan>>{
  if(!Number.isFinite(reservedBytes)||reservedBytes<0||reservedBytes>DRAWING_LIMITS.bytes)return fail(problem('drawing/memory','绘画显示缓冲已超过预算，请关闭窗口并重试'));
  if(!sessionCurrent(session))return fail(problem('drawing/stale','作品已变化，绘画草稿保留；请取消后重新打开'));
  const source=getDocument().project,migrated=migrateProject(structuredClone(source));if(!migrated.ok)return migrated;
  const p=migrated.value,selectedIds:Id[]=[],resources:DecodedAsset[]=[],release=()=>resources.forEach(a=>a.bitmap.close());
  if(session.targetId&&!session.dirty)return ok({session,afterProject:p,selectedIds:[session.targetId],resources:[]});
  const objects=session.objects.filter(o=>o.kind==='bubble'?o.source.baseRing.length:o.source.strokes.length);
  if(!objects.length)return fail(problem('drawing/empty','请先绘制至少一个对象'));
  let bytes=reservedBytes;
  try {
    for(const o of objects){
      if(signal.aborted||!sessionCurrent(session)){release();return fail(problem('drawing/cancelled','绘画应用已取消或作品已变化'));}
      const old=session.targetId?p.layers[session.targetId]:null;
      if(old&&effectiveLayerFlags(p,old.id).locked){release();return fail(problem('drawing/locked','目标或其祖先已锁定'));}
      const page=p.pages[session.pageId],origin=translation((page.width-session.width)/2,(page.height-session.height)/2),parentInv=session.parentId?inverse(worldMatrix(p,session.parentId)):ok(IDENTITY);if(!parentInv.ok){release();return parentInv;}
      if(o.kind==='bubble'){
        const prepared=prepareBubbleObject(o,session.pageId);if(!prepared.ok){release();return prepared;}
        const {layer,offset}=prepared.value;
        if(old?.type==='bubble'&&old.freehandSource){
          const initialX=(session.width-old.freehandSource.width)/2,initialY=(session.height-old.freehandSource.height)/2,sx=old.width/old.freehandSource.width,sy=old.height/old.freehandSource.height;
          const change=multiply(multiply(multiply(multiply(scaling(sx,sy),translation(-initialX,-initialY)),o.matrix),offset),scaling(1/sx,1/sy)),invChange=inverse(change);if(!invChange.ok){release();return invChange;}
          const next:BubbleLayer={...old,shape:'freehand',freehandSource:layer.freehandSource,handDrawn:null,contour:null,width:layer.width*sx,height:layer.height*sy,style:layer.style,edgeStyle:layer.edgeStyle,name:o.name,visible:o.visible,matrix:multiply(old.matrix,change)};
          p.layers[old.id]=next;
          for(const id of old.children){const child=p.layers[id];if(effectiveLayerFlags(source,id).locked){release();return fail(problem('drawing/child-locked','重画会影响锁定的文字或尾巴，请先解锁'));}if(child.type==='text'&&child.bubbleFrame?.placement==='legacy')p.layers[id]={...child,matrix:multiply(invChange.value,child.matrix)};}
          for(const tail of bubbleTails(source,old.id)){
            if(tail.attachment.mode!=='bubble'){release();return fail(problem('drawing/tail','气泡尾巴归属已失效'));}
            const anchors=tailAnchors(tail,old),point=anchors.ok?apply(invChange.value,anchors.value.base):apply(invChange.value,tail.tip),anchor=closestTailU(next,point);if(!anchor.ok){release();return anchor;}
            const move=(pt:{x:number;y:number})=>apply(invChange.value,pt);
            p.layers[tail.id]={...tail,legacySplice:false,tip:move(tail.tip),attachment:{mode:'bubble',attachU:anchor.value.u,baseWidth:Math.max(4,Math.min(tail.attachment.baseWidth,128,anchor.value.total*.2))},route:tail.route.kind==='spline'?{kind:'spline',c1:move(tail.route.c1),c2:move(tail.route.c2)}:tail.route.kind==='polyline'?{kind:'polyline',knots:tail.route.knots.map(move)}:{kind:'straight'}};
          }
          selectedIds.push(old.id);
        }else{layer.parentId=session.parentId;layer.matrix=multiply(multiply(multiply(parentInv.value,origin),o.matrix),offset);p.layers[layer.id]=layer;append(p,layer.id,layer.parentId,session.pageId);selectedIds.push(layer.id);}
      }else{
        bytes+=o.source.width*o.source.height*4;
        if(bytes+o.source.width*o.source.height*12>DRAWING_LIMITS.bytes){release();return fail(problem('drawing/memory','本批素材超过256MiB绘画缓冲预算；请减少对象或尺寸，草稿保留'));}
        const asset=await prepareMaterialAsset(o.source,o.name,signal);if(!asset.ok){release();return asset;}resources.push(asset.value);
        const meta=asset.value.meta;
        const same=!old?Object.values(p.assets).find(m=>m.originalHash===meta.originalHash&&m.renderHash===meta.renderHash&&m.drawingSourceHash===meta.drawingSourceHash):undefined;
        const id=same?.id??meta.id;p.assets[id]=same??meta;
        if(old?.type==='image'){p.layers[old.id]={...old,assetId:id,name:o.name,visible:o.visible,matrix:multiply(old.matrix,o.matrix)};selectedIds.push(old.id);}
        else{p.libraryAssetIds??=[];if(!p.libraryAssetIds.includes(id))p.libraryAssetIds.push(id);p.assetLibrary!.assetFolder[id]??=null;const layer=createLayer('image',session.pageId,o.name) as ImageLayer;layer.assetId=id;layer.width=meta.width;layer.height=meta.height;layer.parentId=session.parentId;layer.visible=o.visible;layer.matrix=multiply(multiply(parentInv.value,origin),o.matrix);p.layers[layer.id]=layer;append(p,layer.id,layer.parentId,session.pageId);selectedIds.push(layer.id);}
      }
    }
    const checked=validateProject(p);if(!checked.ok){release();return checked;}
    if(signal.aborted||!sessionCurrent(session)){release();return fail(problem('drawing/cancelled','作品已变化或应用已取消'));}
    return ok({session,afterProject:checked.value,selectedIds,resources});
  }catch(e){release();return fail(problem('drawing/prepare',(e as Error).message));}
}
export function commitDrawingSession(plan:DrawingCommitPlan):Result<Id[]>{
  const a=currentDrawingSession();if(a!==plan.session||!sessionCurrent(plan.session)){plan.resources.forEach(r=>r.bitmap.close());return fail(problem('drawing/stale','绘画草稿已变化，请重新应用'));}
  if(plan.session.targetId&&!plan.session.dirty){cancelDrawingWindow();return ok(plan.selectedIds);}
  const result=execute({label:plan.session.targetId?'修改手绘对象':'应用绘画窗口',context:{pageId:plan.session.pageId,selection:sessionStore.getState().selection},afterSelection:plan.selectedIds,mutate(draft){Object.assign(draft,plan.afterProject);}});
  if(!result.ok){plan.resources.forEach(r=>r.bitmap.close());return result;}
  installDecodedAssets(plan.resources);const release=retainResources(getDocument().project,runtimeStore.getState().blobs,runtimeStore.getState().images);release();cancelDrawingWindow();return ok(plan.selectedIds);
}
