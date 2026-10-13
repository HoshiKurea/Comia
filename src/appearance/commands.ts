import { createStore } from 'zustand/vanilla';
import type { Id, Layer, LayerPresentation, Point, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { getDocument, getProject, documentStore } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { runtimeStore } from '../state/runtimeStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { hasLockedDescendant } from '../layers/group';
import { execute } from '../history/commandBus';
import { cancelActiveGesture, registerGestureCanceller } from '../interaction/activeGesture';
import { retainResources } from '../storage/blobRepository';
import { migrateProject } from '../storage/migrateProject';
import { layerPaint, parsePresentation, presentation } from './model';
import { composeBubble } from '../bubbles/composeBubble';
import { mainBubbleText } from '../bubbles/ownership';
import { bubbleFrameBounds } from '../text/bubbleFrameBounds';
import { prepareDialogue } from '../bubbles/dialogueGeometry';
import { recordDrawingInput,recordDrawingCommit } from '../freehand/metrics';
import { selectionRoots } from '../interaction/selectionTransform';
import { finishActiveTextEdit } from '../text/editLifecycle';

interface AppearanceDraft { base: Project; initial:Project; preview: Project; ids: Id[]; epoch: number; stateId: Id; pageId: Id; label: string; token:number }
export const appearanceEditStore = createStore<{ active: AppearanceDraft | null }>(() => ({ active: null }));
export const currentAppearanceEdit = () => appearanceEditStore.getState().active;
let cleanup: (() => void)[] = [];
let draftSequence=0;
export function appearanceGuard(project: Project, ids: readonly Id[]): Result<void> {
  if(!ids.length || ids.some(id => !project.layers[id]))return fail(problem('appearance/selection','请选择要编辑的对象'));
  const page=project.layers[ids[0]].pageId;
  if(ids.some(id => project.layers[id].pageId!==page || effectiveLayerFlags(project,id).locked || hasLockedDescendant(project,id)))return fail(problem('appearance/locked','选区跨页或包含锁定对象／子层，整批操作未应用'));
  return ok(undefined);
}
export function cancelAppearanceEdit(): void {
  if(!currentAppearanceEdit())return;
  for(const stop of cleanup.splice(0))stop(); appearanceEditStore.setState({active:null});runtimeStore.setState({previewProject:null,gestureActive:false});
}
export function beginAppearanceEdit(ids: Id[], label='修改图层外观'): Result<void> {
  const text=finishActiveTextEdit();if(!text.ok)return text;
  ids=selectionRoots(getProject(),ids);
  const active=currentAppearanceEdit();if(active&&active.ids.join('|')===ids.join('|'))return ok(undefined);
  cancelActiveGesture();const doc=getDocument(),guard=appearanceGuard(doc.project,ids);if(!guard.ok)return guard;
  const migrated=migrateProject(doc.project);if(!migrated.ok)return migrated;
  const pageId=doc.project.layers[ids[0]].pageId,selection=sessionStore.getState().selection.join('|');
  appearanceEditStore.setState({active:{base:doc.project,initial:migrated.value,preview:migrated.value,ids:[...ids],epoch:doc.epoch,stateId:doc.history.stateId,pageId,label,token:++draftSequence}});runtimeStore.setState({gestureActive:true,previewProject:migrated.value});
  cleanup=[retainResources(doc.project),registerGestureCanceller(cancelAppearanceEdit),documentStore.subscribe(d=>{if(d.epoch!==doc.epoch||d.history.stateId!==doc.history.stateId)cancelAppearanceEdit();}),sessionStore.subscribe(s=>{if(s.activePageId!==pageId||s.selection.join('|')!==selection)cancelAppearanceEdit();})];return ok(undefined);
}
export function previewAppearance(change: (layer: Layer) => void): Result<void> {
  const started=performance.now();
  const a=currentAppearanceEdit();if(!a)return fail(problem('appearance/inactive','没有外观草稿'));
  const preview={...a.preview,layers:{...a.preview.layers}};
  for(const id of a.ids){const l=structuredClone(preview.layers[id]);change(l);if(!a.base.layers[id].presentation&&l.presentation&&JSON.stringify(l.presentation)===JSON.stringify(presentation({...l,presentation:undefined})))delete l.presentation;if(l.presentation){const parsed=parsePresentation(l.presentation);if(!parsed.ok)return parsed;l.presentation=parsed.value;}const paint=layerPaint(l);if(paint&&(!/^#[0-9A-F]{8}$/i.test(paint.fill)||!/^#[0-9A-F]{8}$/i.test(paint.borderColor)||!Number.isFinite(paint.borderWidth)||paint.borderWidth<0||paint.borderWidth>256||!Number.isFinite(paint.radius)||paint.radius<0||paint.radius>4096))return fail(problem('appearance/paint','颜色／边宽／圆角参数无效'));preview.layers[id]=l;if(l.type==='bubble'){const checked=composeBubble(preview,id);if(!checked.ok)return checked;}}
  for(const id of a.ids){const l=preview.layers[id];if(l.type==='group'&&l.dialogue&&l.dialogue.mode!=='fused'){const old=a.preview.layers[id];if(old.type==='group'&&old.dialogue&&JSON.stringify(old.dialogue.fusionStyle)!==JSON.stringify(l.dialogue.fusionStyle))for(const cid of l.children){const c=preview.layers[cid];if(c.type==='bubble')preview.layers[cid]={...c,style:structuredClone(l.dialogue.fusionStyle)};}}}
  for(const id of a.ids.flatMap(id=>{const l=preview.layers[id];return l.type==='group'&&l.dialogue?[id,...l.children]:[id];})){const l=preview.layers[id];if(l.type==='bubble'){const text=mainBubbleText(preview,id),geometry=composeBubble(preview,id);if(text&&geometry.ok){const box=text.bubbleFrame?bubbleFrameBounds(preview,text.id)?.box:geometry.value.textBox;if(box)preview.layers[text.id]={...text,box:{...box}};}}}
  for(const id of a.ids){const l=preview.layers[id];if(l.type==='group'&&l.dialogue){const checked=prepareDialogue(preview,id);if(!checked.ok)return checked;}}
  appearanceEditStore.setState({active:{...a,preview}});runtimeStore.setState({previewProject:preview});recordDrawingInput(started);return ok(undefined);
}
export function commitAppearanceEdit(): Result<void> {
  const a=currentAppearanceEdit();if(!a)return ok(undefined);const doc=getDocument();if(doc.epoch!==a.epoch||doc.history.stateId!==a.stateId){cancelAppearanceEdit();return fail(problem('appearance/stale','作品已变化，外观草稿已取消'));}
  const started=performance.now();cancelAppearanceEdit();if(JSON.stringify(a.initial)===JSON.stringify(a.preview))return ok(undefined);const result=execute({label:a.label,context:{pageId:a.pageId,selection:sessionStore.getState().selection},mutate(p){Object.assign(p,a.preview);}});recordDrawingCommit(started);return result.ok?ok(undefined):result;
}
export function setAppearance(ids: Id[], patch: Partial<LayerPresentation>, label='修改图层外观'): Result<void> {
  const started=beginAppearanceEdit(ids,label);if(!started.ok)return started;
  const update=previewAppearance(l=>{l.presentation={...presentation(l),...structuredClone(patch)};});if(!update.ok){cancelAppearanceEdit();return update;}return commitAppearanceEdit();
}
export function patchPaint(layer: Layer, patch: Partial<NonNullable<ReturnType<typeof layerPaint>>>): void {
  if(layer.type==='panel'){const {radius,...rest}=patch;Object.assign(layer.style,rest);if(radius!==undefined)layer.style.borderRadius=radius;}
  else if(layer.type==='bubble')Object.assign(layer.style,patch);
  else if(layer.type==='group'&&layer.dialogue)Object.assign(layer.dialogue.fusionStyle,patch);
  else if(layer.type==='decoration'&&layer.spec.kind==='shape'){const {radius,...rest}=patch;Object.assign(layer.spec.style,rest);if(radius!==undefined)layer.spec.style.borderRadius=radius;}
}
export function setPaint(ids: Id[], patch: Partial<NonNullable<ReturnType<typeof layerPaint>>>): Result<void> {
  if(ids.some(id=>!getProject().layers[id]||!layerPaint(getProject().layers[id])))return fail(problem('appearance/paint-target','请选择具有填充与描边的图形'));
  const started=beginAppearanceEdit(ids,'修改填充与描边');if(!started.ok)return started;
  const update=previewAppearance(l=>{patchPaint(l,patch);if(patch.borderWidth!==undefined&&l.presentation?.stroke.edgeWidths)l.presentation.stroke.edgeWidths=[patch.borderWidth,patch.borderWidth,patch.borderWidth,patch.borderWidth];});if(!update.ok){cancelAppearanceEdit();return update;}return commitAppearanceEdit();
}

export const propertyTransformStore=createStore<{target:Id|null;anchor:number;ratioLinked:boolean;edgesLinked:boolean;alignReference:'page'|'selection'}>(()=>({target:null,anchor:4,ratioLinked:false,edgesLinked:true,alignReference:'selection'}));
export function propertyAnchor(id:Id): Point { const s=propertyTransformStore.getState(),index=s.target===id?s.anchor:4;return{x:(index%3)/2,y:Math.floor(index/3)/2}; }
