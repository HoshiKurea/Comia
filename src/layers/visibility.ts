import type { Id, LabelColor, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { execute } from '../history/commandBus';
import { getProject } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';

function setFlag(ids: Id[], value: boolean, key: 'visible' | 'locked'): Result<void> {
  const project = getProject();
  const unique = [...new Set(ids)];
  if (!unique.length) return fail(problem('layer/empty', '没有目标图层'));
  const first = project.layers[unique[0]];
  if (!first || unique.some((id) => !project.layers[id] || project.layers[id].pageId !== first.pageId)) return fail(problem('layer/invalid-selection', '只能同时修改同页存在的图层'));
  const result = execute({ label: key === 'visible' ? (value ? '显示图层' : '隐藏图层') : (value ? '锁定图层' : '解锁图层'), context: { pageId: first.pageId, selection: sessionStore.getState().selection }, mutate(draft) {
    for (const id of unique) draft.layers[id][key] = value;
  } });
  return result.ok ? ok(undefined) : result;
}

export function setVisible(ids: Id[], value: boolean): Result<void> { return setFlag(ids, value, 'visible'); }
export function setLocked(ids: Id[], value: boolean): Result<void> { return setFlag(ids, value, 'locked'); }

export function setLabel(ids: Id[], color: LabelColor): Result<void> {
  if (color !== null && !['red', 'orange', 'yellow', 'green', 'blue', 'purple'].includes(color)) return fail(problem('layer/label', '颜色标签无效'));
  const project = getProject(), unique = [...new Set(ids)], first = project.layers[unique[0]];
  if (!first || unique.some((id) => !project.layers[id] || project.layers[id].pageId !== first.pageId)) return fail(problem('layer/invalid-selection', '请选择同页存在的图层'));
  const result = execute({ label: '修改颜色标签', context: { pageId: first.pageId, selection: sessionStore.getState().selection }, mutate(draft) { for (const id of unique) draft.layers[id].colorLabel = color; } });
  return result.ok ? ok(undefined) : result;
}

export function renameLayer(id: Id, name: string): Result<void> {
  const trimmed = name.trim();
  if (Array.from(trimmed).length < 1 || Array.from(trimmed).length > 80) return fail(problem('layer/name', '图层名称须为1～80个字符'));
  const layer = getProject().layers[id];
  if (!layer) return fail(problem('layer/missing', '图层不存在'));
  const result = execute({ label: '重命名图层', context: { pageId: layer.pageId, selection: sessionStore.getState().selection }, mutate(draft) { const target = draft.layers[id]; target.name = trimmed; if (target.type === 'panel' && draft.schemaVersion >= 9) target.nameMode = 'custom'; } });
  return result.ok ? ok(undefined) : result;
}
