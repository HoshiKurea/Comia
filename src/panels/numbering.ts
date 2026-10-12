import type { Id, PanelLayer, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { apply, worldMatrix } from '../geometry/matrix';
import { polyBounds } from '../geometry/polygon';
import { sortPanelReadingOrder } from './readingOrder';

export interface NumberAssignment { id: Id; number: number }
export interface PanelReplacementIntent { sourceId: Id; newIds: readonly Id[] }
export interface PanelNumberPlan { assignments: { id: Id; before: number | null; after: number }[]; nextPanelNumber: number }
export function planPanelReplacementNumbers(before: Project, draft: Project, intent: PanelReplacementIntent): Result<PanelNumberPlan> {
  const source = before.layers[intent.sourceId], requested = new Set(intent.newIds);
  if (source?.type !== 'panel' || source.role !== 'leaf' || !Number.isSafeInteger(source.editorNumber) || source.editorNumber! < 1 || draft.layers[source.id] || !requested.size || requested.size !== intent.newIds.length)
    return fail(problem('panel/replacement', '切割编号需要一个已删除的原分镜及不重复的新分镜'));
  const entries = [];
  for (const [paintIndex, id] of intent.newIds.entries()) {
    const layer = draft.layers[id];
    if (before.layers[id] || layer?.type !== 'panel' || layer.role !== 'leaf' || layer.pageId !== source.pageId) return fail(problem('panel/replacement-target', '切割结果须为同页的新独立分镜'));
    try { const matrix = worldMatrix(draft, id); entries.push({ id, bounds: polyBounds(layer.geometry.map(p => apply(matrix, p))), paintIndex }); }
    catch { return fail(problem('panel/replacement-tree', '切割结果的图层变换树无效，未应用编号')); }
  }
  const sorted = sortPanelReadingOrder(entries, draft.settings.readingDirection); if (!sorted.ok) return sorted;
  const delta = requested.size - 1, start = source.editorNumber!, assignments: PanelNumberPlan['assignments'] = [], usedBefore = new Set<number>();
  for (const old of Object.values(before.layers)) if (old.type === 'panel' && old.role === 'leaf') {
    const n = old.editorNumber;
    if (!Number.isSafeInteger(n) || n! < 1 || usedBefore.has(n!)) return fail(problem('panel/number-existing', '现存分镜序号无效或重复，作品未修改'));
    usedBefore.add(n!);
    if (old.id === source.id) continue;
    const current = draft.layers[old.id];
    if (current?.type === 'panel' && current.role === 'leaf') assignments.push({ id: old.id, before: n!, after: n! > start ? n! + delta : n! });
  }
  sorted.value.forEach((id, i) => assignments.push({ id, before: null, after: start + i }));
  let maximum = 0; const used = new Set<number>();
  for (const { after } of assignments) {
    if (!Number.isSafeInteger(after) || after < 1 || used.has(after)) return fail(problem('panel/number-limit', '切割后的序号重复或超出安全整数上限'));
    used.add(after); maximum = Math.max(maximum, after);
  }
  if (!Number.isSafeInteger(maximum + 1)) return fail(problem('panel/number-limit', '切割后的分镜序号已达上限，未修改作品'));
  return ok({ assignments, nextPanelNumber: maximum + 1 });
}
export function assignNewPanelNumbers(draft: Project, ids: readonly Id[]): Result<NumberAssignment[]> {
  const unique = [...new Set(ids)], requested = new Set(unique), used = new Set<number>();
  let maximum = 0;
  for (const layer of Object.values(draft.layers)) if (layer.type === 'panel' && layer.role === 'leaf' && !requested.has(layer.id)) {
    const n = layer.editorNumber;
    if (!Number.isSafeInteger(n) || n! < 1 || used.has(n!)) return fail(problem('panel/number-existing', '现存分镜序号无效或重复，作品未修改'));
    used.add(n!); maximum = Math.max(maximum, n!);
  }
  const start = maximum + 1;
  if (!Number.isSafeInteger(start) || unique.length > Number.MAX_SAFE_INTEGER - start) return fail(problem('panel/number-limit', '分镜序号已达上限，创建未执行'));
  const order = new Map<Id, number>();
  const visit = (id: Id) => { const layer = draft.layers[id]; if (!layer || order.has(id)) throw Error('图层树引用缺失或重复'); order.set(id, order.size); if ('children' in layer) layer.children.forEach(visit); };
  try { draft.pageOrder.forEach(pid => draft.pages[pid].roots.forEach(visit)); } catch { return fail(problem('panel/number-tree', '分镜图层树无效')); }
  const assignments: NumberAssignment[] = [];
  for (const id of unique) { const p = draft.layers[id]; if (p?.type !== 'panel' || p.role !== 'leaf' || p.editorNumber !== undefined || !order.has(id)) return fail(problem('panel/number-target', '只能为尚未编号的新叶子分镜分配序号')); }
  for (const pageId of draft.pageOrder) {
    const candidates = unique.filter(id => draft.layers[id].pageId === pageId).map(id => {
      const p = draft.layers[id] as PanelLayer, world = worldMatrix(draft, id);
      return { id, bounds: polyBounds(p.geometry.map(v => apply(world, v))), paintIndex: order.get(id)! };
    });
    const sorted = sortPanelReadingOrder(candidates, draft.settings.readingDirection); if (!sorted.ok) return sorted;
    for (const id of sorted.value) assignments.push({ id, number: start! + assignments.length });
  }
  if (assignments.length !== requested.size) return fail(problem('panel/number-page', '新分镜引用了缺失页面'));
  for (const { id, number } of assignments) (draft.layers[id] as PanelLayer).editorNumber = number;
  draft.nextPanelNumber = start! + assignments.length;
  return ok(assignments);
}

/** Every creation path goes through this hook before transaction validation/diff. */
export function numberCreatedPanels(before: Project, draft: Project, defaultNamedIds: readonly Id[] = [], replacement?: PanelReplacementIntent): Result<void> {
  if (draft.schemaVersion < 5) return ok(undefined);
  const ids: Id[] = [];
  for (const layer of Object.values(draft.layers)) if (layer.type === 'panel') {
    const old = before.layers[layer.id];
    if (layer.role === 'split') delete layer.editorNumber;
    else if (!old || old.type !== 'panel' || old.role !== 'leaf') { delete layer.editorNumber; ids.push(layer.id); }
  }
  const named = new Set(defaultNamedIds), created = new Set(ids);
  if ([...named].some(id => !created.has(id))) return fail(problem('panel/name-target', '默认命名只能用于本次新建的分镜'));
  let replaced = new Set<Id>();
  if (replacement) {
    const planned = planPanelReplacementNumbers(before, draft, replacement); if (!planned.ok) return planned;
    for (const row of planned.value.assignments) (draft.layers[row.id] as PanelLayer).editorNumber = row.after;
    draft.nextPanelNumber = planned.value.nextPanelNumber; replaced = new Set(replacement.newIds);
  }
  const assigned = assignNewPanelNumbers(draft, ids.filter(id => !replaced.has(id))); if (!assigned.ok) return assigned;
  if (draft.schemaVersion >= 9) {
    for (const id of named) (draft.layers[id] as PanelLayer).nameMode = 'automatic';
    for (const layer of Object.values(draft.layers)) if (layer.type === 'panel' && layer.role === 'leaf' && layer.nameMode === 'automatic') layer.name = `分镜 ${layer.editorNumber}`;
    return ok(undefined);
  }
  if (!named.size) return ok(undefined);
  // Existing projects can have factory names ahead of their actual editor numbers.
  // Reserve those visible suffixes without inferring that a user-provided name is automatic.
  let suffix = 0;
  for (const layer of Object.values(draft.layers)) if (layer.type === 'panel' && !named.has(layer.id)) {
    const match = /^分镜 ([1-9]\d*)$/.exec(layer.name), n = match ? Number(match[1]) : 0;
    if (Number.isSafeInteger(n)) suffix = Math.max(suffix, n);
  }
  for (const { id, number } of assigned.value) if (named.has(id)) {
    suffix = Math.max(suffix + 1, number);
    if (!Number.isSafeInteger(suffix)) return fail(problem('panel/name-limit', '默认分镜名称序号已达上限，创建未执行'));
    draft.layers[id].name = `分镜 ${suffix}`;
  }
  return ok(undefined);
}
