import {correctPen} from '../comicDrawing/geometry';
import {DEFAULT_PEN} from '../comicDrawing/model';
import { createStore } from 'zustand/vanilla';
import { fail, ok, problem, type BubbleBrushOptions, type BubbleLayer, type Id, type InkSample, type InkStroke, type Layer, type Mat, type Point, type Project, type Rect, type Result, type Viewport } from '../domain/types';
import { createLayer } from '../domain/factories';
import { newId } from '../domain/id';
import { apply, clientToPage, IDENTITY, inverse, multiply, scaling, translation, worldMatrix } from '../geometry/matrix';
import { documentStore, getDocument } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { runtimeStore } from '../state/runtimeStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { cancelActiveGesture, registerGestureCanceller } from '../interaction/activeGesture';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { execute } from '../history/commandBus';
import { migrateProject } from '../storage/migrateProject';
import { retainResources } from '../storage/blobRepository';
import { composeBubble } from './composeBubble';
import { captureAutoClosedBubble } from './autoCloseGeometry';
import { DEFAULT_BUBBLE_BRUSH, parseBubbleBrushOptions } from './brushOptions';
import { DRAWING_LIMITS, parseDrawingSource } from '../freehand/model';
import { freehandRegion, validBubbleRegion } from '../freehand/geometry';
import { bubbleTails } from './ownership';
import { tailAnchors } from './tailGeometry';
import { closestTailU } from './tailCommands';
import { recordDrawingInput, recordDrawingCommit } from '../freehand/metrics';
export type HandBubbleMode = 'contour' | 'ink' | 'erase-ink' | 'add-shape' | 'subtract-shape';
interface BrushInkOptions { width: number; color: string; opacity: number }
interface BubbleBrushDraft {
  base: Project; epoch: number; stateId: Id; pageId: Id; parentId: Id | null; pointerId: number | null;
  viewport: Viewport; rect: Rect; inverse: Mat; localToScreen: Mat; raw: InkSample[];
  options: BubbleBrushOptions; ink: BrushInkOptions; strokeId: Id; seed: number; sceneBase: Project; preview: Project;
  layerId: Id; mode: HandBubbleMode; pressureEnabled:boolean; stage: 'drawing' | 'review'; error: string; valid: boolean;
}
export const bubbleBrushStore = createStore<{ options: BubbleBrushOptions; ink: BrushInkOptions; mode: HandBubbleMode; targetId: Id | null; active: BubbleBrushDraft | null }>(() => ({ options: structuredClone(DEFAULT_BUBBLE_BRUSH), ink: { width: 12, color: '#202020FF', opacity: 1 }, mode: 'contour', targetId: null, active: null }));
export const currentBubbleBrush = () => bubbleBrushStore.getState().active;
let cleanups: (() => void)[] = [];
export function cancelBubbleBrush(): void {
  if (!currentBubbleBrush()) return;
  const dispose = cleanups; cleanups = []; dispose.forEach(fn => fn());
  bubbleBrushStore.setState({ active: null }); runtimeStore.setState({ gestureActive: false, previewProject: null });
}
export function activateBubbleBrush(): Result<void> { const r = finishActiveTextEdit(); if (!r.ok) return r; cancelActiveGesture(); bubbleBrushStore.setState({ mode: 'contour', targetId: null }); sessionStore.setState({ toolMode: 'bubble-brush' }); return ok(undefined); }
export function activateHandBubbleEdit({ targetId, mode }: { targetId: Id; mode: Exclude<HandBubbleMode, 'contour'> }): Result<void> {
  const finish = finishActiveTextEdit(); if (!finish.ok) return finish;
  const p = getDocument().project, b = p.layers[targetId], flags = effectiveLayerFlags(p, targetId);
  if (b?.type !== 'bubble' || b.shape !== 'freehand' || !b.freehandSource || b.pageId !== sessionStore.getState().activePageId) return fail(problem('bubble-brush/target', '请选择手绘轮廓气泡；标准／节点气泡保留原编辑方式'));
  if (!flags.visible || flags.locked) return fail(problem('bubble-brush/locked', '请显示并解锁气泡及其所属容器'));
  cancelActiveGesture(); bubbleBrushStore.setState({ mode, targetId }); sessionStore.setState({ toolMode: 'bubble-brush', selection: [targetId] }); return ok(undefined);
}
export function setBubbleInkOptions(patch: Partial<BrushInkOptions>): Result<void> {
  const ink = { ...bubbleBrushStore.getState().ink, ...patch };
  if (!Number.isFinite(ink.width) || ink.width < 1 || ink.width > 512 || !Number.isFinite(ink.opacity) || ink.opacity < 0 || ink.opacity > 1 || !/^#[0-9a-f]{8}$/i.test(ink.color)) return fail(problem('bubble-brush/ink', '笔宽1～512、透明度0～100%、颜色需为RGBA'));
  bubbleBrushStore.setState({ ink: { ...ink, color: ink.color.toUpperCase() } }); return ok(undefined);
}
export function setBubbleBrushOptions(options: BubbleBrushOptions): Result<void> { const r = parseBubbleBrushOptions(options); if (!r.ok) return r; bubbleBrushStore.setState({ options: structuredClone(r.value) }); return ok(undefined); }
export function beginBubbleBrush(client: Point, pointerId: number, rect: Rect, viewport: Viewport, pressure = .5, pen = false): Result<void> {
  if (!Number.isSafeInteger(pointerId) || pointerId < 0 || ![client.x, client.y, rect.x, rect.y, rect.width, rect.height, viewport.zoom, viewport.pan.x, viewport.pan.y, pressure].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0 || viewport.zoom <= 0) return fail(problem('bubble-brush/input', '笔迹坐标、视口和指针必须有效'));
  if (currentBubbleBrush()) return fail(problem('bubble-brush/active', '请结束当前笔迹'));
  const finish = finishActiveTextEdit(); if (!finish.ok) return finish; cancelActiveGesture();
  const doc = getDocument(), s = sessionStore.getState(), page = doc.project.pages[s.activePageId], p = clientToPage(client, { left: rect.x, top: rect.y }, viewport), config = bubbleBrushStore.getState();
  if (!page || s.toolMode !== 'bubble-brush' || s.spacePan || p.x < 0 || p.y < 0 || p.x > page.width || p.y > page.height) return fail(problem('bubble-brush/outside', '请从页面内开始绘制'));
  const migrated = migrateProject(doc.project); if (!migrated.ok) return migrated;
  let parentId = s.scopeId, world = IDENTITY, layerId: Id; const sceneBase = migrated.value;
  if (config.mode === 'contour') {
    while (parentId) { const node: Layer | undefined = sceneBase.layers[parentId]; if (!node || !effectiveLayerFlags(sceneBase, parentId).visible || effectiveLayerFlags(sceneBase, parentId).locked) return fail(problem('bubble-brush/container', '当前容器已失效、隐藏或锁定')); if (node.type === 'group' && !node.dialogue) break; parentId = node.parentId; }
    world = parentId ? worldMatrix(sceneBase, parentId) : IDENTITY; layerId = newId();
  } else {
    const b = config.targetId ? sceneBase.layers[config.targetId] : null;
    if (b?.type !== 'bubble' || b.shape !== 'freehand' || !b.freehandSource || b.pageId !== page.id || s.selection.length !== 1 || s.selection[0] !== b.id) return fail(problem('bubble-brush/target', '请重新选择要编辑的手绘气泡'));
    const flags = effectiveLayerFlags(sceneBase, b.id); if (!flags.visible || flags.locked) return fail(problem('bubble-brush/locked', '气泡或其容器已锁定／隐藏'));
    if (config.mode.endsWith('shape') && b.children.some(id => effectiveLayerFlags(sceneBase, id).locked)) return fail(problem('bubble-brush/child-locked', '修形会影响锁定的文字或尾巴，请先解锁'));
    parentId = b.parentId; layerId = b.id; world = multiply(worldMatrix(sceneBase, b.id), scaling(b.width / b.freehandSource.width, b.height / b.freehandSource.height));
  }
  const inv = inverse(world); if (!inv.ok) return inv;
  const a: BubbleBrushDraft = { base: doc.project, epoch: doc.epoch, stateId: doc.history.stateId, pageId: page.id, parentId, pointerId, viewport: structuredClone(viewport), rect: { ...rect }, inverse: inv.value, localToScreen: multiply(scaling(viewport.zoom, viewport.zoom), world), raw: [{ ...apply(inv.value, p), pressure: Math.max(0, Math.min(1, pressure)), dt: 0 }], options: structuredClone(config.options), ink: { ...config.ink }, strokeId: newId(), seed: crypto.getRandomValues(new Uint32Array(1))[0], sceneBase, preview: sceneBase, layerId, mode: config.mode, pressureEnabled:pen&&!!config.options.pen?.pressure, stage: 'drawing', error: '', valid: false };
  bubbleBrushStore.setState({ active: a }); runtimeStore.setState({ gestureActive: true });
  cleanups = [retainResources(doc.project), registerGestureCanceller(cancelBubbleBrush), documentStore.subscribe(n => { if (currentBubbleBrush() && (n.epoch !== doc.epoch || n.history.stateId !== doc.history.stateId)) cancelBubbleBrush(); }), sessionStore.subscribe(n => { if (currentBubbleBrush() && (n.activePageId !== page.id || n.toolMode !== 'bubble-brush' || n.scopeId !== s.scopeId || n.spacePan || config.mode !== 'contour' && n.selection[0] !== layerId || JSON.stringify(n.viewportByPage[page.id]) !== JSON.stringify(s.viewportByPage[page.id]))) cancelBubbleBrush(); })];
  return ok(undefined);
}
export function appendBubbleBrushSamples(clients: readonly (Point & { pressure?: number })[]): Result<void> {
  const started=performance.now();
  const a = currentBubbleBrush(); if (!a || a.stage !== 'drawing') return fail(problem('bubble-brush/inactive', '没有活动笔迹'));
  if (a.error && a.raw.length >= DRAWING_LIMITS.strokePoints) return fail(problem('bubble-brush/budget', a.error));
  const raw = [...a.raw];
  for (const c of clients) {
    const p = apply(a.inverse, clientToPage(c, { left: a.rect.x, top: a.rect.y }, a.viewport));
    if (![p.x, p.y, c.pressure ?? .5].every(Number.isFinite)) { cancelBubbleBrush(); return fail(problem('bubble-brush/point', '笔迹坐标必须有限，已取消这一笔')); }
    const last = raw.at(-1)!; if (Math.hypot(p.x - last.x, p.y - last.y) <= 1e-6) continue;
    if (raw.length >= DRAWING_LIMITS.strokePoints) { cancelBubbleBrush(); return fail(problem('bubble-brush/budget', '单笔超过8192点，已取消这一笔；请缩短笔迹')); }
    raw.push({ ...p, pressure: Math.max(0, Math.min(1, c.pressure ?? last.pressure)), dt: 0 });
  }
  bubbleBrushStore.setState({ active: { ...a, raw } }); const result=a.mode === 'contour' ? ok(undefined) : rebuildBubbleBrush();recordDrawingInput(started);return result;
}
export function rebuildBubbleBrush(): Result<void> {
  const a = currentBubbleBrush(); if (!a) return fail(problem('bubble-brush/inactive', '没有活动气泡'));
  let b: BubbleLayer;
  if (a.mode === 'contour') {
    const corrected=correctPen(a.raw,a.localToScreen,a.options.pen??{...DEFAULT_PEN,stabilization:a.options.smoothing,postCorrection:a.options.simplifyScreenPx});
    const capture = captureAutoClosedBubble(corrected, a.localToScreen); if (!capture.ok) return capture;
    const q = capture.value, o = a.options; b = createLayer('bubble', a.pageId, '手绘气泡') as BubbleLayer;
    b.id = a.layerId; b.parentId = a.parentId; b.shape = 'freehand'; b.width = q.width; b.height = q.height; b.matrix = translation(q.origin.x, q.origin.y); b.freehandSource = q.source; b.handDrawn = null; b.contour = null;
    if(a.pressureEnabled){const samples=q.source.baseRing.map(p=>{const x=p.x*q.width/q.source.width+q.origin.x,y=p.y*q.height/q.source.height+q.origin.y;let nearest=corrected[0],distance=Infinity;for(const c of corrected){const d=Math.hypot(c.x-x,c.y-y);if(d<distance){distance=d;nearest=c;}}return{...p,pressure:nearest.pressure,dt:0};});b.penOutline={id:a.strokeId,tool:'pen',pressureMode:'pen',points:[...samples,{...samples[0]}],width:Math.max(1,o.borderWidth),opacity:1,color:o.borderColor};}
    b.style = { borderWidth: o.borderWidth, borderColor: o.borderColor, fill: o.fill, radius: 0, innerStroke: { ...o.innerStroke }, outerStroke: { ...o.outerStroke } }; b.edgeStyle = { recipe: 'normal-offset-v1', wobble: o.handDrawn?.wobble ?? 0, seed: a.seed };
  } else {
    const old = a.sceneBase.layers[a.layerId]; if (old?.type !== 'bubble' || !old.freehandSource) return fail(problem('bubble-brush/target', '气泡已失效'));
    const source = old.freehandSource.version === 2 ? old.freehandSource : { ...old.freehandSource, version: 2 as const, ink: [] };
    const stroke: InkStroke = { id: a.strokeId, tool: a.mode === 'erase-ink' ? 'eraser' : 'pen', points: a.raw, ...a.ink, pressureMode: a.pressureEnabled?'pen':'fixed' };
    const next = a.mode === 'ink' || a.mode === 'erase-ink' ? { ...source, ink: [...source.ink, stroke] } : { ...source, edits: [...source.edits, { id: a.strokeId, mode: a.mode === 'add-shape' ? 'add' as const : 'subtract' as const, stroke }] };
    const valid = parseDrawingSource(next, 'bubble'); if (!valid.ok) return invalidPreview(a, valid);
    b = { ...old, freehandSource: valid.value };if(a.mode.endsWith('shape'))delete b.penOutline;
    if (a.mode.endsWith('shape')) { const region = freehandRegion(valid.value); if (!region.ok) return invalidPreview(a, region); const topology = validBubbleRegion(region.value); if (!topology.ok) return invalidPreview(a, topology); }
  }
  const preview = { ...a.sceneBase, layers: { ...a.sceneBase.layers, [b.id]: b } };
  if (a.mode.endsWith('shape')) for (const tail of bubbleTails(a.sceneBase, b.id)) {
    if (tail.attachment.mode !== 'bubble') continue;
    const old = a.sceneBase.layers[b.id] as BubbleLayer, anchors = tailAnchors(tail, old); if (!anchors.ok) return invalidPreview(a, anchors);
    const nearest = closestTailU(b, anchors.value.base); if (!nearest.ok) return invalidPreview(a, nearest);
    preview.layers[tail.id] = { ...tail, attachment: { ...tail.attachment, attachU: nearest.value.u, baseWidth: Math.max(4, Math.min(tail.attachment.baseWidth, nearest.value.total * .2)) } };
  }
  const geometry = composeBubble(preview, b.id);
  if (!geometry.ok) return invalidPreview(a, geometry);
  bubbleBrushStore.setState({ active: { ...a, preview, valid: true, error: '' } }); return ok(undefined);
}
function invalidPreview(a: BubbleBrushDraft, r: Result<unknown>): Result<void> { if (!r.ok) { bubbleBrushStore.setState({ active: { ...a, error: r.problems[0].message, valid: false } }); return r; } return ok(undefined); }
export function commitBubbleBrush(): Result<Id> {
  const a = currentBubbleBrush(); if (!a || !a.valid || a.error) return fail(problem('bubble-brush/invalid', a?.error || '请画出合法轮廓或笔迹'));
  const doc = getDocument(); if (doc.epoch !== a.epoch || doc.history.stateId !== a.stateId) { cancelBubbleBrush(); return fail(problem('bubble-brush/stale', '作品已变化，笔迹已取消')); }
  const b = structuredClone(a.preview.layers[a.layerId]) as BubbleLayer;
  cancelBubbleBrush();
  const r = execute({ label: a.mode === 'contour' ? '绘制手绘气泡' : a.mode.endsWith('shape') ? '笔刷修形气泡' : '绘制气泡细节', context: { pageId: a.pageId, selection: sessionStore.getState().selection }, afterSelection: [b.id], mutate(p) {
    const migrated = migrateProject(p); if (!migrated.ok) throw Error(migrated.problems[0].message); Object.assign(p, migrated.value); p.layers[b.id] = b;
    if (a.mode === 'contour') { const parent = a.parentId ? p.layers[a.parentId] : null; if (parent && 'children' in parent) parent.children = [...parent.children, b.id]; else p.pages[a.pageId].roots = [...p.pages[a.pageId].roots, b.id]; }
    else if (a.mode.endsWith('shape')) for (const tail of bubbleTails(a.preview, b.id)) p.layers[tail.id] = structuredClone(tail);
  } });
  if (r.ok && a.mode === 'contour') sessionStore.setState({ toolMode: 'select' }); return r.ok ? ok(b.id) : r;
}
export function finishBubbleBrush(): Result<Id> {
  const started=performance.now();
  const a = currentBubbleBrush(); if (!a) return fail(problem('bubble-brush/inactive', '没有活动笔迹'));
  if (a.error && a.raw.length >= DRAWING_LIMITS.strokePoints) { const error = a.error; cancelBubbleBrush(); return fail(problem('bubble-brush/budget', error)); }
  const rebuilt = rebuildBubbleBrush(); if (!rebuilt.ok) { cancelBubbleBrush(); return rebuilt; } const result = commitBubbleBrush(); if (!result.ok) cancelBubbleBrush(); recordDrawingCommit(started);return result;
}
