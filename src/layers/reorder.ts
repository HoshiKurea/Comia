import type { Id, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { execute } from '../history/commandBus';
import { getProject } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { hasLockedDescendant } from './group';
import { effectiveLayerFlags } from '../state/effectiveFlags';

export interface LayerDrop { draggedIds: Id[]; parentId: Id | null; beforeId: Id | null }

export function reorderSiblings(drop: LayerDrop): Result<void> {
  const project = getProject();
  const filter = sessionStore.getState().filter;
  if (filter.name.trim() || filter.color) return fail(problem('reorder/filter', '清除图层筛选后才能调整顺序'));
  const ids = [...new Set(drop.draggedIds)];
  if (!ids.length) return fail(problem('reorder/empty', '没有需要移动的图层'));
  const layers = ids.map((id) => project.layers[id]);
  const first = layers[0];
  if (layers.some(layer => layer?.type === 'pageBackground')) return fail(problem('background/reorder', '页面背景固定在最底部'));
  if (!first || layers.some((layer) => !layer || layer.pageId !== first.pageId || layer.parentId !== first.parentId || layer.parentId !== drop.parentId)) return fail(problem('reorder/parent', '排序仅支持同页、同父级图层'));
  const parent = drop.parentId ? project.layers[drop.parentId] : null;
  const siblings = drop.parentId ? parent?.type === 'group' || parent?.type === 'panel' || parent?.type === 'bubble' ? parent.children : null : project.pages[first.pageId]?.roots;
  if (!siblings || ids.some((id) => !siblings.includes(id))) return fail(problem('reorder/siblings', '目标不在同一图层列表'));
  if (drop.beforeId && (!siblings.includes(drop.beforeId) || ids.includes(drop.beforeId))) return drop.beforeId && ids.includes(drop.beforeId) ? ok(undefined) : fail(problem('reorder/anchor', '插入位置无效'));
  for (const id of ids) {
    if (effectiveLayerFlags(project, id).locked) return fail(problem('reorder/locked', `图层“${project.layers[id].name}”被自身或祖先锁定，不能排序`));
    const locked = hasLockedDescendant(project, id);
    if (locked) return fail(problem('reorder/locked', `锁定图层“${locked}”阻止排序`));
  }
  const ordered = siblings.filter((id) => ids.includes(id));
  const rest = siblings.filter((id) => !ids.includes(id));
  const index = drop.beforeId ? rest.indexOf(drop.beforeId) : rest.length;
  if (rest[0] && project.layers[rest[0]]?.type === 'pageBackground' && index === 0) return fail(problem('background/reorder', '内容不能放到页面背景下方'));
  rest.splice(index, 0, ...ordered);
  const result = execute({ label: '调整图层顺序', context: { pageId: first.pageId, selection: sessionStore.getState().selection }, mutate(draft) {
    if (drop.parentId) {
      const owner = draft.layers[drop.parentId];
      if (owner && 'children' in owner) owner.children = rest;
    } else draft.pages[first.pageId].roots = rest;
  } });
  return result.ok ? ok(undefined) : result;
}

export function moveLayer(id: Id, direction: 'top' | 'bottom' | 'up' | 'down'): Result<void> {
  return moveLayers([id], direction);
}

/** Noncontiguous selected siblings move as one stable block; up/down crosses one unselected neighbor. */
export function moveLayers(input: Id[], direction: 'top' | 'bottom' | 'up' | 'down'): Result<void> {
  const project = getProject();
  const ids = [...new Set(input)], layer = project.layers[ids[0]];
  if (!layer) return fail(problem('reorder/missing', '图层不存在'));
  if (ids.some((id) => !project.layers[id] || project.layers[id].pageId !== layer.pageId || project.layers[id].parentId !== layer.parentId)) return fail(problem('reorder/parent', '批量排序仅支持同页、同父级图层'));
  const parent = layer.parentId ? project.layers[layer.parentId] : null;
  const siblings = layer.parentId ? parent && 'children' in parent ? parent.children : null : project.pages[layer.pageId]?.roots;
  if (!siblings) return fail(problem('reorder/siblings', '图层不在可排序列表'));
  const selected = new Set(ids), indices = ids.map((id) => siblings.indexOf(id));
  if (indices.some((index) => index < 0)) return fail(problem('reorder/missing', '图层未出现在父级列表'));
  const low = Math.min(...indices), high = Math.max(...indices), rest = siblings.filter((id) => !selected.has(id));
  if (!rest.length) return reorderSiblings({ draggedIds: ids, parentId: layer.parentId, beforeId: null });
  if (direction === 'top') return reorderSiblings({ draggedIds: ids, parentId: layer.parentId, beforeId: null });
  if (direction === 'bottom') return reorderSiblings({ draggedIds: ids, parentId: layer.parentId, beforeId: rest[project.layers[rest[0]]?.type === 'pageBackground' ? 1 : 0] ?? null });
  if (direction === 'up') return high === siblings.length - 1 ? ok(undefined) : reorderSiblings({ draggedIds: ids, parentId: layer.parentId, beforeId: siblings[high + 2] ?? null });
  return low === 0 || project.layers[siblings[low - 1]]?.type === 'pageBackground' ? ok(undefined) : reorderSiblings({ draggedIds: ids, parentId: layer.parentId, beforeId: siblings[low - 1] });
}
