import { effectPadding } from '../appearance/effects';
import { maxSingularValue } from '../geometry/flattenForBoolean';
import type { Id, Point, Project, Rect, Viewport } from '../domain/types';
import { apply, worldMatrix } from '../geometry/matrix';
import { composeBubble } from '../bubbles/composeBubble';
import type { ShapePath } from '../geometry/types';
import { fontCss } from '../text/fonts';
import { applyCanvasTextPolicy } from '../text/canvasStyle';
import { isBreakout } from './paintOps';
import { tailVisualBounds } from '../bubbles/tailPaint';
import { prepareDialogue } from '../bubbles/dialogueGeometry';
import { effectGeometryFor } from '../text/effectBounds';
import { bubbleFrameBounds } from '../text/bubbleFrameBounds';
import { bubbleInkBounds } from '../bubbles/inkPaint';
import { layerPaint } from '../appearance/model';

function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

function pointsBounds(points: Point[]): Rect | null {
  if (!points.length) return null;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function rectPoints(rect: Rect): Point[] {
  return [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height }];
}

function pathPoints(path: ShapePath): Point[] {
  const points: Point[] = [];
  for (const op of path.ops) {
    if ('p' in op) points.push(op.p);
    if ('control' in op) points.push(op.control);
    if ('c1' in op) points.push(op.c1, op.c2);
  }
  return points;
}

/** 保守屏幕bbox：包含曲线控制点、边框、尾部；容器clip可把子图并入容器bbox。 */
export function layerScreenBounds(project: Project, id: Id, viewport: Viewport): Rect | null {
  const layer = project.layers[id];
  if (!layer || !layer.visible) return null;
  if (layer.type === 'group') {let box=layer.children.reduce<Rect | null>((box, child) => union(box, layerScreenBounds(project, child, viewport)), null);if(layer.dialogue){const prepared=prepareDialogue(project,id);if(prepared.ok){const world=worldMatrix(project,id);box=union(box,pointsBounds(rectPoints(prepared.value.bounds).map(p=>{const q=apply(world,p);return{x:viewport.pan.x+viewport.zoom*q.x,y:viewport.pan.y+viewport.zoom*q.y};})));}}return expandStyle(project,id,box,viewport);}
  const world = worldMatrix(project, id);
  const screen = (p: Point): Point => {
    const page = apply(world, p);
    return { x: viewport.pan.x + viewport.zoom * page.x, y: viewport.pan.y + viewport.zoom * page.y };
  };
  let points: Point[] = [];
  let stroke = 0;
  if (layer.type === 'pageBackground') points = rectPoints({ x: 0, y: 0, width: project.pages[layer.pageId].width, height: project.pages[layer.pageId].height });
  if (layer.type === 'panel') { points = layer.geometry; stroke = layer.style.borderWidth; }
  else if (layer.type === 'image') points = rectPoints({ x: 0, y: 0, width: layer.width, height: layer.height });
  else if (layer.type === 'text') points = rectPoints(effectGeometryFor(layer)?.bounds??bubbleFrameBounds(project,id)?.box??layer.box);
  else if (layer.type === 'decoration') {
    const spec = layer.spec;
    if(spec.kind==='shape'){points=spec.geometry;stroke=spec.style.borderWidth;}
    else if (spec.kind === 'sfx') {
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
      if (ctx) {
        applyCanvasTextPolicy(ctx);
        ctx.font = fontCss(spec.fontFamily, spec.fontSize, true);
        const metrics = ctx.measureText(spec.content);
        const left = metrics.actualBoundingBoxLeft || 0;
        const right = metrics.actualBoundingBoxRight || metrics.width;
        const ascent = metrics.actualBoundingBoxAscent || spec.fontSize;
        const descent = metrics.actualBoundingBoxDescent || spec.fontSize * 0.25;
        points = rectPoints({ x: -left, y: spec.fontSize - ascent, width: left + right, height: ascent + descent });
      } else points = rectPoints({ x: 0, y: 0, width: Math.max(spec.width, spec.content.length * spec.fontSize), height: spec.fontSize * 1.25 });
      canvas.width = canvas.height = 0;
      stroke = spec.outlineWidth;
    } else { points = rectPoints({ x: 0, y: 0, width: spec.width, height: spec.height }); stroke = spec.kind === 'speed-brush' || spec.kind==='paint' || spec.kind==='background-fill' ? 0 : spec.strokeWidth; }
  }
  else if (layer.type === 'bubble') {
    const geometry = composeBubble(project,id);
    points = geometry.ok ? rectPoints(geometry.value.bounds) : rectPoints({ x: 0, y: 0, width: layer.width, height: layer.height });
    if (geometry.ok && geometry.value.tailLine) points.push(...pathPoints(geometry.value.tailLine));
    const ink=bubbleInkBounds(layer);if(ink)points.push(...rectPoints(ink));
    stroke = geometry.ok&&geometry.value.borderRegion!==undefined?0:layer.style.borderWidth;
  }
  else if (layer.type === 'bubbleTail') {
    const geometry=tailVisualBounds(project,id);points=geometry.ok?rectPoints(geometry.value):[];
  }
  let box = pointsBounds(points.map(screen));
  if (box && stroke > 0) {
    const linear = Math.hypot(world[0], world[1], world[2], world[3]);
    const pad = stroke * linear * viewport.zoom / 2;
    box = { x: box.x - pad, y: box.y - pad, width: box.width + 2 * pad, height: box.height + 2 * pad };
  }
  if (layer.type === 'bubble') for (const child of layer.children) box = union(box, layerScreenBounds(project, child, viewport));
  if (layer.type === 'panel') {
    const collect = (childId: Id) => {
      const child = project.layers[childId]; if (!child?.visible) return;
      if (child.type === 'image' && isBreakout(child)) box = union(box, layerScreenBounds(project, childId, viewport));
      if ('children' in child) child.children.forEach(collect);
    }; layer.children.forEach(collect);
  }
  return expandStyle(project,id,box,viewport);
}

function expandStyle(p:Project,id:Id,b:Rect|null,v:Viewport):Rect|null {
  const l=p.layers[id],s=l.presentation;if(!b||!s)return b;const scale=maxSingularValue(worldMatrix(p,id))*v.zoom,w=Math.max(layerPaint(l)?.borderWidth??0,...(s.stroke.edgeWidths??[])),stroke=w*(s.stroke.alignment==='center'?.5:1)*Math.max(1,s.stroke.join==='miter'?s.stroke.miterLimit:1),pad=(effectPadding(s.effects)+stroke)*scale;return{x:b.x-pad,y:b.y-pad,width:b.width+2*pad,height:b.height+2*pad};
}

export function runScreenBounds(project: Project, roots: Id[], viewport: Viewport, size: { width: number; height: number }): Rect | null {
  const all = roots.reduce<Rect | null>((box, id) => union(box, layerScreenBounds(project, id, viewport)), null);
  if (!all) return null;
  const x0 = Math.max(0, Math.floor(all.x - 2)), y0 = Math.max(0, Math.floor(all.y - 2));
  const x1 = Math.min(size.width, Math.ceil(all.x + all.width + 2)), y1 = Math.min(size.height, Math.ceil(all.y + all.height + 2));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}
