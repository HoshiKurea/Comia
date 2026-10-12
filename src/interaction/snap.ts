import type { Id, Point, Project, Rect } from '../domain/types';
import { unionBounds } from '../geometry/bounds';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { layerWorldBounds } from './layerBounds';

export interface SnapCandidate { axis: 'x' | 'y'; value: number; sourceId: Id | null; kind: 'edge' | 'center'; bounds: Rect }
export interface SnapLock { candidate: SnapCandidate; feature: number }
export interface SnapResult { delta: Point; guides: SnapCandidate[]; locks: Partial<Record<'x' | 'y', SnapLock>> }
export interface MoveSnap { bounds: Rect; candidates: SnapCandidate[]; locks: SnapResult['locks']; guides: SnapCandidate[] }
const features = (box: Rect, axis: 'x' | 'y') => axis === 'x' ? [box.x, box.x + box.width / 2, box.x + box.width] : [box.y, box.y + box.height / 2, box.y + box.height];
function priority(candidate: SnapCandidate): number { return candidate.sourceId === null && candidate.kind === 'edge' ? 0 : candidate.kind === 'center' ? 1 : 2; }
function before(a: SnapLock, b: SnapLock): boolean {
  const rank = priority(a.candidate) - priority(b.candidate); if (rank) return rank < 0;
  const id = (a.candidate.sourceId ?? '').localeCompare(b.candidate.sourceId ?? '', 'en');
  return id < 0 || (!id && (a.candidate.value < b.candidate.value || (a.candidate.value === b.candidate.value && a.feature < b.feature)));
}
/** Frozen page-space candidates; selected descendants and ancestors containing them cannot attract themselves. */
export function collectMoveSnap(project: Project, pageId: Id, ids: Id[]): MoveSnap | null {
  const bounds = unionBounds(ids.map((id) => layerWorldBounds(project, id)).filter((box): box is Rect => box !== null));
  const page = project.pages[pageId]; if (!bounds || !page) return null;
  const excluded = new Set(ids);
  const visit = (id: Id) => { excluded.add(id); const layer = project.layers[id]; if (layer && 'children' in layer) layer.children.forEach(visit); };
  ids.forEach(visit);
  for (const id of ids) for (let parent = project.layers[id]?.parentId; parent; parent = project.layers[parent]?.parentId ?? null) excluded.add(parent);
  const candidates: SnapCandidate[] = [];
  const add = (sourceId: Id | null, box: Rect) => { for (const axis of ['x', 'y'] as const) features(box, axis).forEach((value, index) => candidates.push({ axis, value, sourceId, kind: index === 1 ? 'center' : 'edge', bounds: box })); };
  add(null, { x: 0, y: 0, width: page.width, height: page.height });
  for (const layer of Object.values(project.layers)) {
    if (layer.pageId !== pageId || excluded.has(layer.id) || !effectiveLayerFlags(project, layer.id).visible) continue;
    // Owned content is clipped by the container, which already supplies its visible reference boundary.
    const parent = layer.parentId ? project.layers[layer.parentId] : null;
    if (parent?.type === 'bubble' || (parent?.type === 'panel' && layer.type === 'image')) continue;
    const box = layerWorldBounds(project, layer.id); if (box) add(layer.id, box);
  }
  return { bounds, candidates, locks: {}, guides: [] };
}
export function snapMove(bounds: Rect, delta: Point, candidates: SnapCandidate[], zoom: number, previous: SnapResult['locks'] = {}): SnapResult {
  const result: SnapResult = { delta: { ...delta }, guides: [], locks: {} };
  if (!(zoom > 0) || !Number.isFinite(zoom)) return result;
  for (const axis of ['x', 'y'] as const) {
    const values = features(bounds, axis), prior = previous[axis];
    let best: SnapLock | undefined, correction = Infinity;
    if (prior) {
      const distance = prior.candidate.value - (values[prior.feature] + delta[axis]);
      if (Math.abs(distance) <= 9 / zoom) { best = prior; correction = distance; }
    }
    if (!best) for (const candidate of candidates) {
      if (candidate.axis !== axis) continue;
      for (let feature = 0; feature < values.length; feature++) {
        const distance = candidate.value - (values[feature] + delta[axis]), lock = { candidate, feature };
        if (Math.abs(distance) > 6 / zoom) continue;
        if (!best || Math.abs(distance) < Math.abs(correction) - 1e-9 || (Math.abs(Math.abs(distance) - Math.abs(correction)) <= 1e-9 && before(lock, best))) { best = lock; correction = distance; }
      }
    }
    if (best) { result.delta[axis] += correction; result.guides.push(best.candidate); result.locks[axis] = best; }
  }
  return result;
}
