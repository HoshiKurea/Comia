import type { Id, Point, Result } from '../domain/types';
import { apply, inverse, worldMatrix } from '../geometry/matrix';
import { getProject } from '../state/documentStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { pointInsidePanelClips } from '../render/drawScene';
import { maskContains } from './maskGeometry';
import { beginMaskEdit } from './maskController';
import { beginCropEdit } from './cropController';
export { beginCropEdit };

/** Double-click follows actual image paint order. Legacy covers keep their existing crop editor. */
export function beginPanelImageEdit(panelId: Id, pagePoint: Point): Result<void> {
  const project = getProject(), panel = project.layers[panelId];
  if (panel?.type === 'panel' && panel.role === 'leaf' && pointInsidePanelClips(project, panelId, pagePoint)) {
    for (const id of [...panel.children].reverse()) {
      const image = project.layers[id], flags = effectiveLayerFlags(project, id);
      if (image?.type !== 'image' || !flags.visible || flags.locked) continue;
      if (image.crop) return beginCropEdit(panelId, id);
      const inv = inverse(worldMatrix(project, id)); if (!inv.ok) continue;
      const local = apply(inv.value, pagePoint);
      if (local.x >= 0 && local.y >= 0 && local.x <= image.width && local.y <= image.height && (!image.mask || maskContains(image.mask, local))) return beginMaskEdit(id);
    }
  }
  return beginCropEdit(panelId);
}
