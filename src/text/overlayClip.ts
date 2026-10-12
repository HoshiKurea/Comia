import type { Id, Project, Viewport, Rect } from '../domain/types';
import { buildRoundedPolygon } from '../geometry/roundedPolygon';
import { tracePath } from '../render/drawScene';

/** Leaves context in the text layer's local space with paper/ancestor clipping applied. */
export function clipTextOverlay(ctx: CanvasRenderingContext2D, project: Project, id: Id, viewport: Viewport, frame?:Rect, safe?:Rect): void {
  const page = project.pages[project.layers[id].pageId];
  ctx.translate(viewport.pan.x, viewport.pan.y); ctx.scale(viewport.zoom, viewport.zoom);
  ctx.beginPath(); ctx.rect(0, 0, page.width, page.height); ctx.clip();
  const chain: Id[] = [];
  for (let target: Id | null = id; target; target = project.layers[target].parentId) chain.unshift(target);
  for (const target of chain) {
    const layer = project.layers[target]; ctx.transform(...layer.matrix);
    if (layer.type === 'panel') { tracePath(ctx, buildRoundedPolygon(layer.geometry, layer.style.borderRadius)); ctx.clip(); }
    if (layer.type === 'text'&&layer.role!=='sfx') { if(safe){ctx.beginPath();ctx.rect(safe.x,safe.y,safe.width,safe.height);ctx.clip();}const box=frame??layer.box;ctx.beginPath(); ctx.rect(box.x, box.y, box.width, box.height); ctx.clip(); }
  }
}
