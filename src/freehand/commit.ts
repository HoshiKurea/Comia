import type { Id, ImageLayer, Project, Result } from '../domain/types';
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
import { IDENTITY, inverse, multiply, translation, worldMatrix } from '../geometry/matrix';
import { DRAWING_LIMITS } from './model';
import { prepareMaterialAsset } from './material';
import { cancelDrawingWindow, currentDrawingSession, sessionCurrent, type DrawingSession } from './session';

export interface DrawingCommitPlan { session:DrawingSession;afterProject:Project;selectedIds:Id[];resources:DecodedAsset[] }
function append(p:Project,id:Id,parentId:Id|null,pageId:Id):void{const parent=parentId?p.layers[parentId]:null;if(parent&&'children'in parent)parent.children.push(id);else p.pages[pageId].roots.push(id);}
export async function prepareDrawingCommit(session:DrawingSession,signal:AbortSignal,reservedBytes=0):Promise<Result<DrawingCommitPlan>>{
  if(!Number.isFinite(reservedBytes)||reservedBytes<0||reservedBytes>DRAWING_LIMITS.bytes)return fail(problem('drawing/memory','绘画显示缓冲已超过预算，请关闭窗口并重试'));
  if(!sessionCurrent(session))return fail(problem('drawing/stale','作品已变化，绘画草稿保留；请取消后重新打开'));
  const source=getDocument().project,migrated=migrateProject(structuredClone(source));if(!migrated.ok)return migrated;
  const p=migrated.value,selectedIds:Id[]=[],resources:DecodedAsset[]=[],release=()=>resources.forEach(a=>a.bitmap.close());
  if(session.objects.some(o=>o.kind!=='material'))return fail(problem('drawing/kind','绘画窗口只创作素材'));
  if(session.targetId&&p.layers[session.targetId]?.type!=='image')return fail(problem('drawing/target','绘画窗口只编辑手绘素材实例'));
  if(session.targetId&&!session.dirty)return ok({session,afterProject:p,selectedIds:[session.targetId],resources:[]});
  const objects=session.objects.filter(o=>o.source.strokes.length);
  if(!objects.length)return fail(problem('drawing/empty','请先绘制至少一个对象'));
  let bytes=reservedBytes;
  try {
    for(const o of objects){
      if(signal.aborted||!sessionCurrent(session)){release();return fail(problem('drawing/cancelled','绘画应用已取消或作品已变化'));}
      const old=session.targetId?p.layers[session.targetId]:null;
      if(old&&effectiveLayerFlags(p,old.id).locked){release();return fail(problem('drawing/locked','目标或其祖先已锁定'));}
      const page=p.pages[session.pageId],origin=translation((page.width-session.width)/2,(page.height-session.height)/2),parentInv=session.parentId?inverse(worldMatrix(p,session.parentId)):ok(IDENTITY);if(!parentInv.ok){release();return parentInv;}
        bytes+=o.source.width*o.source.height*4;
        if(bytes+o.source.width*o.source.height*12>DRAWING_LIMITS.bytes){release();return fail(problem('drawing/memory','本批素材超过256MiB绘画缓冲预算；请减少对象或尺寸，草稿保留'));}
        const asset=await prepareMaterialAsset(o.source,o.name,signal);if(!asset.ok){release();return asset;}resources.push(asset.value);
        const meta=asset.value.meta;
        const same=!old?Object.values(p.assets).find(m=>m.originalHash===meta.originalHash&&m.renderHash===meta.renderHash&&m.drawingSourceHash===meta.drawingSourceHash):undefined;
        const id=same?.id??meta.id;p.assets[id]=same??meta;
        if(old?.type==='image'){p.layers[old.id]={...old,assetId:id,name:o.name,visible:o.visible,matrix:multiply(old.matrix,o.matrix)};selectedIds.push(old.id);}
        else{p.libraryAssetIds??=[];if(!p.libraryAssetIds.includes(id))p.libraryAssetIds.push(id);p.assetLibrary!.assetFolder[id]??=null;const layer=createLayer('image',session.pageId,o.name) as ImageLayer;layer.assetId=id;layer.width=meta.width;layer.height=meta.height;layer.parentId=session.parentId;layer.visible=o.visible;layer.matrix=multiply(multiply(parentInv.value,origin),o.matrix);p.layers[layer.id]=layer;append(p,layer.id,layer.parentId,session.pageId);selectedIds.push(layer.id);}
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
