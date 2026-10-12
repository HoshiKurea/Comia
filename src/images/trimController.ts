import { createStore } from 'zustand/vanilla';
import { fail, ok, problem, type Id, type ImageLayer, type Project, type Rect, type Result } from '../domain/types';
import { getDocument,documentStore } from '../state/documentStore';
import { runtimeStore } from '../state/runtimeStore';
import { sessionStore } from '../state/sessionStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { cancelActiveGesture,registerGestureCanceller } from '../interaction/activeGesture';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { execute } from '../history/commandBus';
import { migrateProject } from '../storage/migrateProject';
import { freeImage } from './freeImage';
import { trimImage,restoreImageSourceWindow } from './trimGeometry';
import { retainResources } from '../storage/blobRepository';
interface ImageTrimDraft { imageId:Id;pageId:Id;parentId:Id|null;base:Project;display:Project;preview:Project;epoch:number;stateId:Id;rect:Rect }
export const trimEditStore=createStore<{active:ImageTrimDraft|null}>(()=>({active:null}));
export const currentImageTrim=()=>trimEditStore.getState().active;
let cleanups:(()=>void)[]=[];
export function cancelImageTrim():void{if(!currentImageTrim())return;trimEditStore.setState({active:null});for(const f of cleanups)f();cleanups=[];runtimeStore.setState({previewProject:null,gestureActive:false});}
export function beginImageTrim(id:Id):Result<void>{
 const text=finishActiveTextEdit();if(!text.ok)return text;cancelActiveGesture();const doc=getDocument(),l=doc.project.layers[id],s=sessionStore.getState(),flags=effectiveLayerFlags(doc.project,id);
 if(l?.type!=='image'||l.pageId!==s.activePageId||!flags.visible||flags.locked)return fail(problem('trim/target','请选择当前页可见且未锁定的素材'));
 const migrated=migrateProject(doc.project);if(!migrated.ok)return migrated;const display=migrated.value;let image:ImageLayer;try{image=freeImage(display,id);}catch{return fail(problem('trim/cover','无法冻结框内图片映射'));}display.layers[id]=image;
 const rect={x:0,y:0,width:image.width,height:image.height},vp=JSON.stringify(s.viewportByPage[l.pageId]);trimEditStore.setState({active:{imageId:id,pageId:l.pageId,parentId:l.parentId,base:doc.project,display,preview:display,epoch:doc.epoch,stateId:doc.history.stateId,rect}});runtimeStore.setState({previewProject:display,gestureActive:true});sessionStore.setState({selection:[id],toolMode:'image-crop'});
 cleanups=[retainResources(doc.project),registerGestureCanceller(cancelImageTrim),sessionStore.subscribe(n=>{if(currentImageTrim()&&(n.activePageId!==l.pageId||n.toolMode!=='image-crop'||!n.selection.includes(id)||JSON.stringify(n.viewportByPage[l.pageId])!==vp))cancelImageTrim();}),documentStore.subscribe(n=>{if(currentImageTrim()&&(n.epoch!==doc.epoch||n.history.stateId!==doc.history.stateId))cancelImageTrim();})];return ok(undefined);
}
export function previewImageTrim(rect:Rect):Result<void>{const a=currentImageTrim();if(!a)return fail(problem('trim/inactive','请先选择待裁剪素材'));const r=trimImage(a.display,a.imageId,rect);if(!r.ok)return r;const original=a.display.layers[a.imageId] as ImageLayer,x=Math.max(0,rect.x),y=Math.max(0,rect.y),next={x,y,width:Math.min(original.width,rect.x+rect.width)-x,height:Math.min(original.height,rect.y+rect.height)-y};trimEditStore.setState({active:{...a,rect:next,preview:{...a.display,layers:{...a.display.layers,[a.imageId]:r.value}}}});return ok(undefined);}
export function commitImageTrim():Result<void>{const a=currentImageTrim();if(!a)return ok(undefined);const doc=getDocument(),l=doc.project.layers[a.imageId];if(doc.epoch!==a.epoch||doc.history.stateId!==a.stateId||l?.type!=='image'||l.parentId!==a.parentId){cancelImageTrim();return fail(problem('trim/stale','裁剪目标已变化，草稿已取消'));}const flags=effectiveLayerFlags(doc.project,l.id);if(flags.locked||!flags.visible){cancelImageTrim();return fail(problem('trim/locked','素材已锁定或隐藏'));}
 const full=a.display.layers[l.id] as ImageLayer;if(a.rect.x===0&&a.rect.y===0&&a.rect.width===full.width&&a.rect.height===full.height){cancelImageTrim();return ok(undefined);}const r=trimImage(a.display,l.id,a.rect);if(!r.ok)return r;cancelImageTrim();const done=execute({label:'裁剪素材实例',context:{pageId:a.pageId,selection:[l.id]},afterSelection:[l.id],mutate(p){const m=migrateProject(p);if(!m.ok)throw Error(m.problems[0].message);Object.assign(p,m.value);p.layers[l.id]=r.value;}});return done.ok?ok(undefined):done;
}
export function restoreImageTrim(id:Id):Result<void>{const p=getDocument().project,l=p.layers[id],flags=effectiveLayerFlags(p,id);if(l?.type!=='image'||flags.locked||!flags.visible)return fail(problem('trim/restore-target','请选择未锁定素材'));cancelActiveGesture();const r=restoreImageSourceWindow(p,id);if(!r.ok)return r;const done=execute({label:'恢复素材裁剪',context:{pageId:l.pageId,selection:[id]},afterSelection:[id],mutate(p){p.layers[id]=r.value;}});return done.ok?ok(undefined):done;}
