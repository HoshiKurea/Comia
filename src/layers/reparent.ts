import {freezeBubbleText} from '../text/freezeBubbleText';
import { unbindPanelImages } from '../images/panelAssociation';
import type { Id, Mat, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { LIMITS } from '../domain/limits';
import { inverse, multiply, scaling, translation, worldMatrix } from '../geometry/matrix';
import { resolveCrop } from '../images/crop';
import { execute } from '../history/commandBus';
import { getProject } from '../state/documentStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { hasLockedDescendant } from './group';
import { isBoundTail } from '../domain/mangaCounts';
import { preflightDialogueRemoval } from '../bubbles/ownership';
import { detachTail } from '../bubbles/tailCommands';

function depthOf(project: ReturnType<typeof getProject>, id: Id | null): number {
  let depth = 0;
  for (let current = id; current; current = project.layers[current]?.parentId ?? null) depth += 1;
  return depth;
}

function subtreeDepth(project: ReturnType<typeof getProject>, id: Id): number {
  const layer = project.layers[id];
  if(isBoundTail(layer))return 0;
  return 'children' in layer ? 1 + Math.max(0, ...layer.children.map((child) => subtreeDepth(project, child))) : 1;
}

/** 通用group/root之间显式重挂；矩阵 Mnew=inv(WparentNew)*Wold 保持页面位置。 */
export function reparent(ids: Id[], newParentId: Id | null): Result<void> {
  const project = getProject();
  const selected = [...new Set(ids)];
  if (!selected.length || selected.some((id) => !project.layers[id])) return fail(problem('reparent/selection', '选区为空或含缺失图层'));
  const pageId = project.layers[selected[0]].pageId;
  if (selected.some(id => project.layers[id].type === 'pageBackground')) return fail(problem('background/reparent', '页面背景不能移入容器'));
  if (selected.some((id) => project.layers[id].pageId !== pageId)) return fail(problem('reparent/cross-page', '不能跨页面移入编组'));
  const target = newParentId ? project.layers[newParentId] : null;
  if (newParentId && (!target || target.type !== 'group' || target.pageId !== pageId)) return fail(problem('reparent/target', '目标必须是同页的普通编组'));
  if(target?.type==='group'&&target.dialogue&&selected.some(id=>project.layers[id].type!=='bubble'))return fail(problem('reparent/dialogue','对白组只能接收气泡主体'));
  const relations=preflightDialogueRemoval(project,selected.filter(id=>project.layers[id].parentId!==newParentId));if(!relations.ok)return relations;
  if (newParentId && effectiveLayerFlags(project, newParentId).locked) return fail(problem('reparent/target-locked', '目标编组已锁定'));
  const selectedSet = new Set(selected);
  for (const id of selected) {
    const layer = project.layers[id];
    const parent = layer.parentId ? project.layers[layer.parentId] : null;
    if (parent && parent.type !== 'group') return fail(problem('reparent/owned', '受控子层请使用“移出容器”'));
    if (effectiveLayerFlags(project, id).locked || hasLockedDescendant(project, id)) return fail(problem('reparent/locked', `锁定图层“${layer.name}”阻止移动`));
    if (parent?.type === 'group' && parent.locked) return fail(problem('reparent/old-parent-locked', '原编组已锁定'));
    for (let ancestor = layer.parentId; ancestor; ancestor = project.layers[ancestor]?.parentId ?? null) if (selectedSet.has(ancestor)) return fail(problem('reparent/ancestor', '不能同时移动祖先及其子层'));
    for (let ancestor = newParentId; ancestor; ancestor = project.layers[ancestor]?.parentId ?? null) if (ancestor === id) return fail(problem('reparent/cycle', '不能把编组移入自身或后代'));
    if (depthOf(project, newParentId) + subtreeDepth(project, id) > LIMITS.maxDepth) return fail(problem('reparent/depth', '移动后图层嵌套超过16层'));
  }
  if (selected.every((id) => project.layers[id].parentId === newParentId)) return ok(undefined);
  const world = new Map(selected.map((id) => [id, worldMatrix(project, id)]));
  const wasVisible = new Map(selected.map((id) => [id, effectiveLayerFlags(project, id).visible]));
  const newParentVisible = newParentId ? effectiveLayerFlags(project, newParentId).visible : true;
  const parentWorld: Mat = newParentId ? worldMatrix(project, newParentId) : [1, 0, 0, 1, 0, 0];
  const parentInv = inverse(parentWorld);
  if (!parentInv.ok) return parentInv;
  const order = new Map<Id, number>();
  const visit = (id: Id) => {
    order.set(id, order.size);
    const layer = project.layers[id];
    if (layer && 'children' in layer) for (const child of layer.children) visit(child);
  };
  for (const root of project.pages[pageId].roots) visit(root);
  selected.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const result = execute({ label: '移动图层至编组', context: { pageId, selection: selected }, afterSelection: selected, mutate(draft) {
    for (const id of selected) {
      const layer = draft.layers[id];
      const oldParent = layer.parentId ? draft.layers[layer.parentId] : null;
      if (oldParent && 'children' in oldParent) oldParent.children = oldParent.children.filter((child) => child !== id);
      else draft.pages[pageId].roots = draft.pages[pageId].roots.filter((root) => root !== id);
      layer.matrix = multiply(parentInv.value, world.get(id)!);
      layer.parentId = newParentId;
      if (!wasVisible.get(id) && newParentVisible) layer.visible = false;
    }
    if (newParentId) {
      const owner = draft.layers[newParentId];
      if (owner.type !== 'group') throw new Error('目标编组在事务中失效');
      owner.children.push(...selected);
    } else draft.pages[pageId].roots.push(...selected);
  } });
  return result.ok ? ok(undefined) : result;
}

/** 移出 panel image、bubble text 或切割子分镜；取消祖先裁剪但保持页面坐标。 */
export function detachOwned(id: Id): Result<void> {
  const project = getProject();
  const layer = project.layers[id];
  if (!layer || !layer.parentId) return fail(problem('detach/target', '请选择容器内的受控子层'));
  if(layer.type==='bubbleTail')return detachTail(id);
  const parent = project.layers[layer.parentId];
  if (layer.type === 'image' && parent.type === 'panel') return unbindPanelImages([id]);
  const supported = (parent.type === 'panel' && (layer.type === 'image' || layer.type === 'panel')) || (parent.type === 'bubble' && layer.type === 'text');
  if (!supported) return fail(problem('detach/owned', '当前父子关系不属于受控容器'));
  if (effectiveLayerFlags(project, id).locked || hasLockedDescendant(project, id)) return fail(problem('detach/locked', `锁定图层“${layer.name}”阻止移出`));
  let matrix = worldMatrix(project, id);
  if (layer.type === 'image' && layer.crop) {
    if (parent.type !== 'panel') return fail(problem('detach/crop', '分镜图片缺少裁剪参数'));
    const mapping = resolveCrop(parent.geometry, { x: layer.width, y: layer.height }, layer.crop);
    matrix = multiply(matrix, multiply(translation(mapping.tx, mapping.ty), scaling(mapping.scale, mapping.scale)));
  }
  const parentParent = parent.parentId ? project.layers[parent.parentId] : null;
  const newParentId = parentParent?.type === 'group' ? parentParent.id : null;
  const newParentWorld: Mat = newParentId ? worldMatrix(project, newParentId) : [1, 0, 0, 1, 0, 0];
  const inv = inverse(newParentWorld);
  if (!inv.ok) return inv;
  const local = multiply(inv.value, matrix);
  const wasVisible = effectiveLayerFlags(project, id).visible;
  const newParentVisible = newParentId ? effectiveLayerFlags(project, newParentId).visible : true;
  const result = execute({ label: '移出容器', context: { pageId: layer.pageId, selection: [id] }, afterSelection: [id], mutate(draft) {
    const target = draft.layers[id];
    const owner = draft.layers[parent.id];
    if (!('children' in owner)) throw new Error('原容器已失效');
    owner.children = owner.children.filter((child) => child !== id);
    if(target.type==='text'&&target.bubbleFrame){Object.assign(target,freezeBubbleText(project,id));delete target.bubbleFrame;}
    target.parentId = newParentId;
    target.matrix = local;
    if (!wasVisible && newParentVisible) target.visible = false;
    if (target.type === 'image') target.crop = null;
    if (newParentId) {
      const group = draft.layers[newParentId];
      if (group.type !== 'group') throw new Error('目标编组已失效');
      group.children.push(id);
    } else draft.pages[layer.pageId].roots.push(id);
  } });
  return result.ok ? ok(undefined) : result;
}
