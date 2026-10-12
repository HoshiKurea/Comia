import {fail,ok,problem,type Id,type Mat,type Point,type Project,type Result,type Viewport} from '../domain/types';
import {getDocument} from '../state/documentStore';
import {sessionStore,setSelection} from '../state/sessionStore';
import {effectiveLayerFlags} from '../state/effectiveFlags';
import {apply,inverse,worldMatrix} from '../geometry/matrix';
import {maxSingularValue} from '../geometry/flattenForBoolean';
import {beginDrawing,currentDrawing,drawingStore,finishDrawing,setRawDrawing} from '../panels/drawingController';
export interface ToolCutPointer {pointerId:number;targetId:Id;pageId:Id;base:Project;epoch:number;stateId:Id;viewport:Viewport;inverseWorld:Mat;startLocal:Point;endLocal:Point;zoom:number}
export function setPanelCutGap(gap:number):Result<void>{
  sessionStore.setState({panelCutGap:gap});const active=currentDrawing();
  if(active?.kind==='line'){drawingStore.setState({active:{...active,gap}});if(active.raw.length===2)setRawDrawing(active.raw,active.zoom);}
  return Number.isFinite(gap)&&gap>=0&&gap<=256?ok(undefined):fail(problem('tool/cut-gap','切割间隙须为0～256px'));
}
export function beginPanelCutTarget(id:Id):Result<void>{
  const doc=getDocument(),s=sessionStore.getState(),l=doc.project.layers[id],flags=effectiveLayerFlags(doc.project,id);
  if(l?.type!=='panel'||l.pageId!==s.activePageId||!flags.visible||flags.locked)return fail(problem('tool/cut-target','请选择同页可见且未锁定的分镜'));
  const invertible=inverse(worldMatrix(doc.project,id));if(!invertible.ok)return invertible;
  if(!Number.isFinite(s.panelCutGap)||s.panelCutGap<0||s.panelCutGap>256)return fail(problem('tool/cut-gap','请先将切割间隙改为0～256px'));
  const r=beginDrawing('line',id);if(!r.ok)return r;
  const active=currentDrawing()!;drawingStore.setState({active:{...active,gap:s.panelCutGap}});setSelection([id],id);return ok(undefined);
}
export function beginPanelCutPointer(id:Id,pointerId:number,pagePoint:Point,viewport:Viewport):Result<ToolCutPointer>{
  if(!Number.isFinite(pagePoint.x)||!Number.isFinite(pagePoint.y)||!Number.isFinite(viewport.zoom)||viewport.zoom<=0)return fail(problem('tool/cut-point','切割坐标或缩放无效'));
  const started=beginPanelCutTarget(id);if(!started.ok)return started;const active=currentDrawing()!,world=worldMatrix(active.base,id),inv=inverse(world);if(!inv.ok)return inv;
  const local=apply(inv.value,pagePoint),zoom=viewport.zoom*maxSingularValue(world);
  const p:ToolCutPointer={pointerId,targetId:id,pageId:active.pageId,base:active.base,epoch:active.epoch,stateId:active.stateId,viewport:structuredClone(viewport),inverseWorld:inv.value,startLocal:local,endLocal:local,zoom};setRawDrawing([local],zoom);return ok(p);
}
export function updatePanelCutPointer(p:ToolCutPointer,pagePoint:Point):Result<void>{
  const doc=getDocument(),a=currentDrawing();if(!a||a.kind!=='line'||a.targetId!==p.targetId||doc.project!==p.base||doc.epoch!==p.epoch||doc.history.stateId!==p.stateId||sessionStore.getState().activePageId!==p.pageId)return fail(problem('tool/cut-stale','切割目标或作品已变化，请重新绘制'));
  if(!Number.isFinite(pagePoint.x)||!Number.isFinite(pagePoint.y))return fail(problem('tool/cut-point','切割坐标无效'));
  p.endLocal=apply(p.inverseWorld,pagePoint);setRawDrawing([p.startLocal,p.endLocal],p.zoom);return ok(undefined);
}
export function finishPanelCutPointer(p:ToolCutPointer,pagePoint:Point):Result<void>{const r=updatePanelCutPointer(p,pagePoint);return r.ok?finishDrawing():r;}
