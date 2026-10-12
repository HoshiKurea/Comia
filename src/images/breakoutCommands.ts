import type { BreakoutRegion, Id, ImageLayer, PanelClipPolicy, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { getProject } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { execute } from '../history/commandBus';
import { freeImage } from './freeImage';
import { defaultMask, validateMaskGeometry } from './maskGeometry';
import { validateTransform } from '../domain/validate';

export function defaultBreakoutRegion(image: ImageLayer, shape: BreakoutRegion['shape'] = 'rect'): BreakoutRegion {
  const mask = defaultMask(image, shape); return { shape: mask.shape, geometry: mask.geometry, matrix: mask.matrix };
}
export function validateBreakoutRegion(region: BreakoutRegion): Result<void> { const matrix = validateTransform(region.matrix); return matrix.ok ? validateMaskGeometry({ ...region, enabled: true, linked: true }) : matrix; }
export function setPanelClipMode(ids: readonly Id[], mode: PanelClipPolicy['mode']): Result<void> {
  const p = getProject(), selected = [...new Set(ids)], first = p.layers[selected[0]];
  if (p.schemaVersion < 5 || !selected.length || first?.type !== 'image' || (mode === 'partial' && selected.length !== 1) || !['normal','whole','partial'].includes(mode)) return fail(problem('breakout/selection', '请选择格式5及以上中关联分镜的素材；局部破格一次编辑一张'));
  for (const id of selected) {
    const image = p.layers[id], panel = image?.parentId ? p.layers[image.parentId] : null, flags = effectiveLayerFlags(p, id);
    if (image?.type !== 'image' || image.pageId !== first.pageId || panel?.type !== 'panel' || panel.role !== 'leaf' || flags.locked || !flags.visible) return fail(problem('breakout/locked', '请选择同页可见、未锁定且关联分镜的图片'));
  }
  const result = execute({ label: mode === 'normal' ? '关闭破格' : mode === 'whole' ? '整图破格' : '局部破格', context: { pageId: first.pageId, selection: sessionStore.getState().selection }, afterSelection: selected, mutate(draft) {
    for (const id of selected) {
      const image = freeImage(draft, id), region = image.panelClip?.region;
      image.panelClip = mode === 'partial' ? { mode, region: region ?? defaultBreakoutRegion(image) } : { mode, ...(region ? { region } : {}) }; draft.layers[id] = image;
    }
  } }); return result.ok ? ok(undefined) : result;
}
export function setBreakoutRegion(id: Id, region: BreakoutRegion): Result<void> {
  const p = getProject(), image = p.layers[id], flags = effectiveLayerFlags(p, id), valid = validateBreakoutRegion(region);
  if (!valid.ok) return valid;
  if (image?.type !== 'image' || p.schemaVersion < 5 || flags.locked || !flags.visible || !image.parentId || p.layers[image.parentId]?.type !== 'panel') return fail(problem('breakout/target', '请选择可编辑的分镜素材'));
  const result = execute({ label: '修改局部破格区域', context: { pageId: image.pageId, selection: sessionStore.getState().selection }, mutate(draft) { const target = freeImage(draft, id); target.panelClip = { mode: 'partial', region: structuredClone(region) }; draft.layers[id] = target; } }); return result.ok ? ok(undefined) : result;
}
export function breakoutSplitGuard(project: Project, id: Id): Result<void> {
  const layer = project.layers[id]; if (!layer) return fail(problem('panel/missing', '分镜不存在'));
  if (layer.type === 'image' && layer.panelClip && layer.panelClip.mode !== 'normal') return fail(problem('panel/breakout-split', '请先解除破格素材关联，或改为普通素材后再分格'));
  if ('children' in layer) for (const child of layer.children) { const checked = breakoutSplitGuard(project, child); if (!checked.ok) return checked; }
  return ok(undefined);
}
