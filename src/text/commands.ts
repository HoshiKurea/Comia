import type { Id, Point, Result, TextLayer, BubbleTextFrame } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { getDocument } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { execute } from '../history/commandBus';
import { createLayer } from '../domain/factories';
import { translation } from '../geometry/matrix';
import { mainBubbleText } from '../bubbles/ownership';
import { parseBubbleFrame } from '../domain/extensionValidation';
import { beginTextEdit, currentTextEdit, updateTextStyleDraft, updateBubbleFrameDraft, type TextStylePatch } from './editController';

export function createText(pageId: Id, origin: Point): Result<Id> {
  const text = createLayer('text', pageId); text.matrix = translation(origin.x, origin.y);
  const result = execute({ label: '创建文字', context: { pageId, selection: sessionStore.getState().selection }, afterSelection: [text.id], mutate(project) { project.layers[text.id] = text; project.pages[pageId].roots.push(text.id); } });
  return result.ok ? ok(text.id) : result;
}
export function setTextStyle(id: Id, patch: TextStylePatch): Result<void> {
  const edit = currentTextEdit(), project = edit?.layerId === id ? edit.preview : getDocument().project, layer = project.layers[id];
  if (layer?.type !== 'text') return fail(problem('text/target', '目标文字已不存在'));
  if (effectiveLayerFlags(project, id).locked) return fail(problem('text/locked', '锁定的文字不能改样式'));
  if(layer.bubbleFrame?.placement==='center'&&patch.align&&patch.align!=='center')return fail(problem('text/bubble-align','气泡对白使用居中；手动文字框控制换行'));
  if (edit?.layerId === id) return updateTextStyleDraft(patch);
  const result = execute({ label: '修改文字样式', context: { pageId: layer.pageId, selection: sessionStore.getState().selection }, mutate(draft) {
    const target = draft.layers[id] as TextLayer;
    target.text = { ...target.text, ...patch, font: { ...target.text.font, ...patch.font } };
  } });
  return result.ok ? ok(undefined) : result;
}
/** Frame edits join the current text draft, so dimensions/content/style undo together. */
export function setBubbleTextFrame(id:Id,frame:BubbleTextFrame):Result<void>{
  const project=currentTextEdit()?.layerId===id?currentTextEdit()!.preview:getDocument().project,layer=project.layers[id];
  if(layer?.type!=='text'||!layer.parentId||mainBubbleText(project,layer.parentId)?.id!==id)return fail(problem('text/bubble-frame-target','请选择气泡中的主对白'));
  const parsed=parseBubbleFrame(frame,`layers.${id}.bubbleFrame`);if(!parsed.ok)return parsed;
  const began=beginTextEdit(id);return began.ok?updateBubbleFrameDraft(parsed.value):began;
}
