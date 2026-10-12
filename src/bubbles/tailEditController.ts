import type { BubbleTailLayer, Id, Result } from '../domain/types';
import { fail, problem } from '../domain/types';
import { beginMangaEdit, cancelMangaEdit, commitMangaEdit, mangaEditGuard, publishMangaPreview, currentMangaEdit } from './mangaEditController';
import { boundTailOwnerProblem, parseTailFields } from '../domain/mangaValidation';
import { composeBubble } from './composeBubble';
import { prepareTailPaint } from './tailPaint';
import { editorGeometryTarget } from './editorTarget';

export type TailEditPatch=Partial<Pick<BubbleTailLayer,'appearance'|'attachment'|'tip'|'route'|'beads'|'zigzag'|'style'|'stroke'>>;
export const beginTailEdit=(id:Id):Result<void>=>beginMangaEdit(id,'tail');
export const commitTailEdit=commitMangaEdit;
export const cancelTailEdit=cancelMangaEdit;
export function updateTailEdit(patch:TailEditPatch):Result<void>{
  const guard=mangaEditGuard();if(!guard.ok)return guard;const active=guard.value;if(active.kind!=='tail')return fail(problem('tail/edit-kind','当前编辑不是尾巴'));
  const original=active.preview.layers[active.id];if(original.type!=='bubbleTail')return fail(problem('tail/edit-target','尾巴已不存在'));
  if(Object.keys(patch).some(key=>!['appearance','attachment','tip','route','beads','zigzag','style','stroke'].includes(key)))return fail(problem('tail/edit-field','尾巴编辑不能改变身份/归属或矩阵'));
  const tail={...original,...structuredClone(patch)};
  if(tail.attachment.mode!==original.attachment.mode)return fail(problem('tail/edit-owner','请使用绑定/拆出命令改变归属'));
  if(tail.route.kind!=='straight'||!['triangle','line'].includes(tail.appearance))tail.legacySplice=false;
  const fields=parseTailFields(tail as unknown as Record<string,unknown>,`layers.${tail.id}`);if(!fields.ok)return fields;
  const preview={...active.preview,layers:{...active.preview.layers,[tail.id]:tail}},owner=boundTailOwnerProblem(preview.layers,tail);if(!owner.ok)return owner;
  const body=tail.parentId?preview.layers[tail.parentId]:null;
  const geometry=body?.type==='bubble'?composeBubble(preview,body.id,editorGeometryTarget(preview,body.id)):prepareTailPaint(preview,tail.id,editorGeometryTarget(preview,tail.id));if(!geometry.ok)return geometry;
  return publishMangaPreview(preview);
}
export function currentTailEdit(){const active=currentMangaEdit();return active?.kind==='tail'?active:null;}
