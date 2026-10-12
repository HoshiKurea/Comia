import type { Id, ImageLayer, Layer, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { apply, inverse, multiply, worldMatrix } from '../geometry/matrix';
import { buildRoundedPolygon } from '../geometry/roundedPolygon';
import { polygonRegion, pathPolygon, ellipseRegion, intersectRegions, regionArea, type Region } from '../geometry/pathRegion';
import { polyBounds } from '../geometry/polygon';
import { rectangle } from '../panels/presets';
import { pointInsidePanelClips } from '../render/drawScene';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { getProject } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { execute } from '../history/commandBus';
import { LIMITS } from '../domain/limits';
import { freeImage } from './freeImage';

export interface PanelCandidate { panelId: Id; overlap: number; paintIndex: number }
function paintOrder(project: Project, pageId: Id): Id[] {
  const order: Id[] = [], visit = (id: Id) => { const layer = project.layers[id]; if (!layer) return; order.push(id); if ('children' in layer) layer.children.forEach(visit); };
  project.pages[pageId]?.roots.forEach(visit); return order;
}
export function panelAtPoint(project: Project, pageId: Id, point: { x: number; y: number }): Id | null {
  for (const id of paintOrder(project, pageId).reverse()) { const p = project.layers[id]; if (p.type === 'panel' && p.role === 'leaf' && pointInsidePanelClips(project, id, point)) return id; } return null;
}
function paper(project: Project, pageId: Id) { const p = project.pages[pageId]; return polygonRegion(rectangle({ x: 0, y: 0, width: p.width, height: p.height })); }
const regionCache = new WeakMap<Layer, { ancestors: Layer[]; width: number; height: number; region: Region }>();
export function panelRegion(project: Project, id: Id): Region {
  const p = project.layers[id]; if (!p) return [];
  const ancestors: Layer[] = []; for (let l: Layer | undefined = p; l; l = l.parentId ? project.layers[l.parentId] : undefined) ancestors.push(l);
  const page = project.pages[p.pageId], cached = regionCache.get(p);
  if (cached && cached.width === page.width && cached.height === page.height && cached.ancestors.length === ancestors.length && ancestors.every((a, i) => cached.ancestors[i] === a)) return cached.region;
  const regions = [paper(project, p.pageId)];
  for (let l: Layer | undefined = p; l; l = l.parentId ? project.layers[l.parentId] : undefined) if (l.type === 'panel') regions.push(pathPolygon(buildRoundedPolygon(l.geometry, l.style.borderRadius), worldMatrix(project, l.id)));
  const region = intersectRegions(...regions); regionCache.set(p, { ancestors, width: page.width, height: page.height, region }); return region;
}
export function imageFootprint(project: Project, id: Id): Region {
  const source = project.layers[id]; if (source?.type !== 'image') return [];
  const image = freeImage(project, id), parent = source.parentId ? worldMatrix(project, source.parentId) : [1,0,0,1,0,0] as const, world = multiply(parent, image.matrix);
  const regions = [paper(project, image.pageId), polygonRegion(rectangle({ x: 0, y: 0, width: image.width, height: image.height }).map(p => apply(world, p)))];
  if (image.mask?.enabled) {
    const mask = image.mask, m = multiply(world, mask.matrix), b = polyBounds(mask.geometry);
    regions.push(mask.shape === 'ellipse' ? ellipseRegion(b.x + b.width / 2, b.y + b.height / 2, b.width / 2, b.height / 2, m) : polygonRegion(mask.geometry.map(p => apply(m, p))));
  }
  return intersectRegions(...regions);
}
export function rankPanelOverlaps(project: Project, imageId: Id): PanelCandidate[] {
  const image = project.layers[imageId]; if (image?.type !== 'image') return [];
  const footprint = imageFootprint(project, imageId), area = regionArea(footprint); if (area <= 1e-6) return [];
  const bounds = polyBounds(footprint.flatMap(poly => poly.flatMap(ring => ring.map(([x,y]) => ({ x,y })))));
  const result: PanelCandidate[] = [];
  for (const [paintIndex, id] of paintOrder(project, image.pageId).entries()) {
    const p = project.layers[id], flags = effectiveLayerFlags(project, id);
    if (p.type !== 'panel' || p.role !== 'leaf' || image.parentId === id || !flags.visible || flags.locked) continue;
    const m = worldMatrix(project, id), box = polyBounds(p.geometry.map(point => apply(m, point)));
    if (box.x + box.width < bounds.x || bounds.x + bounds.width < box.x || box.y + box.height < bounds.y || bounds.y + bounds.height < box.y) continue;
    const region = panelRegion(project, id), targetArea = regionArea(region); if (targetArea <= 1e-6) continue;
    const score = Math.max(0, Math.min(1, regionArea(intersectRegions(footprint, region)) / Math.min(area, targetArea)));
    if (score >= .5 - 1e-10) result.push({ panelId: id, overlap: score, paintIndex });
  }
  return result.sort((a, b) => b.overlap - a.overlap || b.paintIndex - a.paintIndex || a.panelId.localeCompare(b.panelId, 'en'));
}
function checked(project: Project, ids: readonly Id[], panelId?: Id): Result<Id[]> {
  const selected = [...new Set(ids)], first = project.layers[selected[0]];
  if (!selected.length || first?.type !== 'image' || selected.some(id => project.layers[id]?.type !== 'image' || project.layers[id].pageId !== first.pageId)) return fail(problem('image/bind-selection', '请选择同页的图片素材'));
  const panel = panelId ? project.layers[panelId] : null;
  if (panelId && (panel?.type !== 'panel' || panel.role !== 'leaf' || panel.pageId !== first.pageId)) return fail(problem('image/bind-target', '请选择同页的一个叶子分镜'));
  for (const id of panelId ? [...selected, panelId] : selected) { const flags = effectiveLayerFlags(project, id); if (!flags.visible || flags.locked) return fail(problem('image/bind-locked', '图片或目标分镜隐藏/锁定，关联未执行')); }
  let depth = 1; for (let p = panelId; p; p = project.layers[p]?.parentId ?? undefined) depth++;
  if (depth > LIMITS.maxDepth) return fail(problem('image/bind-depth', '关联后图层超过16层'));
  return ok(selected);
}
function detachFromTree(draft: Project, id: Id) { const l = draft.layers[id], parent = l.parentId ? draft.layers[l.parentId] : null; if (parent && 'children' in parent) parent.children = parent.children.filter(c => c !== id); else draft.pages[l.pageId].roots = draft.pages[l.pageId].roots.filter(c => c !== id); }
/** This pure helper also lets drag placement and association commit together. */
export function bindImagesDraft(draft: Project, ids: readonly Id[], panelId: Id): Result<void> {
  const valid = checked(draft, ids, panelId); if (!valid.ok) return valid;
  const inv = inverse(worldMatrix(draft, panelId)); if (!inv.ok) return inv;
  const ordered = paintOrder(draft, draft.layers[panelId].pageId).filter(id => valid.value.includes(id));
  for (const id of ordered) {
    const original = draft.layers[id] as ImageLayer; if (original.parentId === panelId && !original.crop) continue;
    const source = freeImage(draft, id), world = source.parentId ? multiply(worldMatrix(draft, source.parentId), source.matrix) : source.matrix;
    detachFromTree(draft, id); draft.layers[id] = { ...source, parentId: panelId, matrix: multiply(inv.value, world) };
    const panel = draft.layers[panelId]; if (panel.type !== 'panel') throw Error('目标分镜失效'); panel.children.push(id);
  }
  return ok(undefined);
}
function selectAfterBinding(panelId: Id) {
  const scope = sessionStore.getState().scopeId; if (!scope) return;
  let found = false; for (let p: Id | null = panelId; p; p = getProject().layers[p].parentId) if (p === scope) found = true;
  if (!found) sessionStore.setState({ scopeId: null });
}
export function bindImagesToPanel(ids: readonly Id[], panelId: Id): Result<void> {
  const project = getProject(), valid = checked(project, ids, panelId); if (!valid.ok) return valid;
  const result = execute({ label: '关联素材到分镜', context: { pageId: project.layers[panelId].pageId, selection: sessionStore.getState().selection }, afterSelection: valid.value, mutate(draft) { const r = bindImagesDraft(draft, valid.value, panelId); if (!r.ok) throw Error(r.problems[0].message); } });
  if (!result.ok) return result; selectAfterBinding(panelId); return ok(undefined);
}
export function unbindPanelImages(ids: readonly Id[]): Result<void> {
  const project = getProject(), valid = checked(project, ids); if (!valid.ok) return valid;
  if (valid.value.some(id => !project.layers[id].parentId || project.layers[project.layers[id].parentId!]?.type !== 'panel')) return fail(problem('image/unbind-target', '所选素材须已关联分镜'));
  const ordered = paintOrder(project, project.layers[valid.value[0]].pageId).filter(id => valid.value.includes(id));
  const result = execute({ label: '解除素材分镜关联', context: { pageId: project.layers[ordered[0]].pageId, selection: sessionStore.getState().selection }, afterSelection: ordered, mutate(draft) {
    const insertions = new Map<Id, number>();
    for (const id of ordered) {
      const source = freeImage(draft, id), world = multiply(worldMatrix(draft, source.parentId!), source.matrix);
      let anchor = draft.layers[source.parentId!]; while (anchor.parentId && draft.layers[anchor.parentId]?.type === 'panel') anchor = draft.layers[anchor.parentId];
      const parent = anchor.parentId ? draft.layers[anchor.parentId] : null, inv = inverse(parent ? worldMatrix(draft, parent.id) : [1,0,0,1,0,0]); if (!inv.ok) throw Error(inv.problems[0].message);
      detachFromTree(draft, id); draft.layers[id] = { ...source, parentId: parent?.id ?? null, matrix: multiply(inv.value, world) };
      const list = parent?.type === 'group' ? parent.children : draft.pages[source.pageId].roots, offset = insertions.get(anchor.id) ?? 0;
      list.splice(list.indexOf(anchor.id) + 1 + offset, 0, id); insertions.set(anchor.id, offset + 1);
    }
  } }); return result.ok ? ok(undefined) : result;
}
export function associationSelection(): Result<{ panelId: Id; imageIds: Id[] }> {
  const p = getProject(), selection = sessionStore.getState().selection, images = selection.filter(id => p.layers[id]?.type === 'image'), panels = selection.filter(id => p.layers[id]?.type === 'panel');
  if (panels.length === 1 && images.length && selection.length === panels.length + images.length) return ok({ panelId: panels[0], imageIds: images });
  if (selection.length === 1 && images.length === 1) { const candidate = rankPanelOverlaps(p, images[0])[0]; if (candidate) return ok({ panelId: candidate.panelId, imageIds: images }); }
  return fail(problem('image/bind-selection', panels.length > 1 ? '请选择一个目标分镜' : '选择图片与一个分镜，或把单张图片移动到与分镜重叠的位置'));
}
export function bindSelectedImages(): Result<void> { const selected = associationSelection(); return selected.ok ? bindImagesToPanel(selected.value.imageIds, selected.value.panelId) : selected; }
export function bindingDisabledReason(imageIds?: readonly Id[], panelId?: Id): string | null {
  if (imageIds && panelId) { const valid = checked(getProject(), imageIds, panelId); return valid.ok ? null : valid.problems[0].message; }
  const r = associationSelection(); if (!r.ok) return r.problems[0].message; const valid = checked(getProject(), r.value.imageIds, r.value.panelId); return valid.ok ? null : valid.problems[0].message;
}
export function unbindingDisabledReason(): string | null {
  const p = getProject(), ids = sessionStore.getState().selection, valid = checked(p, ids); if (!valid.ok) return valid.problems[0].message;
  return ids.every(id => p.layers[id].parentId && p.layers[p.layers[id].parentId!]?.type === 'panel') ? null : '请选择已关联分镜的素材';
}
