import { createStore } from 'zustand/vanilla';
import type { Id, Layer, Project, Result, TextContent, TextLayer, TextEffects, BubbleTextFrame } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { LIMIT_TEXT_CODEPOINTS } from '../domain/limits';
import { validateProject } from '../domain/validate';
import { getDocument } from '../state/documentStore';
import { sessionStore, setSelection, pushNotice } from '../state/sessionStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { execute } from '../history/commandBus';
import { cancelActiveGesture } from '../interaction/activeGesture';
import { registerTextEditBoundary } from './editLifecycle';
import type { TextEditSession } from './types';
import { createLayer } from '../domain/factories';
import { buildBubble } from '../bubbles/geometry';
import { mainBubbleText, legacyBubbleTail } from '../bubbles/ownership';
import { parseTextEffects } from '../domain/mangaValidation';
import { resolveBubbleTextFrame } from './bubbleTextFrame';
import { actualFont } from './fonts';
import { parseBubbleFrame } from '../domain/extensionValidation';
import { migrateProject } from '../storage/migrateProject';

export interface ActiveTextEdit extends TextEditSession {
  base: Project;
  frameBase?: Project;
  epoch: number;
  stateId: Id;
  preview: Project;
  revision: number;
  selectionDirection: 'forward' | 'backward' | 'none';
  createdParentId?: Id;
  kind: 'text' | 'sfx';
  originalEffects?: TextEffects | null;
  draftEffects?: TextEffects | null;
}
export const textEditStore = createStore<{ active: ActiveTextEdit | null }>(() => ({ active: null }));
let unregister: (() => void) | null = null;
const pendingEffects=new Map<string,{id:Id;patch:Partial<TextEffects>}>();let effectsFrame=0;
export function queueTextEffects(id:Id,key:string,patch:Partial<TextEffects>):Result<void>{
  const begun=beginSfxTextEdit(id);if(!begun.ok)return begun;pendingEffects.set(key,{id,patch});if(!effectsFrame)effectsFrame=requestAnimationFrame(flushTextEffects);return ok(undefined);
}
export function flushTextEffects():void{if(effectsFrame)cancelAnimationFrame(effectsFrame);effectsFrame=0;const batch=[...pendingEffects.values()];pendingEffects.clear();for(const item of batch)if(currentTextEdit()?.layerId===item.id){const r=updateTextEffectsDraft({...item.patch,recipe:'layout'});if(!r.ok)pushNotice('error',r.problems[0].message);}}
function discardEffects():void{if(effectsFrame)cancelAnimationFrame(effectsFrame);effectsFrame=0;pendingEffects.clear();}
export function currentTextEdit(): ActiveTextEdit | null { return textEditStore.getState().active; }

