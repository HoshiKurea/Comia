import type { Id, Mat, Project, Rect, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { inverse, multiply, worldMatrix, IDENTITY } from '../geometry/matrix';
import { unionBounds } from '../geometry/bounds';
import { layerWorldBounds } from './layerBounds';
import { validateTransform } from '../domain/validate';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { hasLockedDescendant } from '../layers/group';
import { freeImage, promoteMaterials } from '../images/freeImage';

export function selectionRoots(project: Project, ids: readonly Id[]): Id[] {
  const selected = new Set(ids);
  return [...selected].filter(id => {
    for (let parent = project.layers[id]?.parentId; parent; parent = project.layers[parent]?.parentId) if (selected.has(parent)) return false;
    return true;
  });
}
export function selectionTransformBounds(project: Project, ids: readonly Id[]): Rect | null {
  return unionBounds(selectionRoots(project, ids).map(id => {
    const layer = project.layers[id];
    if (layer?.type === 'image' && layer.crop) {
      const converted = { ...project, layers: { ...project.layers, [id]: freeImage(project, id) } };
      return layerWorldBounds(converted, id);
    }
    return layerWorldBounds(project, id);
  }).filter((b): b is Rect => b !== null));
}
/** Page affine T applied once per selected root:
 * L' = inverse(W(parent)) * T * W(original). Children retain their local matrices.
 * No reparenting or paint-order change; previews share every untouched layer. */
export function transformSelectionDraft(start: Project, ids: readonly Id[], transform: Mat): Result<Project> {
  const valid = validateTransform(transform); if (!valid.ok) return valid;
  if (!ids.length || ids.some(id => !start.layers[id])) return fail(problem('transform/selection', '选区为空或对象已不存在'));
  const roots = selectionRoots(start, ids), pageId = start.layers[roots[0]].pageId;
  const draft = { ...start, layers: { ...start.layers } };
  for (const id of roots) {
    const layer = start.layers[id], parent = layer.parentId ? start.layers[layer.parentId] : null;
    if (layer.pageId !== pageId || layer.type === 'pageBackground') return fail(problem('transform/page', '只能变换同一页面的内容对象；页面背景不能变换'));
    if (!effectiveLayerFlags(start, id).visible || effectiveLayerFlags(start, id).locked || hasLockedDescendant(start, id)) return fail(problem('transform/locked', '选区含隐藏或锁定对象，整批变换未应用'));
    if (parent?.type === 'bubble' || parent?.type === 'panel' && layer.type !== 'image') return fail(problem('transform/owned', '容器控制的文字、尾巴或旧子分镜请连同所属容器选择'));
    const inverseParent = inverse(parent ? worldMatrix(start, parent.id) : IDENTITY); if (!inverseParent.ok) return inverseParent;
    const source = layer.type === 'image' && layer.crop ? freeImage(start, id) : layer;
    const matrix = multiply(multiply(inverseParent.value, transform), multiply(parent ? worldMatrix(start, parent.id) : IDENTITY, source.matrix));
    const checked = validateTransform(matrix); if (!checked.ok) return checked;
    draft.layers[id] = { ...source, matrix };
    if (source !== layer) promoteMaterials(draft);
  }
  return ok(draft);
}
