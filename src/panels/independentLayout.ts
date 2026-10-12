import { breakoutSplitGuard } from '../images/breakoutCommands';
import { clonePanelImage } from '../images/freeImage';
import type { Id, ImageLayer, Mat, PanelLayer, PanelTemplateNode, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { createLayer } from '../domain/factories';
import { execute } from '../history/commandBus';
import { getProject } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { hasLockedDescendant } from '../layers/group';
import { inverse, multiply, worldMatrix } from '../geometry/matrix';
import { polygonContained } from '../geometry/simplePolygon';
import { cancelActiveGesture } from '../interaction/activeGesture';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { LIMITS } from '../domain/limits';
import { firstReadingPanel } from './instantiate';

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];
function destination(project: Project, target: PanelLayer) {
  let anchor = target;
  while (anchor.parentId && project.layers[anchor.parentId]?.type === 'panel') anchor = project.layers[anchor.parentId] as PanelLayer;
  const parentId = anchor.parentId, parent = parentId ? project.layers[parentId] : null;
  const siblings = parent?.type === 'group' ? parent.children : project.pages[target.pageId].roots;
  return { parentId, anchorId: anchor.id, index: siblings.indexOf(anchor.id) + Number(anchor.id !== target.id) };
}
function siblings(project: Project, pageId: Id, parentId: Id | null): Id[] {
  const parent = parentId ? project.layers[parentId] : null;
  return parent?.type === 'group' || parent?.type === 'panel' ? parent.children : project.pages[pageId].roots;
}
function visibleTo(project: Project, id: Id, until: Id | null): boolean {
  for (let layer = project.layers[id]; layer && layer.id !== until; layer = layer.parentId ? project.layers[layer.parentId] : undefined!) if (!layer.visible) return false;
  return true;
}

/** Layout trees are only generation plans. Persist their leaves as independent siblings. */
export function applyIndependentLayout(pageId: Id, tree: PanelTemplateNode, targetId: Id | null = null): Result<Id[]> {
  const text = finishActiveTextEdit(); if (!text.ok) return text; cancelActiveGesture();
  const project = getProject(), target = targetId ? project.layers[targetId] : null;
  if (!project.pages[pageId]) return fail(problem('panel/layout-page', '页面不存在'));
  if (targetId && (target?.type !== 'panel' || target.role !== 'leaf' || target.pageId !== pageId)) return fail(problem('panel/layout-target', '请选择同页的叶子分镜'));
  if (target && (effectiveLayerFlags(project, target.id).locked || hasLockedDescendant(project, target.id))) return fail(problem('panel/layout-locked', '目标或图片已锁定'));
  if (target) { const breakout = breakoutSplitGuard(project, target.id); if (!breakout.ok) return breakout; }
  if (target?.type === 'panel' && !polygonContained(target.geometry, tree.geometry)) return fail(problem('panel/layout-outside', '布局超出目标分镜'));
  const slot = target?.type === 'panel' ? destination(project, target) : { parentId: null, anchorId: null, index: project.pages[pageId].roots.length };
  const inv = inverse(slot.parentId ? worldMatrix(project, slot.parentId) : IDENTITY); if (!inv.ok) return inv;
  const matrix = target ? multiply(inv.value, worldMatrix(project, target.id)) : [...IDENTITY] as Mat;
  const panels: PanelLayer[] = [], images: ImageLayer[] = [];
  const visit = (node: PanelTemplateNode) => {
    if (node.children.length) { node.children.forEach(visit); return; }
    const layer = createLayer('panel', pageId) as PanelLayer;
    layer.parentId = slot.parentId; layer.matrix = [...matrix]; layer.geometry = structuredClone(node.geometry); layer.style = { ...node.style };
    if (node.geometryMode) layer.geometryMode = node.geometryMode;
    if (tree.randomSeed !== undefined) layer.randomSeed = tree.randomSeed;
    if (target) layer.visible = visibleTo(project, target.id, slot.parentId);
    panels.push(layer);
  };
  visit(tree); if (!panels.length) return fail(problem('panel/layout-empty', '没有可生成的分镜'));
  const layerCount = Object.values(project.layers).filter(layer => layer.type !== 'pageBackground').length;
  const removed = target?.type === 'panel' ? 1 + target.children.length : 0;
  const imageCount = target?.type === 'panel' ? panels.length * target.children.length : 0;
  if (layerCount - removed + panels.length + imageCount > LIMITS.maxLayers) return fail(problem('panel/layout-count', '分格结果超过5000图层'));
  try {
    if (target?.type === 'panel') for (const panel of panels) for (const sourceId of target.children) {
      const source = project.layers[sourceId]; if (source?.type !== 'image') throw Error('invalid source image');
      const image = clonePanelImage(source, target, panel);
      panel.children.push(image.id); images.push(image);
    }
  } catch { return fail(problem('panel/layout-image', '无法保留原图片映射，未应用分格')); }
  const ids = panels.map(p => p.id);
  const first = firstReadingPanel(project, panels); if (!first.ok) return first;
  const result = execute({ label: '生成独立分镜', defaultNamedPanelIds: ids, ...(target ? { panelReplacement: { sourceId: target.id, newIds: ids } } : {}), context: { pageId, selection: sessionStore.getState().selection }, afterSelection: [first.value], mutate(draft) {
    if (target?.type === 'panel') {
      const list = siblings(draft, pageId, target.parentId); list.splice(list.indexOf(target.id), 1);
      for (const id of target.children) delete draft.layers[id]; delete draft.layers[target.id];
    }
    for (const layer of [...panels, ...images]) draft.layers[layer.id] = layer;
    siblings(draft, pageId, slot.parentId).splice(slot.index, 0, ...ids);
  } });
  return result.ok ? ok(ids) : result;
}