export function normalizeTextInput(value: string): { value: string; truncated: boolean } {
  const normalized = value.replace(/\r\n?/g, '\n');
  const points = Array.from(normalized);
  return { value: points.slice(0, LIMIT_TEXT_CODEPOINTS).join(''), truncated: points.length > LIMIT_TEXT_CODEPOINTS };
}
function publish(edit: ActiveTextEdit, draft: TextContent): void {
  if(edit.draftEffects?.recipe==='legacy-sfx-v5'&&(draft.direction!=='horizontal'||draft.align!=='start'||draft.lineHeight!==1||draft.letterSpacing!==0||draft.font.italic||!draft.font.bold||draft.content!==edit.original.content&&draft.content.includes('\n')))edit={...edit,draftEffects:{...edit.draftEffects,recipe:'layout'}};
  const source=edit.frameBase??edit.base;
  const preview = { ...source, layers: { ...source.layers, [edit.layerId]: layerWithDraft(edit, draft) } };
  textEditStore.setState({ active: { ...edit, draft, preview, revision: edit.revision + 1 } });
}
function layerWithDraft(edit: ActiveTextEdit, draft: TextContent): Layer {
  const original = (edit.frameBase??edit.base).layers[edit.layerId];
  if (original.type === 'decoration' && original.spec.kind === 'sfx') return { ...original, spec: { ...original.spec, content: draft.content, fontFamily: draft.font.family, fontSize: draft.font.size, color: draft.font.color } };
  if (original.type !== 'text') throw Error('文字草稿目标无效');
  const candidate:TextLayer={ ...original, text: draft, ...(original.role==='sfx'?{effects:edit.draftEffects??original.effects}:{}) };
  const previewLayer=edit.preview.layers[edit.layerId];
  if(previewLayer?.type==='text'&&previewLayer.bubbleFrame){candidate.bubbleFrame=structuredClone(previewLayer.bubbleFrame);if(candidate.bubbleFrame.placement==='center')candidate.matrix=[1,0,0,1,0,0];}
  if(candidate.bubbleFrame?.placement==='center'){
    const ctx=document.createElement('canvas').getContext('2d');if(ctx){const source=edit.frameBase??edit.base,frame=resolveBubbleTextFrame({...source,layers:{...source.layers,[candidate.id]:candidate}},candidate.id,ctx,actualFont(draft.font.family));if(frame.ok)candidate.box=frame.value.box;}
  }
  return candidate;
}
function clear(): void {
  discardEffects();
  unregister?.(); unregister = null;
  textEditStore.setState({ active: null });
  sessionStore.setState({ textEditingId: null });
}
export function beginTextEdit(id: Id): Result<void> {
  if (currentTextEdit()?.layerId === id) return ok(undefined);
  const finished = commitTextEdit(); if (!finished.ok) return finished;
  cancelActiveGesture();
  const doc = getDocument(), layer = doc.project.layers[id];
  const flags = effectiveLayerFlags(doc.project, id);
  if (layer?.type !== 'text' || layer.pageId !== sessionStore.getState().activePageId) return fail(problem('text/target', '文字不在当前页面或已不存在'));
  if (!flags.visible || flags.locked) return fail(problem('text/locked', '隐藏或锁定的文字不能进入画布编辑'));
  activate(layer, doc.project, doc.epoch, doc.history.stateId); return ok(undefined);
}
function activate(layer: TextLayer, base: Project, epoch: number, stateId: Id, createdParentId?: Id): void {
  activateContent(layer.id, layer.text, base, epoch, stateId, layer.role==='sfx'?'sfx':'text', createdParentId);
}
function activateContent(id: Id, content: TextContent, base: Project, epoch: number, stateId: Id, kind: ActiveTextEdit['kind'], createdParentId?: Id): void {
  const draft = structuredClone(content);
  const active: ActiveTextEdit = { layerId: id, original: structuredClone(draft), draft, base, preview: base, epoch, stateId, revision: 0, selectionStart: draft.content.length, selectionEnd: draft.content.length, selectionDirection: 'none', composing: false, createdParentId, kind };
  const layer=base.layers[id];if(layer.type==='text'&&layer.role==='sfx'){active.originalEffects=structuredClone(layer.effects);active.draftEffects=structuredClone(layer.effects);}
  textEditStore.setState({ active });
  sessionStore.setState({ textEditingId: id, toolMode: 'select' }); setSelection([createdParentId ?? id], createdParentId ?? id);
  unregister = registerTextEditBoundary((mode) => mode === 'cancel' ? cancelTextEdit() : commitTextEdit());
}
export function beginSfxTextEdit(id: Id): Result<void> {
  const current=getDocument().project.layers[id];if(current?.type==='text'&&current.role==='sfx')return beginTextEdit(id);
  if (currentTextEdit()?.layerId === id) return ok(undefined);
  const finished = commitTextEdit(); if (!finished.ok) return finished;
  cancelActiveGesture(); const doc = getDocument(), layer = doc.project.layers[id], flags = effectiveLayerFlags(doc.project, id);
  if (layer?.type !== 'decoration' || layer.spec.kind !== 'sfx' || layer.pageId !== sessionStore.getState().activePageId) return fail(problem('text/sfx-target', '音效字不在当前页面或已不存在'));
  if (!flags.visible || flags.locked) return fail(problem('text/locked', '隐藏或锁定的音效字不能编辑'));
  const spec = layer.spec;
  activateContent(id, { content: spec.content, direction: 'horizontal', font: { family: spec.fontFamily, size: spec.fontSize, color: spec.color, bold: true, italic: false }, align: 'start', lineHeight: 1, letterSpacing: 0 }, doc.project, doc.epoch, doc.history.stateId, 'sfx');
  return ok(undefined);
}

