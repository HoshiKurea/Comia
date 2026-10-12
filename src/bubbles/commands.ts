import type { BubbleStyle, Id, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { getDocument } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { execute } from '../history/commandBus';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { buildBubble } from './geometry';
import { mainBubbleText, legacyBubbleTail, bubbleTails } from './ownership';
import { bubbleFrameBounds } from '../text/bubbleFrameBounds';
import { composeBubble } from './composeBubble';
import {parseBubbleStyle} from '../domain/mangaValidation';
import {currentMangaEdit} from './mangaEditController';
import {updateEditedBubbleStyle} from './shapeController';
import {migrateProject} from '../storage/migrateProject';

export function setBubbleStyle(id: Id, patch: Partial<BubbleStyle>): Result<void> {
  if(currentMangaEdit()?.id===id&&currentMangaEdit()?.kind==='shape')return updateEditedBubbleStyle(patch);
  const edit = finishActiveTextEdit(); if (!edit.ok) return edit;
  const doc = getDocument(), bubble = doc.project.layers[id];
  if (bubble?.type !== 'bubble') return fail(problem('bubble/target', '目标气泡已不存在'));
  if (effectiveLayerFlags(doc.project, id).locked) return fail(problem('bubble/locked', '锁定的气泡不能修改样式'));
  if (Object.keys(patch).some((field) => !['fill', 'borderColor', 'borderWidth', 'radius','innerStroke','outerStroke'].includes(field))) return fail(problem('bubble/style-field', '气泡样式包含未知属性'));
  const style = { ...bubble.style, ...patch };
  const parsed=parseBubbleStyle(style,'style');if(!parsed.ok)return parsed;
  for (const field of ['fill', 'borderColor'] as const) {
    if (typeof style[field] !== 'string' || !/^#[0-9a-f]{8}$/i.test(style[field])) return fail(problem('bubble/style-color', '颜色须为#RRGGBBAA，包含透明度'));
    style[field] = style[field].toUpperCase();
  }
  if(JSON.stringify(style)!==JSON.stringify(bubble.style)&&bubbleTails(doc.project,id).some(t=>effectiveLayerFlags(doc.project,t.id).locked))return fail(problem('bubble/tail-locked','样式影响锁定尾巴，请先解锁'));
  const geometry = buildBubble(bubble.shape, bubble.width, bubble.height, style, legacyBubbleTail(doc.project, bubble), bubble); if (!geometry.ok) return geometry;
  const composed=composeBubble({...doc.project,layers:{...doc.project.layers,[id]:{...bubble,style}}},id);if(!composed.ok)return composed;
  const text = mainBubbleText(doc.project, id);
  const candidate={...doc.project,layers:{...doc.project.layers,[id]:{...bubble,style}}};
  const beforeFrame=text?bubbleFrameBounds(doc.project,text.id):null,nextFrame=text?bubbleFrameBounds(candidate,text.id):null;
  const previous=composeBubble(doc.project,id),affectsText=text?.bubbleFrame?text.bubbleFrame.placement==='center'&&(JSON.stringify(beforeFrame)!==JSON.stringify(nextFrame)||previous.ok&&JSON.stringify(previous.value.textBox)!==JSON.stringify(geometry.value.textBox)):text&&JSON.stringify(text.box)!==JSON.stringify(geometry.value.textBox);
  if (text && affectsText && effectiveLayerFlags(doc.project, text.id).locked) return fail(problem('bubble/text-locked', '样式变化影响锁定对白的安全区，样式未修改'));
  const result = execute({ label: '修改气泡样式', context: { pageId: bubble.pageId, selection: sessionStore.getState().selection }, mutate(project) {
    if((patch.innerStroke||patch.outerStroke)&&project.schemaVersion<9){const migrated=migrateProject(project);if(!migrated.ok)throw Error(migrated.problems[0].message);Object.assign(project,migrated.value);}
    const target = project.layers[id]; if (target.type !== 'bubble') throw Error('气泡目标已变化'); target.style = style;
    const child = mainBubbleText(project, id); if(child){if(child.bubbleFrame){const frame=bubbleFrameBounds(project,child.id);if(frame)child.box={...frame.box};}else child.box=geometry.value.textBox;}
  } });
  return result.ok ? ok(undefined) : result;
}
