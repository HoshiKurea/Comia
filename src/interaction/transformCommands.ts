import type { Id, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { getProject } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { hasLockedDescendant } from '../layers/group';
import { execute } from '../history/commandBus';
import { localLayerBounds } from './layerBounds';
import { quantize16, resizeProject } from './resize';
import { matrixAtAngle } from './rotate';
import { decompose } from '../geometry/matrix';
import { finishActiveTextEdit } from '../text/editLifecycle';

export function transformDimensions(id: Id, project: Project = getProject()): { width: number; height: number } | null {
  const layer = project.layers[id], box = layer?.type==='text'?layer.box:localLayerBounds(project, id); if (!box) return null;
  const scale = layer?.type === 'image' || layer?.type === 'group' || layer?.type==='decoration'&&(layer.spec.kind==='shape'||layer.spec.kind==='paint'||layer.spec.kind==='background-fill') ? decompose(layer.matrix) : { sx: 1, sy: 1 };
  return { width: box.width * scale.sx, height: box.height * scale.sy };
}
export function setDimensions(id: Id, width?: number, height?: number): Result<void> {
  const edit = finishActiveTextEdit(); if (!edit.ok) return edit;
  const project = getProject(), layer = project.layers[id], box = layer?.type==='text'?layer.box:localLayerBounds(project, id), size = transformDimensions(id);
  if (!layer || !box || !size) return fail(problem('transform/empty', '对象无可用尺寸'));
  if (layer.type === 'pageBackground') return fail(problem('background/transform', '页面背景尺寸跟随纸张，请使用页面设置'));
  if (effectiveLayerFlags(project, id).locked || hasLockedDescendant(project, id)) return fail(problem('transform/locked', `图层“${layer.name}”或子层已锁定，不能改变尺寸`));
  let nextW = width ?? size.width, nextH = height ?? size.height;
  if (![nextW, nextH].every(Number.isFinite) || nextW < 16 || nextH < 16 || nextW > 16384 || nextH > 16384) return fail(problem('transform/range', '宽高必须在16～16384像素之间'));
  if (sessionStore.getState().snap16) { if (width !== undefined) nextW = quantize16(nextW); if (height !== undefined) nextH = quantize16(nextH); }
  if (layer.type === 'bubble' && layer.shape === 'circle') { const diameter = width !== undefined ? nextW : nextH; nextW = nextH = diameter; }
  const preview = resizeProject(project, id, { x: box.x, y: box.y, width: box.width * nextW / size.width, height: box.height * nextH / size.height });
  if (!preview.ok) return preview;
  const result = execute({ label: '修改局部尺寸', context: { pageId: layer.pageId, selection: sessionStore.getState().selection }, mutate(draft) { for (const [key, value] of Object.entries(preview.value.layers)) if (value !== project.layers[key]) draft.layers[key] = value; } });
  return result.ok ? ok(undefined) : result;
}
export function setRotation(id: Id, degrees: number): Result<void> {
  const edit = finishActiveTextEdit(); if (!edit.ok) return edit;
  const project = getProject(), layer = project.layers[id];
  if (!layer) return fail(problem('transform/missing', '对象已不存在'));
  if (layer.type === 'pageBackground') return fail(problem('background/transform', '页面背景不能旋转，可调整水印角度'));
  if (effectiveLayerFlags(project, id).locked || hasLockedDescendant(project, id)) return fail(problem('transform/locked', `图层“${layer.name}”或子层已锁定，不能旋转`));
  const matrix = matrixAtAngle(project, id, degrees); if (!matrix.ok) return matrix;
  const result = execute({ label: '修改旋转角度', context: { pageId: layer.pageId, selection: sessionStore.getState().selection }, mutate(draft) { draft.layers[id].matrix = matrix.value; } });
  return result.ok ? ok(undefined) : result;
}
