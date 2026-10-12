import type { Id, Mat, Project, Rect } from '../domain/types';
import { IDENTITY, multiply, worldMatrix } from '../geometry/matrix';
import { polyBounds } from '../geometry/polygon';
import { pathBounds, unionBounds } from '../geometry/bounds';
import { composeBubble } from '../bubbles/composeBubble';
import { buildRoundedPolygon, buildRoundedRect } from '../geometry/roundedPolygon';
import { tailVisualBounds } from '../bubbles/tailPaint';
import { prepareDialogue } from '../bubbles/dialogueGeometry';
import { effectGeometryFor } from '../text/effectBounds';
import { bubbleFrameBounds } from '../text/bubbleFrameBounds';

function boundsAt(project: Project, id: Id, matrix: Mat): Rect | null {
  const layer = project.layers[id]; if (!layer?.visible) return null;
  if (layer.type === 'pageBackground') return { x: 0, y: 0, width: project.pages[layer.pageId].width, height: project.pages[layer.pageId].height };
  if (layer.type === 'group') {const children=layer.children.map((child) => boundsAt(project, child, multiply(matrix, project.layers[child].matrix))).filter((box): box is Rect => box !== null);if(layer.dialogue){const geometry=prepareDialogue(project,id),extra=geometry.ok?pathBounds(buildRoundedRect(geometry.value.bounds,0),matrix):null;if(extra)children.push(extra);}return unionBounds(children);}
  if (layer.type === 'panel') return pathBounds(buildRoundedPolygon(layer.geometry, layer.style.borderRadius), matrix);
  if (layer.type === 'bubble') {
    const geometry=composeBubble(project,id);if(!geometry.ok)return null;return pathBounds(buildRoundedRect(geometry.value.bounds,0),matrix);
  }
  if (layer.type === 'bubbleTail') {
    const geometry=tailVisualBounds(project,id);return geometry.ok?pathBounds(buildRoundedRect(geometry.value,0),matrix):null;
  }
  const box = layer.type === 'text' ? effectGeometryFor(layer)?.bounds??bubbleFrameBounds(project,id)?.box??layer.box : layer.type === 'decoration' ? { x: 0, y: 0, width: layer.spec.width, height: layer.spec.height } : { x: 0, y: 0, width: layer.width, height: layer.height };
  return pathBounds(buildRoundedRect(box, 0), matrix);
}
export function layerWorldBounds(project: Project, id: Id): Rect | null { return boundsAt(project, id, worldMatrix(project, id)); }
/** Handles use the panel's full geometric bbox and bubble's body, while group bounds union visible descendants. */
export function localLayerBounds(project: Project, id: Id): Rect | null {
  const layer = project.layers[id]; if (!layer) return null;
  if (layer.type === 'panel') return polyBounds(layer.geometry);
  if (layer.type === 'bubble') return { x: 0, y: 0, width: layer.width, height: layer.height };
  return boundsAt(project, id, IDENTITY);
}