/** Explicitly remove split parents/clips while retaining each leaf's page transform and image crop. */
export function separatePanelLayout(id: Id): Result<Id[]> {
  const text = finishActiveTextEdit(); if (!text.ok) return text; cancelActiveGesture();
  const project = getProject(), target = project.layers[id];
  if (target?.type !== 'panel' || target.role !== 'split') return fail(problem('panel/separate-target', '请选择分格父框'));
  if (effectiveLayerFlags(project, id).locked || hasLockedDescendant(project, id)) return fail(problem('panel/separate-locked', '分格或后代已锁定'));
  const slot = destination(project, target), inv = inverse(slot.parentId ? worldMatrix(project, slot.parentId) : IDENTITY); if (!inv.ok) return inv;
  const containers: Id[] = [], leaves: PanelLayer[] = [];
  const visit = (panel: PanelLayer) => {
    if (panel.role === 'leaf') { leaves.push({ ...panel, parentId: slot.parentId, matrix: multiply(inv.value, worldMatrix(project, panel.id)), visible: visibleTo(project, panel.id, slot.parentId) }); return; }
    containers.push(panel.id); for (const child of panel.children) { const layer = project.layers[child]; if (layer?.type === 'panel') visit(layer); }
  }; visit(target);
  if (!leaves.length) return fail(problem('panel/separate-empty', '父框内没有分镜'));
  const ids = leaves.map(l => l.id);
  const result = execute({ label: '拆为独立分镜', context: { pageId: target.pageId, selection: [id] }, afterSelection: ids.slice(0, 1), mutate(draft) {
    const old = siblings(draft, target.pageId, target.parentId); old.splice(old.indexOf(id), 1);
    for (const container of containers) delete draft.layers[container];
    for (const leaf of leaves) draft.layers[leaf.id] = leaf;
    siblings(draft, target.pageId, slot.parentId).splice(slot.index, 0, ...ids);
  } }); return result.ok ? ok(ids) : result;
}
