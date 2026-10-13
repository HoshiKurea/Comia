import type { Id, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { createPage, createPageBackground, mmToPx } from '../domain/factories';
import { DPI, PAGE_AXIS, LIMIT_PAGE_NAME_CODEPOINTS } from '../domain/limits';
import { execute } from '../history/commandBus';
import { getProject } from '../state/documentStore';
import { sessionStore, setSelection, pushNotice } from '../state/sessionStore';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { cancelActiveGesture } from '../interaction/activeGesture';
import { parseManuscript, type ManuscriptSettings } from './manuscript';

export type PaperPreset = 'A4' | 'B4-ISO' | 'custom';
export interface PageSizeInput {
  preset: PaperPreset;
  orientation: 'portrait' | 'landscape';
  widthPx?: number;
  heightPx?: number;
  dpi: number;
  snap16?: boolean;
}

export function resolvePageSize(input: PageSizeInput): Result<{ width: number; height: number; dpi: number }> {
  if (!Number.isInteger(input.dpi) || input.dpi < DPI.min || input.dpi > DPI.max) return fail(problem('page/dpi', 'DPI 必须是 72～600 的整数'));
  if (input.orientation !== 'portrait' && input.orientation !== 'landscape') return fail(problem('page/orientation', '页面方向无效'));
  let width: number;
  let height: number;
  if (input.preset === 'A4' || input.preset === 'B4-ISO') {
    const mm = input.preset === 'A4' ? [210, 297] : [250, 353];
    width = mmToPx(mm[0], input.dpi);
    height = mmToPx(mm[1], input.dpi);
  } else if (input.preset === 'custom') {
    width = input.widthPx ?? NaN;
    height = input.heightPx ?? NaN;
    if (!Number.isInteger(width) || !Number.isInteger(height)) return fail(problem('page/custom-size', '自定义宽高必须是整数像素'));
    if (input.snap16) { width = Math.round(width / 16) * 16; height = Math.round(height / 16) * 16; }
  } else return fail(problem('page/preset', '纸张预设无效'));
  if (input.orientation === 'landscape') [width, height] = [height, width];
  if (width < PAGE_AXIS.min || width > PAGE_AXIS.max || height < PAGE_AXIS.min || height > PAGE_AXIS.max) return fail(problem('page/size', '页面宽高必须在 16～16384 像素之间'));
  return ok({ width, height, dpi: input.dpi });
}

export function addPage(afterId: Id | null, input?: PageSizeInput): Result<Id> {
  const project = getProject();
  const activeId = sessionStore.getState().activePageId || project.pageOrder[0];
  const contextId = project.pages[activeId] ? activeId : project.pageOrder[0];
  if (!project.pages[contextId]) return fail(problem('page/empty-project', '项目没有可用页面'));
  if (afterId !== null && !project.pages[afterId]) return fail(problem('page/after-missing', '插入位置已不存在'));
  const current = project.pages[contextId];
  const size = input ? resolvePageSize(input) : ok({ width: current.width, height: current.height, dpi: current.dpi });
  if (!size.ok) return size;
  const used = new Set(Object.values(project.pages).map((page) => page.name));
  let n = 1;
  while (used.has(`第${n}页`)) n += 1;
  const page = createPage({ name: `第${n}页`, ...size.value });
  if (current.manuscript) {
    const inherited = parseManuscript(current.manuscript, page); if (!inherited.ok) return inherited;
    page.manuscript = inherited.value;
  }
  const background = createPageBackground(page.id); page.roots.push(background.id);
  const paper = current.roots.map(id => project.layers[id]).find(layer => layer.type === 'pageBackground');
  if (paper?.type === 'pageBackground') background.fill = paper.fill;
  const result = execute({
    label: '新建页面', context: { pageId: contextId, selection: sessionStore.getState().selection }, afterSelection: [], afterPageId: page.id,
    mutate(draft) {
      draft.pages[page.id] = page;
      draft.layers[background.id] = background;
      const index = afterId === null ? draft.pageOrder.length : draft.pageOrder.indexOf(afterId) + 1;
      draft.pageOrder.splice(index, 0, page.id);
    },
  });
  if (!result.ok) return result;
  sessionStore.setState({ activePageId: page.id, selection: [], toolMode: 'select' });
  return ok(page.id);
}

export function activatePage(id: Id): void {
  if (!getProject().pages[id]) return;
  const edit = finishActiveTextEdit(); if (!edit.ok) { pushNotice('error', edit.problems[0].message); return; }
  cancelActiveGesture();
  setSelection([]);
  sessionStore.setState({ activePageId: id, toolMode: 'select', cropTarget: null, scopeId: null });
}

export function renamePage(id: Id, name: string): Result<void> {
  const page = getProject().pages[id];
  if (!page) return fail(problem('page/missing', '页面已不存在'));
  if (!name.trim() || [...name].length > LIMIT_PAGE_NAME_CODEPOINTS) return fail(problem('page/name', '页名须为 1～80 码点且不能为空'));
  const result = execute({ label: '重命名页面', context: { pageId: id, selection: sessionStore.getState().selection }, mutate(draft) { draft.pages[id].name = name; } });
  return result.ok ? ok(undefined) : result;
}

export function reorderPages(dragId: Id, beforeId: Id | null): Result<void> {
  const project = getProject();
  if (!project.pages[dragId] || (beforeId !== null && !project.pages[beforeId])) return fail(problem('page/reorder-missing', '拖动页面或插入目标已不存在'));
  if (dragId === beforeId) return ok(undefined);
  const contextId = sessionStore.getState().activePageId || project.pageOrder[0];
  const result = execute({ label: '调整页面顺序', context: { pageId: contextId, selection: sessionStore.getState().selection }, mutate(draft) {
    draft.pageOrder = draft.pageOrder.filter((id) => id !== dragId);
    const index = beforeId === null ? draft.pageOrder.length : draft.pageOrder.indexOf(beforeId);
    draft.pageOrder.splice(index, 0, dragId);
  } });
  return result.ok ? ok(undefined) : result;
}

export function deletePage(id: Id, confirmed: boolean): Result<void> {
  const project = getProject();
  if (!project.pages[id]) return fail(problem('page/missing', '页面已不存在'));
  if (!confirmed) return ok(undefined);
  if (project.pageOrder.length <= 1) return fail(problem('page/last', '至少保留一页'));
  const index = project.pageOrder.indexOf(id);
  const active = sessionStore.getState().activePageId || project.pageOrder[0];
  const next = active === id ? project.pageOrder[index + 1] ?? project.pageOrder[index - 1] : active;
  const result = execute({ label: '删除页面', context: { pageId: active, selection: sessionStore.getState().selection }, afterSelection: [], afterPageId: next, mutate(draft) {
    const remove = (layerId: Id) => {
      const layer = draft.layers[layerId];
      if (!layer) return;
      if ('children' in layer) for (const child of layer.children) remove(child);
      delete draft.layers[layerId];
    };
    for (const root of draft.pages[id].roots) remove(root);
    delete draft.pages[id];
    draft.pageOrder = draft.pageOrder.filter((pageId) => pageId !== id);
  } });
  if (!result.ok) return result;
  activatePage(next);
  return ok(undefined);
}

export function resizePage(id: Id, input: PageSizeInput): Result<void> {
  if (!getProject().pages[id]) return fail(problem('page/missing', '页面已不存在'));
  const size = resolvePageSize(input);
  if (!size.ok) return size;
  const result = execute({ label: '修改页面尺寸', context: { pageId: id, selection: sessionStore.getState().selection }, mutate(draft) {
    Object.assign(draft.pages[id], size.value);
  } });
  return result.ok ? ok(undefined) : result;
}

export function setReadingDirection(direction: 'ltr' | 'rtl'): Result<void> {
  if (direction !== 'ltr' && direction !== 'rtl') return fail(problem('page/reading-direction', '阅读方向无效'));
  const project = getProject();
  const pageId = sessionStore.getState().activePageId || project.pageOrder[0];
  const result = execute({ label: '修改阅读方向', context: { pageId, selection: sessionStore.getState().selection }, mutate(draft) { draft.settings.readingDirection = direction; } });
  return result.ok ? ok(undefined) : result;
}

export function configurePage(id: Id, size: { width: number; height: number; dpi: number }, manuscript: ManuscriptSettings | undefined): Result<void> {
  if (!getProject().pages[id]) return fail(problem('page/missing', '页面已不存在'));
  const dimensions = resolvePageSize({ preset: 'custom', orientation: 'portrait', widthPx: size.width, heightPx: size.height, dpi: size.dpi });
  if (!dimensions.ok) return dimensions;
  const guides = manuscript === undefined ? null : parseManuscript(manuscript, dimensions.value); if (guides && !guides.ok) return guides;
  const result = execute({ label: '修改漫画原稿设置', context: { pageId: id, selection: sessionStore.getState().selection }, mutate(draft) {
    Object.assign(draft.pages[id], dimensions.value);
    if (guides?.ok) draft.pages[id].manuscript = guides.value; else delete draft.pages[id].manuscript;
  } });
  return result.ok ? ok(undefined) : result;
}
