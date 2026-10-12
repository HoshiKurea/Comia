import { createStore } from 'zustand/vanilla';
import type { DecorationLayer, Id, Mat, Point, Project, Rect, Result, SpeedBrushOptions, Viewport } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { createLayer } from '../domain/factories';
import { apply, clientToPage, IDENTITY, inverse, translation, worldMatrix } from '../geometry/matrix';
import { execute } from '../history/commandBus';
import { documentStore, getDocument } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { runtimeStore } from '../state/runtimeStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { cancelActiveGesture, registerGestureCanceller } from '../interaction/activeGesture';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { buildSpeedBrush, DEFAULT_SPEED_BRUSH, normalizeBrushGeometry, SPEED_BRUSH, validBrushOptions } from './speedBrushGeometry';

export interface SpeedStroke {
  pointerId: number; pageId: Id; parentId: Id | null; base: Project; epoch: number; stateId: Id;
  viewport: Viewport; rect: Rect; parentInverse: Mat; options: SpeedBrushOptions; raw: Point[];
  layer: DecorationLayer; sceneBase: Project; preview: Project; hasInk: boolean; error: string;
}
export const speedBrushStore = createStore<{ options: SpeedBrushOptions; active: SpeedStroke | null }>(() => ({ options: { ...DEFAULT_SPEED_BRUSH }, active: null }));
export const currentSpeedStroke = () => speedBrushStore.getState().active;
let unregister: (() => void) | null = null;
export function cancelSpeedStroke(): void {
  if (!currentSpeedStroke()) return;
  unregister?.(); unregister = null; speedBrushStore.setState({ active: null }); runtimeStore.setState({ gestureActive: false });
}
function current(s: SpeedStroke): boolean {
  const doc = getDocument(); return doc.project === s.base && doc.epoch === s.epoch && doc.history.stateId === s.stateId && sessionStore.getState().activePageId === s.pageId;
}
documentStore.subscribe(() => { const s = currentSpeedStroke(); if (s && !current(s)) cancelSpeedStroke(); });
sessionStore.subscribe((s, old) => {
  const stroke = currentSpeedStroke();
  if (stroke && (s.activePageId !== old.activePageId || s.toolMode !== old.toolMode || s.scopeId !== old.scopeId
    || s.viewportByPage[stroke.pageId] !== old.viewportByPage[stroke.pageId] || s.spacePan)) cancelSpeedStroke();
});
export function activateSpeedBrush(): Result<void> {
  const edited = finishActiveTextEdit(); if (!edited.ok) return edited;
  cancelActiveGesture(); sessionStore.setState({ toolMode: 'speed-brush' }); return ok(undefined);
}
export function setSpeedBrushOptions(options: SpeedBrushOptions): Result<void> {
  if (!validBrushOptions(options)) return fail(problem('brush/options', '笔刷范围8～256、密度2～24、线宽0.25～16、不规整度0～1'));
  speedBrushStore.setState({ options: { ...options } }); return ok(undefined);
}
export function beginSpeedStroke(client: Point, pointerId: number, rect: Rect, viewport: Viewport): Result<void> {
  const edited = finishActiveTextEdit(); if (!edited.ok) return edited; cancelActiveGesture();
  const doc = getDocument(), session = sessionStore.getState(), pageId = session.activePageId, page = doc.project.pages[pageId];
  if (session.toolMode !== 'speed-brush' || session.spacePan || !page || !Number.isFinite(viewport.zoom) || viewport.zoom <= 0) return fail(problem('brush/page', '当前不能绘制速度线'));
  const p = clientToPage(client, { left: rect.x, top: rect.y }, viewport);
  if (![p.x, p.y].every(Number.isFinite) || p.x < 0 || p.y < 0 || p.x > page.width || p.y > page.height) return fail(problem('brush/outside', '请从页面内开始绘制'));
  const parentId = session.scopeId, parent = parentId ? doc.project.layers[parentId] : null;
  if (parentId && (parent?.type !== 'group' || parent.dialogue || parent.pageId !== pageId || !effectiveLayerFlags(doc.project, parentId).visible || effectiveLayerFlags(doc.project, parentId).locked)) return fail(problem('brush/group', '请在可编辑的普通组或页面中绘制'));
  const inv = inverse(parentId ? worldMatrix(doc.project, parentId) : IDENTITY); if (!inv.ok) return inv;
  const options = { ...speedBrushStore.getState().options }, seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const layer = createLayer('decoration', pageId, '速度线笔触') as DecorationLayer;
  layer.parentId = parentId; layer.visible = false;
  layer.spec = { kind: 'speed-brush', width: 16, height: 16, color: options.color, seed, options,
    centerline: [{ x: 0, y: 0 }, { x: 1, y: 0 }], ribbons: [] };
  const layers = { ...doc.project.layers, [layer.id]: layer }, pages = { ...doc.project.pages };
  if (parent?.type === 'group') layers[parent.id] = { ...parent, children: [...parent.children, layer.id] };
  else pages[pageId] = { ...page, roots: [...page.roots, layer.id] };
  const sceneBase = { ...doc.project, layers, pages }, preview = { ...sceneBase, layers: { ...layers } };
  speedBrushStore.setState({ active: { pointerId, pageId, parentId, base: doc.project, epoch: doc.epoch, stateId: doc.history.stateId,
    viewport: { zoom: viewport.zoom, pan: { ...viewport.pan } }, rect: { ...rect }, parentInverse: inv.value, options, raw: [p], layer, sceneBase, preview, hasInk: false, error: '' } });
  unregister = registerGestureCanceller(cancelSpeedStroke); runtimeStore.setState({ gestureActive: true }); return ok(undefined);
}
export function appendSpeedSamples(clients: readonly Point[]): Result<void> {
  const s = currentSpeedStroke(); if (!s) return fail(problem('brush/inactive', '没有正在绘制的笔触'));
  if (!current(s)) { cancelSpeedStroke(); return fail(problem('brush/stale', '作品已变化，笔触已取消')); }
  for (const client of clients) {
    const p = clientToPage(client, { left: s.rect.x, top: s.rect.y }, s.viewport);
    if (![p.x, p.y].every(Number.isFinite)) { s.error = '笔触坐标无效'; continue; }
    const last = s.raw.at(-1)!; if (Math.hypot(p.x - last.x, p.y - last.y) < 1e-8) continue;
    if (s.raw.length >= SPEED_BRUSH.rawPoints) { s.error = '单笔超过4096采样点，请分笔绘制'; break; }
    s.raw.push(p);
  }
  return s.error ? fail(problem('brush/input', s.error)) : ok(undefined);
}
export function previewSpeedStroke(): Result<void> {
  const s = currentSpeedStroke(); if (!s) return ok(undefined);
  if (!current(s)) { cancelSpeedStroke(); return fail(problem('brush/stale', '作品已变化，笔触已取消')); }
  const built = s.error ? fail(problem('brush/input', s.error)) : buildSpeedBrush(s.raw, s.options, s.layer.spec.kind === 'speed-brush' ? s.layer.spec.seed : 0, .75 / s.viewport.zoom);
  if (!built.ok) {
    const short = built.problems[0].code === 'brush/short';
    s.preview.layers[s.layer.id] = { ...s.layer, visible: false };
    speedBrushStore.setState({ active: { ...s, hasInk: false, error: short ? '' : built.problems[0].message } });
    return short ? ok(undefined) : built;
  }
  let geometry = built.value;
  if (s.parentId) {
    const spec = geometry.spec;
    const toLocal = (p: Point) => apply(s.parentInverse, { x: geometry.bounds.x + p.x * spec.width, y: geometry.bounds.y + p.y * spec.height });
    geometry = normalizeBrushGeometry(spec.centerline.map(toLocal), spec.ribbons.map(r => r.map(toLocal)), s.options, spec.seed);
  }
  if (![geometry.bounds.x, geometry.bounds.y, geometry.bounds.width, geometry.bounds.height].every(Number.isFinite)
    || geometry.bounds.width > 16384 || geometry.bounds.height > 16384) {
    const message = '组内速度线范围超过16384像素，请缩短笔触或移出组';
    s.preview.layers[s.layer.id] = { ...s.layer, visible: false };
    speedBrushStore.setState({ active: { ...s, hasInk: false, error: message } }); return fail(problem('brush/group-bounds', message));
  }
  const layer: DecorationLayer = { ...s.layer, visible: true, matrix: translation(geometry.bounds.x, geometry.bounds.y), spec: geometry.spec };
  // Private preview map was allocated once at PointerDown. Document layers are never mutated.
  s.preview.layers[layer.id] = layer;
  speedBrushStore.setState({ active: { ...s, layer, hasInk: true, error: '' } }); return ok(undefined);
}
export function commitSpeedStroke(): Result<Id | null> {
  const flushed = previewSpeedStroke(), s = currentSpeedStroke();
  if (!s) return ok(null);
  if (!flushed.ok) { cancelSpeedStroke(); return flushed; }
  let length = 0; for (let i = 1; i < s.raw.length; i++) length += Math.hypot(s.raw[i].x - s.raw[i - 1].x, s.raw[i].y - s.raw[i - 1].y);
  if (!s.hasInk || length * s.viewport.zoom < 4) { cancelSpeedStroke(); return ok(null); }
  if (!current(s)) { cancelSpeedStroke(); return fail(problem('brush/stale', '作品已变化，笔触已取消')); }
  const layer = s.layer;
  const result = execute({ label: '绘制速度线', context: { pageId: s.pageId, selection: sessionStore.getState().selection }, afterSelection: [layer.id], mutate(draft) {
    if (draft.schemaVersion < 7) { draft.schemaVersion = 7; draft.settings.readingDirection = 'rtl'; }
    draft.layers[layer.id] = layer;
    const parent = s.parentId ? draft.layers[s.parentId] : null;
    if (parent?.type === 'group') parent.children.push(layer.id); else draft.pages[s.pageId].roots.push(layer.id);
  } });
  return result.ok ? ok(layer.id) : result;
}
