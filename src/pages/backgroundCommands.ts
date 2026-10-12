import type { Id, PageBackgroundLayer, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { createPageBackground } from '../domain/factories';
import { execute } from '../history/commandBus';
import { getProject } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { cancelActiveGesture } from '../interaction/activeGesture';
import { backgroundTemplates, type BackgroundTemplateId } from './backgroundTemplates';
import { validateBackgroundValues, validateBackgroundBudget, type BackgroundValues } from './backgroundGeometry';

export function addPageBackground(pageId: Id): Result<Id> {
  cancelActiveGesture(); const project = getProject(), page = project.pages[pageId];
  if (!page) return fail(problem('background/page', '页面不存在'));
  if (page.roots.some(id => project.layers[id].type === 'pageBackground')) return fail(problem('background/duplicate', '页面已有背景，请选择背景编辑'));
  const background = createPageBackground(pageId);
  const result = execute({ label: '添加页面背景', context: { pageId, selection: sessionStore.getState().selection }, afterSelection: [background.id], mutate(draft) { draft.layers[background.id] = background; draft.pages[pageId].roots.unshift(background.id); } });
  return result.ok ? ok(background.id) : result;
}
export function backgroundTarget(id: Id): Result<PageBackgroundLayer> {
  const layer = getProject().layers[id];
  if (layer?.type !== 'pageBackground') return fail(problem('background/target', '请选择页面背景'));
  if (layer.locked) return fail(problem('background/locked', '页面背景已锁定，请先解锁'));
  return ok(layer);
}
export function updatePageBackground(id: Id, values: BackgroundValues): Result<void> {
  cancelActiveGesture(); const target = backgroundTarget(id); if (!target.ok) return target;
  const checked = validateBackgroundValues(values); if (!checked.ok) return checked;
  const page = getProject().pages[target.value.pageId], budget = validateBackgroundBudget(page.width, page.height, checked.value.watermark); if (!budget.ok) return budget;
  const result = execute({ label: '修改页面背景', context: { pageId: target.value.pageId, selection: sessionStore.getState().selection }, mutate(draft) { Object.assign(draft.layers[id], checked.value); } });
  return result.ok ? ok(undefined) : result;
}
export function applyBackgroundTemplate(id: Id, template: BackgroundTemplateId): Result<void> {
  const entry = backgroundTemplates.find(item => item.id === template);
  return entry ? updatePageBackground(id, entry.values) : fail(problem('background/template', '背景模板不存在'));
}
