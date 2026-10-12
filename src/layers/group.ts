import type { Id, Layer, Mat, Point, Project, Rect, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { createLayer } from '../domain/factories';
import { LIMITS } from '../domain/limits';
import { apply, multiply, translation } from '../geometry/matrix';
import { getProject } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { execute } from '../history/commandBus';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { tailControlPoints } from '../bubbles/tailBounds';
import { mangaLayerCounts, isBoundTail } from '../domain/mangaCounts';

function childrenOf(project: Project, pageId: Id, parentId: Id | null): Id[] | null {
  if (!parentId) return project.pages[pageId]?.roots ?? null;
  const parent = project.layers[parentId];
  return parent?.type === 'group' ? parent.children : null;
}

function hasLockedDescendant(project: Project, id: Id): string | null {
  const layer = project.layers[id];
  if (!layer) return null;
  if (layer.locked) return layer.name;
  if ('children' in layer) for (const child of layer.children) {
    const locked = hasLockedDescendant(project, child);
    if (locked) return locked;
  }
  return null;
}

export { hasLockedDescendant };

function corners(rect: Rect): Point[] {
  return [
    { x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height },
  ];
}

function ownPoints(project: Project, layer: Layer): Point[] {
  if (layer.type === 'bubbleTail') { const owner = layer.parentId ? project.layers[layer.parentId] : undefined; return tailControlPoints(layer, owner?.type === 'bubble' ? owner : undefined); }
  if (layer.type === 'panel') return layer.geometry;
  if (layer.type === 'text') return corners(layer.box);
  if (layer.type === 'group') return [];
  if (layer.type === 'pageBackground') return [];
  return corners({ x: 0, y: 0, width: layer.type === 'decoration' ? layer.spec.width : layer.width, height: layer.type === 'decoration' ? layer.spec.height : layer.height });
}

function collectPoints(project: Project, id: Id, transform: Mat, out: Point[]): void {
  const layer = project.layers[id];
  const matrix = multiply(transform, layer.matrix);
  if (layer.type === 'group') for (const child of layer.children) collectPoints(project, child, matrix, out);
  else for (const point of ownPoints(project, layer)) out.push(apply(matrix, point));
}

/** Pure preflight shared by the toolbar and command, including its actionable error. */
export function groupEligibility(project: Project, ids: Id[]): Result<Id[]> {
  const unique = [...new Set(ids)];
  if (unique.length < 2) return fail(problem('group/count', '请至少选择两个图层'));
  const layers = unique.map((id) => project.layers[id]);
  if (layers.some((layer) => !layer)) return fail(problem('group/missing', '选区包含不存在的图层'));
  const first = layers[0];
  if (layers.some(layer => layer.type === 'pageBackground')) return fail(problem('background/group', '页面背景不能进入编组'));
  if (layers.some((layer) => layer.pageId !== first.pageId || layer.parentId !== first.parentId)) return fail(problem('group/parent', '只能编组同页、同父级的图层'));
  const siblings = childrenOf(project, first.pageId, first.parentId);
  if (!siblings) return fail(problem('group/owned', '受分镜或气泡控制的子层不能直接编组'));
  const indices = unique.map((id) => siblings.indexOf(id)).sort((a, b) => a - b);
  if (indices[0] < 0 || indices.some((index, i) => i > 0 && index !== indices[0] + i)) return fail(problem('group/noncontiguous', '选中的图层不连续，请先调整图层顺序'));
  for (const id of unique) {
    const locked = hasLockedDescendant(project, id);
    if (locked) return fail(problem('group/locked', `锁定图层“${locked}”阻止编组`));
    if (effectiveLayerFlags(project, id).locked) return fail(problem('group/locked', `图层“${project.layers[id].name}”的祖先已锁定，请先解锁`));
  }
  let depth = 1;
  for (let parentId = first.parentId; parentId; parentId = project.layers[parentId]?.parentId ?? null) depth++;
  const height = (id: Id): number => { const layer = project.layers[id]; if (isBoundTail(layer)) return 0; return 'children' in layer && layer.children.length ? 1 + Math.max(...layer.children.map(height)) : 1; };
  if (unique.some((id) => depth + height(id) > LIMITS.maxDepth)) return fail(problem('group/depth', '编组后图层树过深，请先减少嵌套层级'));
  if (mangaLayerCounts(project).content >= LIMITS.maxLayers) return fail(problem('group/capacity', '编组会超过项目图层数量上限，请先删除不需要的图层'));
  return ok(siblings.slice(indices[0], indices[0] + unique.length));
}

export function groupLayers(ids: Id[]): Result<Id> {
  const project = getProject(), eligible = groupEligibility(project, ids);
  if (!eligible.ok) return eligible;
  const ordered = eligible.value, first = project.layers[ordered[0]], siblings = childrenOf(project, first.pageId, first.parentId)!;
  const indices = ordered.map((id) => siblings.indexOf(id));
  const points: Point[] = [];
  for (const id of ordered) collectPoints(project, id, [1, 0, 0, 1, 0, 0], points);
  const left = points.length ? Math.min(...points.map((point) => point.x)) : 0;
  const top = points.length ? Math.min(...points.map((point) => point.y)) : 0;
  const group = createLayer('group', first.pageId);
  if (group.type !== 'group') throw new Error('group factory mismatch');
  group.parentId = first.parentId;
  group.matrix = translation(left, top);
  group.children = ordered;
  const result = execute({ label: '编组', context: { pageId: first.pageId, selection: sessionStore.getState().selection }, afterSelection: [group.id], mutate(draft) {
    const list = childrenOf(draft, first.pageId, first.parentId)!;
    list.splice(indices[0], ordered.length, group.id);
    draft.layers[group.id] = group;
    for (const id of ordered) {
      const child = draft.layers[id];
      child.parentId = group.id;
      child.matrix = multiply(translation(-left, -top), child.matrix);
    }
  } });
  return result.ok ? ok(group.id) : result;
}

export function ungroupEligibility(project: Project, id: Id): Result<Id[]> {
  const group = project.layers[id];
  if (!group || group.type !== 'group') return fail(problem('ungroup/target', '请选择编组'));
  const locked = hasLockedDescendant(project, id);
  if (locked) return fail(problem('ungroup/locked', `锁定图层“${locked}”阻止解组`));
  if (effectiveLayerFlags(project, id).locked) return fail(problem('ungroup/locked', `编组“${group.name}”的祖先已锁定，请先解锁`));
  if (!childrenOf(project, group.pageId, group.parentId)) return fail(problem('ungroup/parent', '受容器控制的编组不能直接解组，请先移出容器'));
  return ok([...group.children]);
}

export function ungroup(id: Id): Result<Id[]> {
  const project = getProject(), eligible = ungroupEligibility(project, id);
  if (!eligible.ok) return eligible;
  const group = project.layers[id];
  if (group.type !== 'group') return fail(problem('ungroup/target', '请选择编组'));
  const children = [...group.children];
  const result = execute({ label: '解组', context: { pageId: group.pageId, selection: sessionStore.getState().selection }, afterSelection: children, mutate(draft) {
    const list = childrenOf(draft, group.pageId, group.parentId)!;
    const index = list.indexOf(id);
    list.splice(index, 1, ...children);
    for (const childId of children) {
      const child = draft.layers[childId];
      child.parentId = group.parentId;
      child.matrix = multiply(group.matrix, child.matrix);
      if (!group.visible) child.visible = false;
    }
    delete draft.layers[id];
  } });
  return result.ok ? ok(children) : result;
}
