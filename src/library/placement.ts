import type { Id, Layer, Point, Project, Rect, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { polyBounds } from '../geometry/polygon';
import { getProject } from '../state/documentStore';
import { createObjectDraft, placeObjectDraft, type CreateKind, type ObjectDraft } from '../app/actions';
import { apply, inverse, worldMatrix } from '../geometry/matrix';
import { sessionStore } from '../state/sessionStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { resetCounters, syncCounters } from '../domain/factories';
import { cancelActiveGesture } from '../interaction/activeGesture';
import { tailControlBounds } from '../bubbles/tailBounds';
import { createAttachedTail } from '../bubbles/tailCommands';
import { createProject } from '../domain/factories';
import { localLayerBounds } from '../interaction/layerBounds';
import { effectGeometryFor } from '../text/effectBounds';

/** Root-local bounds are shared by click placement and pointer previews. */
export function componentBounds(draft: ObjectDraft): Rect {
  const layer = draft.layer;
  if (layer.type === 'bubbleTail') return tailControlBounds(layer);
  if (layer.type === 'panel') return polyBounds(layer.geometry);
  if (layer.type === 'text') return effectGeometryFor(layer)?.bounds??layer.box;
  if (layer.type === 'decoration') return { x: 0, y: 0, width: layer.spec.width, height: layer.spec.height };
  if (layer.type === 'group') {
    const p = createProject({ background: false }); p.layers = Object.fromEntries([layer, ...draft.descendants].map(item => [item.id, item]));
    return localLayerBounds(p, layer.id) ?? { x: 0, y: 0, width: 1, height: 1 };
  }
  if (layer.type === 'pageBackground') throw new Error('页面背景不属于可拖放组件');
  return { x: 0, y: 0, width: layer.width, height: layer.height };
}

export function componentCenter(draft: ObjectDraft): Point {
  const box = componentBounds(draft);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export interface ComponentPlacement { parentId: Id | null; origin: Point }

/** origin = inverse(Wparent) * pageCenter - localBoundsCenter; owned containers never receive free components. */
export function resolveComponentPlacement(project: Project, draft: ObjectDraft, pageId: Id, point: Point, scopeId: Id | null): Result<ComponentPlacement> {
  if (!project.pages[pageId] || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return fail(problem('creation/page', '放置页面或坐标无效'));
  let parentId = scopeId;
  if (parentId) {
    const scope = project.layers[parentId], flags = effectiveLayerFlags(project, parentId);
    if (!scope || scope.pageId !== pageId || flags.locked || !flags.visible) return fail(problem('creation/scope', '当前编辑范围已失效、锁定或隐藏'));
    while (parentId) {const candidate:Layer=project.layers[parentId];if(candidate.type==='group'&&!candidate.dialogue)break;parentId=candidate.parentId;}
  }
  const inv = parentId ? inverse(worldMatrix(project, parentId)) : ok([1, 0, 0, 1, 0, 0] as const);
  if (!inv.ok) return inv;
  const local = apply([...inv.value], point), center = componentCenter(draft);
  return ok({ parentId, origin: { x: local.x - center.x, y: local.y - center.y } });
}

export function placeComponentAtPageCenter(kind: CreateKind, pageId: Id): Result<Id> {
  cancelActiveGesture();
  const page = getProject().pages[pageId];
  if (!page) return fail(problem('creation/page', '当前页面不存在，无法添加组件'));
  if(kind.startsWith('tail:')){const selection=sessionStore.getState().selection,body=getProject().layers[selection[0]];if(selection.length===1&&body?.type==='bubble')return createAttachedTail(body.id,kind.slice(5) as import('../domain/types').BubbleTailLayer['appearance']);}
  const draft = createObjectDraft(kind, pageId);
  if (!draft.ok) return draft;
  const target = resolveComponentPlacement(getProject(), draft.value, pageId, { x: page.width / 2, y: page.height / 2 }, sessionStore.getState().scopeId);
  const placed = target.ok ? placeObjectDraft(draft.value, pageId, target.value.origin, target.value.parentId) : target;
  if (!placed.ok) { resetCounters(); syncCounters(getProject()); }
  return placed;
}