/** A missing main text exists only in the draft until the whole edit commits once. */
export function beginBubbleTextEdit(id: Id): Result<void> {
  const finished = commitTextEdit(); if (!finished.ok) return finished;
  cancelActiveGesture();
  const doc = getDocument(), bubble = doc.project.layers[id], flags = effectiveLayerFlags(doc.project, id);
  if (bubble?.type !== 'bubble' || bubble.pageId !== sessionStore.getState().activePageId) return fail(problem('text/bubble-target', '气泡不在当前页面或已不存在'));
  if (!flags.visible || flags.locked) return fail(problem('text/locked', '隐藏或锁定气泡不能编辑文字'));
  const existing = mainBubbleText(doc.project, id); if (existing) return beginTextEdit(existing.id);
  const geometry = buildBubble(bubble.shape, bubble.width, bubble.height, bubble.style, legacyBubbleTail(doc.project, bubble), bubble); if (!geometry.ok) return geometry;
  const text = createLayer('text', bubble.pageId, '对白');
  if (text.type !== 'text') return fail(problem('text/factory', '无法创建对白文字'));
  if (doc.project.schemaVersion >= 6) { text.role = 'plain'; text.effects = null; }
  text.parentId = id; text.box = geometry.value.textBox; text.text.content = ''; text.text.font.size = 28; text.text.align = 'center';
  if(doc.project.schemaVersion>=9)text.bubbleFrame={mode:'auto',manualSize:null,placement:'center'};
  const base = { ...doc.project, layers: { ...doc.project.layers, [id]: { ...bubble, children: [...bubble.children, text.id] }, [text.id]: text } };
  const valid = validateProject(base); if (!valid.ok) return valid;
  activate(text, base, doc.epoch, doc.history.stateId, id);
  return ok(undefined);
}
export function updateTextInput(value: string, start: number, end: number, direction: ActiveTextEdit['selectionDirection'] = 'none'): string {
  const edit = currentTextEdit(); if (!edit) return value;
  const normalized = normalizeTextInput(value);
  if (normalized.truncated && !edit.composing) pushNotice('error', '文字超过10000码点上限，超出部分未加入；已有内容保留');
  // During IME retain the browser's complete temporary composition. Normalize/limit only at compositionend.
  const content = edit.composing ? value.replace(/\r\n?/g, '\n') : normalized.value;
  const position = (index: number) => Math.min(Math.max(0, value.slice(0, index).replace(/\r\n?/g, '\n').length), content.length);
  publish({ ...edit, selectionStart: position(start), selectionEnd: position(end), selectionDirection: direction }, { ...edit.draft, content });
  return content;
}
export function updateTextSelection(start: number, end: number, direction: ActiveTextEdit['selectionDirection'] = 'none'): void {
  const edit = currentTextEdit(); if (!edit) return;
  start = Math.max(0, Math.min(start, edit.draft.content.length)); end = Math.max(start, Math.min(end, edit.draft.content.length));
  if (start === edit.selectionStart && end === edit.selectionEnd && direction === edit.selectionDirection) return;
  textEditStore.setState({ active: { ...edit, selectionStart: start, selectionEnd: end, selectionDirection: direction } });
}
export function setTextComposing(composing: boolean): void {
  const edit = currentTextEdit(); if (edit) textEditStore.setState({ active: { ...edit, composing } });
}
export function updateTextStyleDraft(patch: TextStylePatch): Result<void> {
  const edit = currentTextEdit(); if (!edit) return fail(problem('text/no-edit', '没有活动文字编辑'));
  const layer=edit.preview.layers[edit.layerId];if(layer.type==='text'&&layer.bubbleFrame?.placement==='center'&&patch.align&&patch.align!=='center')return fail(problem('text/bubble-align','气泡对白使用居中；手动文字框控制换行'));
  const draft = { ...edit.draft, ...patch, font: { ...edit.draft.font, ...patch.font } };
  if (edit.kind === 'sfx' && edit.base.layers[edit.layerId].type==='decoration' && (draft.direction !== 'horizontal' || draft.align !== 'start' || draft.lineHeight !== 1 || draft.letterSpacing !== 0 || !draft.font.bold || draft.font.italic)) return fail(problem('text/sfx-style', '遗留音效字只支持原单行样式，请打开新版文件后编辑变形'));
  const source=edit.frameBase??edit.base,preview = { ...source, layers: { ...source.layers, [edit.layerId]: layerWithDraft(edit, draft) } };
  const checked = validateProject(preview); if (!checked.ok) return checked;
  publish(edit, draft); return ok(undefined);
}
export function updateBubbleFrameDraft(frame:BubbleTextFrame):Result<void>{
  const edit=currentTextEdit();if(!edit)return fail(problem('text/no-edit','没有活动文字编辑'));if(edit.composing)return fail(problem('text/composing','请先完成输入法候选再调整文字框'));
  const layer=edit.preview.layers[edit.layerId];if(layer?.type!=='text'||!layer.parentId||mainBubbleText(edit.preview,layer.parentId)?.id!==layer.id)return fail(problem('text/bubble-frame-target','请选择气泡中的主对白'));
  const parsed=parseBubbleFrame(frame,`layers.${layer.id}.bubbleFrame`);if(!parsed.ok)return parsed;
  let frameBase=edit.frameBase;
  if(edit.base.schemaVersion<9&&!frameBase){const migrated=migrateProject(edit.base);if(!migrated.ok)return migrated;frameBase=migrated.value;}
  const source=frameBase??edit.preview,preview={...source,layers:{...source.layers,[layer.id]:{...layer,bubbleFrame:parsed.value}}};publish({...edit,frameBase,preview},{...edit.draft,align:parsed.value.placement==='center'?'center':edit.draft.align});return ok(undefined);
}
export type TextStylePatch = Partial<Omit<TextContent, 'content' | 'font'>> & { font?: Partial<TextContent['font']> };
export function updateTextEffectsDraft(patch:Partial<TextEffects>):Result<void>{
  const edit=currentTextEdit();if(!edit||edit.base.layers[edit.layerId].type!=='text'||!edit.draftEffects)return fail(problem('sfx/edit','请先选择独立声效文字'));
  const parsed=parseTextEffects({...edit.draftEffects,...patch},`layers.${edit.layerId}.effects`);if(!parsed.ok)return parsed;
  publish({...edit,draftEffects:parsed.value},edit.draft);return ok(undefined);
}

