import {recordDrawingInput,recordDrawingCommit} from '../freehand/metrics';
import {nextDrawingName} from './commands';
import {composeBubble} from '../bubbles/composeBubble';
import { createStore } from 'zustand/vanilla';
import { fail, ok, problem, type BubbleLayer, type DecorationLayer, type Id, type InkSample, type InkStroke, type Mat, type Point, type Project, type Rect, type Result, type Viewport } from '../domain/types';
import { createLayer } from '../domain/factories';
import { newId } from '../domain/id';
import { apply, clientToPage, inverse, worldMatrix, scaling, multiply, translation } from '../geometry/matrix';
import { getDocument, documentStore } from '../state/documentStore';
import { runtimeStore } from '../state/runtimeStore';
import { sessionStore } from '../state/sessionStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { execute } from '../history/commandBus';
import { cancelActiveGesture, registerGestureCanceller } from '../interaction/activeGesture';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { migrateProject } from '../storage/migrateProject';
import { DEFAULT_PEN, flashPreset, PAINT_LIMITS, parseComicSpec } from './model';
import { correctPen } from './geometry';
import { strokeCrossesBrush } from './paint';
import type { FlashOptions } from './types';

export interface ComicDraft { epoch:number;stateId:Id;pageId:Id;layerId:Id;sceneBase:Project;preview:Project;raw:InkSample[];rect:Rect;viewport:Viewport;inverse:Mat;mode:'flash-bubble'|'paint-pen'|'paint-eraser';strokeId:Id;pressureMode:InkStroke['pressureMode'];valid:boolean;flash:FlashOptions;options:PaintOptions }
export interface PaintOptions { width:number;color:string;opacity:number;pressure:boolean;stabilization:number }
export const comicDrawStore=createStore<{active:ComicDraft|null;flash:FlashOptions;paint:PaintOptions}>(()=>({active:null,flash:flashPreset('urchin'),paint:{width:12,color:'#000000FF',opacity:1,pressure:true,stabilization:.2}}));
export const currentComicDraw=()=>comicDrawStore.getState().active;
export function setComicPaintOptions(patch:Partial<PaintOptions>):Result<void> {
  const p={...comicDrawStore.getState().paint,...patch};if(!Number.isFinite(p.width)||p.width<1||p.width>512||!Number.isFinite(p.opacity)||p.opacity<0||p.opacity>1||!Number.isFinite(p.stabilization)||p.stabilization<0||p.stabilization>.9||typeof p.pressure!=='boolean'||!/^#[a-f0-9]{8}$/i.test(p.color))return fail(problem('drawing/options','笔刷尺寸1～512、不透明度0～100%、防抖0～0.9，颜色为RGBA'));
  comicDrawStore.setState({paint:{...p,color:p.color.toUpperCase()}});return ok(undefined);
}
let cleanup:(()=>void)[]=[];
export function cancelComicDraw():void {if(!currentComicDraw())return;const callbacks=cleanup;cleanup=[];callbacks.forEach(fn=>fn());comicDrawStore.setState({active:null});runtimeStore.setState({gestureActive:false,previewProject:null});}
export function activateComicTool(mode:ComicDraft['mode']):Result<void> {const t=finishActiveTextEdit();if(!t.ok)return t;cancelActiveGesture();sessionStore.setState({toolMode:mode});return ok(undefined);}
export function beginComicDraw(client:Point,rect:Rect,viewport:Viewport,pen=false,pressure=.5):Result<void> {
  if(![client.x,client.y,rect.x,rect.y,rect.width,rect.height,viewport.zoom,viewport.pan.x,viewport.pan.y,pressure].every(Number.isFinite)||viewport.zoom<=0||rect.width<=0||rect.height<=0||pressure<0||pressure>1)return fail(problem('drawing/coordinates','画布坐标、缩放或压力无效'));
  if(currentComicDraw())return fail(problem('drawing/active','请先结束当前一笔'));
  const text=finishActiveTextEdit();if(!text.ok)return text;cancelActiveGesture();
  const d=getDocument(),s=sessionStore.getState(),mode=s.toolMode;if(mode!=='flash-bubble'&&mode!=='paint-pen'&&mode!=='paint-eraser')return fail(problem('drawing/tool','请选择绘画工具'));
  const page=d.project.pages[s.activePageId],point=clientToPage(client,{left:rect.x,top:rect.y},viewport);
  if(!page||s.spacePan||point.x<0||point.y<0||point.x>page.width||point.y>page.height)return fail(problem('drawing/outside','请从页面内开始绘制'));
  const migrated=migrateProject(d.project);if(!migrated.ok)return migrated;let sceneBase=migrated.value,layerId=s.selection[0];
  if(mode==='flash-bubble'){
    const b=createLayer('bubble',page.id,nextDrawingName('效果线气泡')) as BubbleLayer;let parentId=s.scopeId;
    while(parentId){const node=sceneBase.layers[parentId];if(!node)return fail(problem('drawing/scope','当前容器已失效'));if(node.type==='group'&&!node.dialogue)break;parentId=node.parentId;}
    if(parentId){const flags=effectiveLayerFlags(sceneBase,parentId);if(flags.locked||!flags.visible)return fail(problem('drawing/locked','请先显示并解锁所属组'));}b.parentId=parentId;layerId=b.id;b.shape='ellipse';b.width=b.height=16;b.style.borderWidth=0;b.visible=false;sceneBase={...sceneBase,layers:{...sceneBase.layers,[b.id]:b},pages:{...sceneBase.pages,[page.id]:{...page,roots:parentId?[...page.roots]:[...page.roots,b.id]}}};
    if(parentId){const parent=sceneBase.layers[parentId];if(parent.type==='group')sceneBase.layers[parentId]={...parent,children:[...parent.children,b.id]};}
  }else{const layer=sceneBase.layers[layerId];if(s.selection.length!==1||layer?.type!=='decoration'||layer.spec.kind!=='paint')return fail(problem('drawing/target','请先在“图层→新建图层”添加或选择栅格／矢量绘画图层'));const flags=effectiveLayerFlags(sceneBase,layerId);if(flags.locked||!flags.visible)return fail(problem('drawing/locked','绘画图层或所属组已锁定／隐藏'));}
  const inv=inverse(worldMatrix(sceneBase,layerId));if(!inv.ok)return inv;
  const config=comicDrawStore.getState(),start=apply(inv.value,point);if(mode!=='flash-bubble'){const l=sceneBase.layers[layerId] as DecorationLayer,r=config.paint.width/2;if(l.spec.kind==='paint'&&(start.x < -r||start.y < -r||start.x > l.spec.width+r||start.y > l.spec.height+r))return fail(problem('drawing/extent','请从绘画图层的画板范围内开始'));}
  const a:ComicDraft={epoch:d.epoch,stateId:d.history.stateId,pageId:page.id,layerId,sceneBase,preview:sceneBase,raw:[{...apply(inv.value,point),pressure,dt:0}],rect:{...rect},viewport:structuredClone(viewport),inverse:inv.value,mode,strokeId:newId(),pressureMode:pen&&config.paint.pressure?'pen':'fixed',valid:false,flash:structuredClone(config.flash),options:{...config.paint}};
  comicDrawStore.setState({active:a});runtimeStore.setState({gestureActive:true});
  cleanup=[registerGestureCanceller(cancelComicDraw),documentStore.subscribe(n=>{if(n.epoch!==a.epoch||n.history.stateId!==a.stateId)cancelComicDraw();}),sessionStore.subscribe(n=>{if(n.activePageId!==a.pageId||n.toolMode!==mode||n.scopeId!==s.scopeId||n.spacePan||JSON.stringify(n.viewportByPage[page.id])!==JSON.stringify(s.viewportByPage[page.id])||mode!=='flash-bubble'&&(n.selection.length!==1||n.selection[0]!==layerId))cancelComicDraw();})];
  return mode==='flash-bubble'?ok(undefined):appendComicDraw([]);
}
export function appendComicDraw(clients:readonly (Point&{pressure?:number})[]):Result<void> {
  const started=performance.now();
  const a=currentComicDraw();if(!a)return fail(problem('drawing/inactive','没有活动笔迹'));const raw=[...a.raw],layer=a.sceneBase.layers[a.layerId];
  for(const c of clients){const p=apply(a.inverse,clientToPage(c,{left:a.rect.x,top:a.rect.y},a.viewport));if(![p.x,p.y,c.pressure??.5].every(Number.isFinite)){cancelComicDraw();return fail(problem('drawing/point','坐标或压力无效，已取消这一笔'));}
    if(a.mode!=='flash-bubble'&&(Math.abs(p.x)>8192||Math.abs(p.y)>8192)){cancelComicDraw();return fail(problem('drawing/point-budget','笔迹超出8192像素坐标预算，已取消这一笔'));}
    if(Math.hypot(p.x-raw.at(-1)!.x,p.y-raw.at(-1)!.y)<1e-6)continue;
    if(raw.length>=8192){cancelComicDraw();return fail(problem('drawing/budget','单笔最多8192点，已取消这一笔'));}raw.push({...p,pressure:Math.max(0,Math.min(1,c.pressure??raw.at(-1)!.pressure)),dt:0});}
  let next:BubbleLayer|DecorationLayer;
  if(a.mode==='flash-bubble'){
    const first=raw[0],last=raw.at(-1)!,width=Math.abs(last.x-first.x),height=Math.abs(last.y-first.y);if(width<16||height<16){comicDrawStore.setState({active:{...a,raw,valid:false}});return ok(undefined);}
    if(width>16384||height>16384){cancelComicDraw();return fail(problem('drawing/flash-size','效果线主体最长边为16384像素'));}
    next={...layer as BubbleLayer,visible:true,width,height,matrix:translation(Math.min(first.x,last.x),Math.min(first.y,last.y)),flash:{...a.flash,seed:a.flash.seed},style:{...(layer as BubbleLayer).style,fill:'#FFFFFFFF',borderColor:a.flash.preset==='inverse'?'#FFFFFFFF':'#000000FF'}};
  }else{
    const old=layer as DecorationLayer;if(old.spec.kind!=='paint')return fail(problem('drawing/target','绘画图层失效'));
    const samples=correctPen(raw,multiply(scaling(a.viewport.zoom,a.viewport.zoom),worldMatrix(a.sceneBase,a.layerId)),{...DEFAULT_PEN,stabilization:a.options.stabilization,postCorrection:.5,pressure:a.pressureMode==='pen'});
    const stroke:InkStroke={id:a.strokeId,points:samples,width:a.options.width,color:a.options.color,opacity:a.options.opacity,pressureMode:a.pressureMode,tool:a.mode==='paint-eraser'?'eraser':'pen'};
    const strokes=old.spec.mode==='vector'&&stroke.tool==='eraser'?old.spec.strokes.filter(s=>!strokeCrossesBrush(s,stroke)):[...old.spec.strokes,stroke];
    const spec={...old.spec,strokes};const valid=parseComicSpec(spec);if(!valid.ok){cancelComicDraw();return valid;}next={...old,spec};
    if(strokes.reduce((n,s)=>n+s.points.length,0)>PAINT_LIMITS.points){cancelComicDraw();return fail(problem('drawing/budget','图层最多65536点，已取消这一笔'));}
  }
  const preview={...a.sceneBase,layers:{...a.sceneBase.layers,[next.id]:next}};if(next.type==='bubble'){const valid=composeBubble(preview,next.id);if(!valid.ok){cancelComicDraw();return valid;}}comicDrawStore.setState({active:{...a,raw,preview,valid:true}});runtimeStore.setState({previewProject:preview});recordDrawingInput(started);return ok(undefined);
}
export function finishComicDraw():Result<Id|null> {
  const started=performance.now();
  const a=currentComicDraw();if(!a)return fail(problem('drawing/inactive','没有活动笔迹'));const d=getDocument();if(d.epoch!==a.epoch||d.history.stateId!==a.stateId){cancelComicDraw();return fail(problem('drawing/stale','文档已改变，已取消这一笔'));}
  if(!a.valid){cancelComicDraw();return fail(problem('drawing/empty','请拖出至少16×16像素的效果线范围'));}
  const layer=structuredClone(a.preview.layers[a.layerId]);cancelComicDraw();
  if(layer.type==='decoration'&&layer.spec.kind==='paint'&&a.sceneBase.layers[layer.id]?.type==='decoration'&&JSON.stringify(layer)===JSON.stringify(a.sceneBase.layers[layer.id]))return ok(null);
  const r=execute({context:{pageId:a.pageId,selection:sessionStore.getState().selection},label:a.mode==='flash-bubble'?'绘制效果线气泡':a.mode==='paint-eraser'?'擦除绘画':'绘画笔迹',mutate:p=>{const m=migrateProject(p);if(!m.ok)throw Error(m.problems[0].message);Object.assign(p,m.value);p.layers[layer.id]=layer;if(a.mode==='flash-bubble'){const parent=layer.parentId?p.layers[layer.parentId]:null;if(parent?.type==='group')parent.children.push(layer.id);else p.pages[a.pageId].roots.push(layer.id);}}});
  if(r.ok){sessionStore.setState({selection:[layer.id]});recordDrawingCommit(started);}return r.ok?ok(layer.id):r;
}
