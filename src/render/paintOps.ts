import type { Id, ImageLayer, Mat, Project } from '../domain/types';
import type { ShapePath } from '../geometry/types';
import { IDENTITY, multiply, worldMatrix } from '../geometry/matrix';
import { buildRoundedPolygon } from '../geometry/roundedPolygon';

export interface PanelClipEntry { panelId: Id; matrix: Mat; path: ShapePath }
export interface ScenePaintOp {
  layerId: Id; kind: 'panelFill' | 'panelBorder' | 'content' | 'dialogueSurface'; worldMatrix: Mat;
  contributorIds?: readonly Id[];
  panelClips: readonly PanelClipEntry[]; lineage: readonly Id[]; phase: 'normal' | 'breakout';
}
export function isBreakout(image: ImageLayer): boolean { return !!image.panelClip && image.panelClip.mode !== 'normal'; }
/** Only defer inside the outermost panel branch. Neighbouring roots retain their order. */
export function buildPaintOps(project: Project, pageId: Id, panels: ReadonlyMap<Id, ShapePath>, roots = project.pages[pageId]?.roots ?? []): ScenePaintOp[] {
  const ops: ScenePaintOp[] = [];
  function visit(id: Id, parentWorld: Mat, clips: readonly PanelClipEntry[], lineage: readonly Id[], deferred: ScenePaintOp[] | null) {
    const layer = project.layers[id]; if (!layer?.visible) return;
    const world = multiply(parentWorld, layer.matrix), branch = [...lineage, id];
    const op = (kind: ScenePaintOp['kind'], phase: ScenePaintOp['phase'] = 'normal'): ScenePaintOp => ({ layerId: id, kind, worldMatrix: world, panelClips: clips, lineage: branch, phase });
    if (layer.type === 'group') {
      if(layer.dialogue){
        ops.push({...op('dialogueSurface'),contributorIds:[id,...layer.children.flatMap(cid=>{const child=project.layers[cid];return child&&'children'in child?[cid,...child.children]:[cid];})]});
        for(const cid of layer.children){const body=project.layers[cid];if(body?.type==='bubble'&&body.visible)for(const tid of body.children)if(project.layers[tid]?.type==='text')visit(tid,multiply(world,body.matrix),clips,[...branch,cid],deferred);}
      }else layer.children.forEach(child => visit(child, world, clips, branch, deferred));
    }
    else if (layer.type === 'panel') {
      const queue = deferred ?? [];
      ops.push(op('panelFill'));
      const inside = [...clips, { panelId: id, matrix: world, path: panels.get(id) ?? buildRoundedPolygon(layer.geometry, layer.style.borderRadius) }];
      layer.children.forEach(child => visit(child, world, inside, branch, queue));
      ops.push(op('panelBorder'));
      if (!deferred) ops.push(...queue);
    } else {
      const breakout = layer.type === 'image' && clips.length > 0 && isBreakout(layer), content = op('content', breakout ? 'breakout' : 'normal');
      if (breakout && deferred) deferred.push(content); else ops.push(content);
      if (layer.type === 'bubble') layer.children.forEach(child => { if(project.layers[child]?.type!=='bubbleTail')visit(child, world, clips, branch, deferred); });
    }
  }
  for (const id of roots) {
    const layer = project.layers[id]; if (!layer) continue;
    const ancestors: Id[] = []; for (let p = layer.parentId; p; p = project.layers[p]?.parentId ?? null) ancestors.unshift(p);
    const clips = ancestors.flatMap(parentId => { const p = project.layers[parentId]; return p.type === 'panel' ? [{ panelId: p.id, matrix: worldMatrix(project, p.id), path: panels.get(p.id) ?? buildRoundedPolygon(p.geometry, p.style.borderRadius) }] : []; });
    visit(id, layer.parentId ? worldMatrix(project, layer.parentId) : IDENTITY, clips, ancestors, null);
  }
  return ops;
}