export function commitTextEdit(): Result<void> {
  flushTextEffects();
  const edit = currentTextEdit(); if (!edit) return ok(undefined);
  if (edit.composing) return fail(problem('text/composing', '请先完成输入法候选，再完成编辑或切换页面'));
  const doc = getDocument();
  const parent = edit.createdParentId ? doc.project.layers[edit.createdParentId] : null;
  const target = doc.project.layers[edit.layerId];
  const targetValid = edit.createdParentId ? parent?.type === 'bubble' && !mainBubbleText(doc.project, parent.id) && !target : edit.kind === 'sfx' ? target?.type === 'text'&&target.role==='sfx'||target?.type === 'decoration' && target.spec.kind === 'sfx' : target?.type === 'text';
  if (doc.epoch !== edit.epoch || doc.history.stateId !== edit.stateId || !targetValid) {
    clear(); return fail(problem('text/stale', '文字目标或项目已变化，旧编辑草稿已取消'));
  }
  if (effectiveLayerFlags(doc.project, edit.createdParentId ?? edit.layerId).locked) { clear(); return fail(problem('text/locked', '文字已锁定，编辑草稿已取消')); }
  const normalized = normalizeTextInput(edit.draft.content);
  const draft = { ...edit.draft, content: normalized.value };
  // Remove boundary before execute to prevent recursively committing this session.
  unregister?.(); unregister = null;
  const result = execute({ label: '编辑文字', context: { pageId: edit.base.layers[edit.layerId].pageId, selection: [edit.createdParentId ?? edit.layerId] }, afterSelection: [edit.layerId], mutate(project) {
    if(edit.frameBase){const migrated=migrateProject(project);if(!migrated.ok)throw Error(migrated.problems[0].message);Object.assign(project,migrated.value);}
    if (edit.createdParentId) {
      project.layers[edit.layerId] = structuredClone(edit.base.layers[edit.layerId]);
      const bubble = project.layers[edit.createdParentId]; if (bubble.type !== 'bubble') throw Error('气泡编辑目标已变化');
      bubble.children.push(edit.layerId);
    }
    project.layers[edit.layerId] = layerWithDraft(edit, draft);
  } });
  if (!result.ok) { unregister = registerTextEditBoundary((mode) => mode === 'cancel' ? cancelTextEdit() : commitTextEdit()); return result; }
  clear(); return ok(undefined);
}
export function cancelTextEdit(): Result<void> { clear(); return ok(undefined); }
