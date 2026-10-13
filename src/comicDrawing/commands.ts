import type { DecorationLayer, Id, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { createLayer } from '../domain/factories';
import { execute } from '../history/commandBus';
import { getDocument } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { cancelActiveGesture } from '../interaction/activeGesture';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { inverse, worldMatrix } from '../geometry/matrix';
import { migrateProject } from '../storage/migrateProject';
import type { BackgroundFillSpec } from './types';

export type ComicLayerKind = 'raster'|'vector'|'solid'|'gradient'|'tone';
export const COMIC_LAYER_LABELS:Record<ComicLayerKind,string>={raster:'栅格绘画图层',vector:'矢量绘画图层',solid:'纯色背景图层',gradient:'渐变背景图层',tone:'网点图层'};
export function nextDrawingName(prefix:string):string {
  const names=Object.values(getDocument().project.layers).map(l=>l.name),numbers=names.filter(n=>n.startsWith(prefix+' ')).map(n=>Number(n.slice(prefix.length+1))).filter(Number.isSafeInteger);
  return `${prefix} ${Math.max(0,...numbers)+1}`;
}
export function createComicLayer(kind:ComicLayerKind):Result<Id> {
  const text=finishActiveTextEdit();if(!text.ok)return text;cancelActiveGesture();
  const d=getDocument(),s=sessionStore.getState(),page=d.project.pages[s.activePageId];if(!page)return fail(problem('drawing/page','当前页面无效'));
  if(page.width>8192||page.height>8192)return fail(problem('drawing/size','绘画图层支持最长边8192像素，请先调整页面大小'));
  let parentId=s.scopeId;while(parentId){const node=d.project.layers[parentId];if(!node)return fail(problem('drawing/scope','当前容器已失效'));if(node.type==='group'&&!node.dialogue)break;parentId=node.parentId;}
  if(parentId&&(!effectiveLayerFlags(d.project,parentId).visible||effectiveLayerFlags(d.project,parentId).locked))return fail(problem('drawing/locked','请先显示并解锁所属组'));
  const inv=parentId?inverse(worldMatrix(d.project,parentId)):ok([1,0,0,1,0,0] as [number,number,number,number,number,number]);if(!inv.ok)return inv;
  const layer=createLayer('decoration',page.id,nextDrawingName(COMIC_LAYER_LABELS[kind])) as DecorationLayer;layer.parentId=parentId;layer.matrix=inv.value;
  layer.spec=kind==='raster'||kind==='vector'?{kind:'paint',mode:kind,width:page.width,height:page.height,strokes:[]}:
    {kind:'background-fill',mode:kind,width:page.width,height:page.height,color:'#000000FF',secondary:'#FFFFFF00',angle:0,frequency:60,density:25,dpi:page.dpi};
  if(layer.spec.kind==='background-fill'&&kind==='solid')layer.spec.color='#FFFFFFFF';
  const r=execute({context:{pageId:page.id,selection:s.selection},label:'新建'+COMIC_LAYER_LABELS[kind],mutate:p=>{const migrated=migrateProject(p);if(!migrated.ok)throw Error(migrated.problems[0].message);Object.assign(p,migrated.value);p.layers[layer.id]=layer;const parent=parentId?p.layers[parentId]:null,roots=parent?.type==='group'?parent.children:p.pages[page.id].roots;
    // Background fills sit immediately above paper; drawing remains above other content.
    if(layer.spec.kind==='background-fill'){const selected=roots.indexOf(s.selection[0]);const at=selected>=0&&p.layers[s.selection[0]]?.type==='decoration'&&(p.layers[s.selection[0]] as DecorationLayer).spec.kind==='background-fill'?selected+1:roots[0]&&p.layers[roots[0]]?.type==='pageBackground'?1:0;roots.splice(at,0,layer.id);}else roots.push(layer.id);}});
  if(r.ok)sessionStore.setState({selection:[layer.id],toolMode:kind==='raster'||kind==='vector'?'paint-pen':'select'});return r.ok?ok(layer.id):r;
}
export function fillModeLabel(spec:BackgroundFillSpec):string{return COMIC_LAYER_LABELS[spec.mode];}
