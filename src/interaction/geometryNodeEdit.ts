import { createStore } from 'zustand/vanilla';
import { fail, ok, problem, type Id, type Point, type Project, type Result, type Viewport } from '../domain/types';
import { documentStore, getDocument } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { runtimeStore } from '../state/runtimeStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { apply, inverse, pageToScreen, worldMatrix } from '../geometry/matrix';
import { constrainPanelGeometry } from '../panels/editGeometry';
import { validatePanelGeometry, polygonContained } from '../geometry/simplePolygon';
import { reflowCrop } from '../images/crop';
import { preserveUnlinkedMasks } from '../images/maskGeometry';
import { cancelActiveGesture, registerGestureCanceller } from './activeGesture';
import { execute } from '../history/commandBus';
import { hasLockedDescendant } from '../layers/group';

interface NodeTarget { projectId: Id; pageId: Id; panelId: Id; vertexIndex: number }
interface NodeEdit { base: Project; preview: Project; epoch: number; stateId: Id; target: NodeTarget; delta: Point; held: Set<string> }
export const geometryNodeStore=createStore<{target:NodeTarget|null;active:NodeEdit|null}>(()=>({target:null,active:null}));
let unregister:(()=>void)|null=null;
export const currentNodeEdit=()=>geometryNodeStore.getState().active;
export function selectGeometryNode(panelId:Id,index:number):void {
  const p=getDocument().project,l=p.layers[panelId];if(l?.type!=='panel'||index<0||index>=l.geometry.length)return;
  geometryNodeStore.setState({target:{projectId:p.id,pageId:l.pageId,panelId,vertexIndex:index}});
}
export function clearGeometryNode():void { cancelNodeEdit();geometryNodeStore.setState({target:null}); }
export function pickPanelVertex(project:Project,panelId:Id,screen:Point,vp:Viewport,radius=8):number|null {
  const l=project.layers[panelId];if(l?.type!=='panel')return null;let best=radius,index:number|null=null;
  l.geometry.forEach((v,i)=>{const q=pageToScreen(apply(worldMatrix(project,panelId),v),vp),distance=Math.hypot(q.x-screen.x,q.y-screen.y);if(distance<=best&&(index===null||distance<best)){index=i;best=distance;}});return index;
}
export function constrainNodeGeometry(project:Project,id:Id,candidate:Point[],lastLegal?:Point[]):Point[] {
  const layer=project.layers[id];if(layer.type!=='panel')return [];
  const fallback=lastLegal??layer.geometry;
  if(layer.geometryMode==='simple'&&!validatePanelGeometry({...layer,geometry:candidate}).ok)return fallback;
  const next=constrainPanelGeometry(project,id,candidate);if(!validatePanelGeometry({...layer,geometry:next}).ok)return fallback;
  if(layer.geometryMode==='simple'&&next===layer.geometry&&candidate!==layer.geometry)return fallback;
  // Legacy convex containers are allowed to clip oversized children; retain that contract.
  for(const childId of layer.children){const child=project.layers[childId];if(child?.type==='panel'&&(layer.geometryMode==='simple'||child.geometryMode==='simple')&&!polygonContained(next,child.geometry))return fallback;}
  return next;
}
export function cancelNodeEdit():void {
  if(!currentNodeEdit())return;unregister?.();unregister=null;geometryNodeStore.setState({active:null});runtimeStore.setState({previewProject:null,gestureActive:false});
}
export function commitNodeEdit():Result<void> {
  const active=currentNodeEdit();if(!active)return ok(undefined);const doc=getDocument();
  if(doc.epoch!==active.epoch||doc.history.stateId!==active.stateId){cancelNodeEdit();return fail(problem('node/stale','项目已变化，节点预览已取消'));}
  cancelNodeEdit();
  const result=execute({label:'方向键调整分镜节点',context:{pageId:active.target.pageId,selection:[active.target.panelId]},afterSelection:[active.target.panelId],mutate(draft){
    for(const [id,layer]of Object.entries(active.preview.layers))if(layer!==active.base.layers[id])draft.layers[id]=structuredClone(layer);
  }});return result.ok?ok(undefined):result;
}
export function nodeKeyboard(event:KeyboardEvent):Result<boolean> {
  let target=geometryNodeStore.getState().target;const doc=getDocument(),s=sessionStore.getState();
  if(!target&&s.toolMode==='geometry'&&s.selection.length===1){selectGeometryNode(s.selection[0],0);target=geometryNodeStore.getState().target;}
  if(!target||target.projectId!==doc.project.id||target.pageId!==s.activePageId||s.selection.length!==1||s.selection[0]!==target.panelId)return ok(false);
  const layer=doc.project.layers[target.panelId],flags=effectiveLayerFlags(doc.project,target.panelId);
  if(layer?.type!=='panel'||!flags.visible||flags.locked||hasLockedDescendant(doc.project,target.panelId))return ok(false);
  if(event.altKey&&!event.ctrlKey&&!event.metaKey&&['ArrowLeft','ArrowRight'].includes(event.key)){
    const done=commitNodeEdit();if(!done.ok)return done;selectGeometryNode(target.panelId,(target.vertexIndex+(event.key==='ArrowRight'?1:-1)+layer.geometry.length)%layer.geometry.length);return ok(true);
  }
  if(!(event.ctrlKey||event.metaKey)||event.altKey||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return ok(false);
  let active=currentNodeEdit();if(!active){cancelActiveGesture();active={base:doc.project,preview:doc.project,epoch:doc.epoch,stateId:doc.history.stateId,target,delta:{x:0,y:0},held:new Set()};unregister=registerGestureCanceller(cancelNodeEdit);}
  active.held.add(event.key);const step=event.shiftKey?10:1;
  const delta={x:active.delta.x+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),y:active.delta.y+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0)};
  const original=active.base.layers[target.panelId];if(original.type!=='panel')return ok(false);const inv=inverse(worldMatrix(active.base,target.panelId));if(!inv.ok){cancelNodeEdit();return inv;}
  const vertex=original.geometry[target.vertexIndex],q={x:vertex.x+inv.value[0]*delta.x+inv.value[2]*delta.y,y:vertex.y+inv.value[1]*delta.x+inv.value[3]*delta.y};
  const previous=active.preview.layers[target.panelId];
  const geometry=constrainNodeGeometry(active.base,target.panelId,original.geometry.map((v,i)=>i===target!.vertexIndex?q:v),previous.type==='panel'?previous.geometry:undefined);
  const preview={...active.base,layers:{...active.base.layers,[target.panelId]:{...original,geometry}}};
  for(const id of original.children){const child=preview.layers[id];if(child.type==='image'&&child.crop)preview.layers[id]={...child,crop:reflowCrop(geometry,{x:child.width,y:child.height},child.crop)};}
  const accepted={x:geometry[target.vertexIndex].x-vertex.x,y:geometry[target.vertexIndex].y-vertex.y},world=worldMatrix(active.base,target.panelId),actualDelta={x:world[0]*accepted.x+world[2]*accepted.y,y:world[1]*accepted.x+world[3]*accepted.y};
  preserveUnlinkedMasks(active.base,preview);geometryNodeStore.setState({active:{...active,delta:actualDelta,preview}});runtimeStore.setState({previewProject:preview,gestureActive:true});return ok(true);
}
export function nodeKeyUp(key:string):Result<void> {const active=currentNodeEdit();if(!active)return ok(undefined);active.held.delete(key);return active.held.size?ok(undefined):commitNodeEdit();}
sessionStore.subscribe((s,old)=>{const target=geometryNodeStore.getState().target;if(target&&(s.activePageId!==target.pageId||s.selection.length!==1||s.selection[0]!==target.panelId||s.toolMode!==old.toolMode))clearGeometryNode();});
documentStore.subscribe((doc)=>{const target=geometryNodeStore.getState().target;if(target&&(!doc.project.layers[target.panelId]||doc.project.id!==target.projectId))clearGeometryNode();});
