import type { Id, Layer, Mat, PanelLayer, PanelTemplateNode, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { createLayer } from '../domain/factories';
import { apply, multiply, worldMatrix } from '../geometry/matrix';
import { polyBounds } from '../geometry/polygon';
import { sortPanelReadingOrder } from './readingOrder';

export function firstReadingPanel(project: Project, panels: PanelLayer[]): Result<Id> {
  const order = sortPanelReadingOrder(panels.map((panel, paintIndex) => {
    const matrix = panel.parentId ? multiply(worldMatrix(project, panel.parentId), panel.matrix) : panel.matrix;
    return { id: panel.id, paintIndex, bounds: polyBounds(panel.geometry.map(point => apply(matrix, point))) };
  }), project.settings.readingDirection);
  return order.ok && order.value.length ? ok(order.value[0]) : order.ok ? fail(problem('panel/layout-empty', '没有可选分镜')) : order;
}

/** Thumbnails and both drag previews use exactly the same independent topology as deployment. */
export function componentSceneDraft(layer: Layer, descendants: Layer[], independentRoots = false): Result<{ roots: Id[]; layers: Layer[] }> {
  if (independentRoots && layer.type === 'group') {
    const rootSet = new Set(layer.children);
    return ok({ roots: [...layer.children], layers: descendants.map(item => rootSet.has(item.id) ? { ...item, parentId: layer.parentId, matrix: multiply(layer.matrix, item.matrix) } : item) });
  }
  if (layer.type !== 'panel' || layer.role !== 'split') return ok({ roots: [layer.id], layers: [layer, ...descendants] });
  const flat = independentPanelDraft(layer, descendants, layer.parentId);
  return flat.ok ? ok({ roots: flat.value.panels.map(panel => panel.id), layers: [...flat.value.panels, ...flat.value.contents] }) : flat;
}
export function instantiatePanelTree(node: PanelTemplateNode, pageId: Id, preview = false): { layer: PanelLayer; descendants: PanelLayer[]; defaultNamedPanelIds: Id[] } {
  const descendants: PanelLayer[] = [], defaultNamedPanelIds: Id[] = [];
  const visit = (n: PanelTemplateNode, parentId: Id | null): PanelLayer => {
    const layer = createLayer('panel', pageId, preview ? '预览分格' : undefined) as PanelLayer;
    layer.parentId = parentId; layer.geometry = structuredClone(n.geometry); if (n.geometryMode) layer.geometryMode = n.geometryMode;
    if (n.randomSeed !== undefined) layer.randomSeed = n.randomSeed;
    layer.style = { ...n.style }; layer.role = n.children.length ? 'split' : 'leaf';
    if (layer.role === 'leaf') defaultNamedPanelIds.push(layer.id);
    layer.children = n.children.map(child => { const made = visit(child, layer.id); descendants.push(made); return made.id; }); return layer;
  };
  return { layer: visit(node, null), descendants, defaultNamedPanelIds };
}

/** A component may use a tree for its ghost. Only leaves enter the document. */
export function independentPanelDraft(root: PanelLayer, descendants: Layer[], parentId: Id | null): Result<{ panels: PanelLayer[]; contents: Layer[] }> {
  const byId = new Map([root, ...descendants].map(layer => [layer.id, layer])), visited = new Set<Id>();
  const panels: PanelLayer[] = [], contents: Layer[] = [];
  const visit = (panel: PanelLayer, matrix: Mat, visible: boolean, depth: number) => {
    if (depth > 16 || visited.has(panel.id)) throw Error('invalid tree'); visited.add(panel.id);
    if (panel.role === 'split') {
      for (const id of panel.children) { const child = byId.get(id); if (child?.type !== 'panel') throw Error('missing panel'); visit(child, multiply(matrix, child.matrix), visible && child.visible, depth + 1); }
    } else {
      panels.push({ ...panel, parentId, matrix, visible });
      for (const id of panel.children) { const image = byId.get(id); if (image?.type !== 'image' || image.parentId !== panel.id || visited.has(id)) throw Error('invalid image'); visited.add(id); contents.push(image); }
    }
  };
  try { visit(root, [...root.matrix], root.visible, 1); } catch { return fail(problem('panel/layout-tree', '组件分格树无效，未创建分镜')); }
  return panels.length && visited.size === byId.size ? ok({ panels, contents }) : fail(problem('panel/layout-empty', '组件没有完整可创建的分镜'));
}
