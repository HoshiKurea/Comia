import type { BreakoutRegion, ImageLayer, Mat, Point, Project } from '../domain/types';
import type { PathOp, ShapePath } from '../geometry/types';
import { apply, inverse, multiply, worldMatrix } from '../geometry/matrix';
import { polyBounds } from '../geometry/polygon';
import {resolveCrop} from '../images/crop';
import { maskContains } from '../images/maskGeometry';
import type { ScenePaintOp, PanelClipEntry } from './paintOps';

export function appendPath(ctx: CanvasRenderingContext2D, path: ShapePath, reverse = false) {
  let ops = path.ops;
  if (reverse) {
    const segments: { start: Point; op: Exclude<PathOp, { op: 'M' | 'Z' }> }[] = []; let cursor = { x: 0, y: 0 };
    for (const op of path.ops) { if (op.op === 'M') cursor = op.p; else if (op.op !== 'Z') { segments.push({ start: cursor, op }); cursor = op.p; } }
    ops = [{ op: 'M', p: cursor }, ...segments.reverse().map(({ start, op }): PathOp => op.op === 'C' ? { op: 'C', p: start, c1: op.c2, c2: op.c1 } : op.op === 'Q' ? { op: 'Q', p: start, control: op.control } : { op: 'L', p: start }), { op: 'Z' }];
  }
  for (const op of ops) {
    if (op.op === 'M') ctx.moveTo(op.p.x, op.p.y); else if (op.op === 'L') ctx.lineTo(op.p.x, op.p.y);
    else if (op.op === 'Q') ctx.quadraticCurveTo(op.control.x, op.control.y, op.p.x, op.p.y);
    else if (op.op === 'C') ctx.bezierCurveTo(op.c1.x, op.c1.y, op.c2.x, op.c2.y, op.p.x, op.p.y); else ctx.closePath();
  }
}
function negative(matrix: Mat) { return matrix[0] * matrix[3] - matrix[1] * matrix[2] < 0; }
function appendPanel(ctx: CanvasRenderingContext2D, entry: PanelClipEntry) {
  const points = entry.path.ops.flatMap(op => op.op === 'Z' ? [] : [op.p]); let area = 0;
  points.forEach((a,i) => { const b = points[(i + 1) % points.length]; area += a.x * b.y - b.x * a.y; });
  ctx.save(); ctx.transform(...entry.matrix); appendPath(ctx, entry.path, (area < 0) !== negative(entry.matrix)); ctx.restore();
}
export function appendRegion(ctx: CanvasRenderingContext2D, region: BreakoutRegion, matrix: Mat) {
  ctx.save(); ctx.transform(...matrix);
  if (region.shape === 'ellipse') { const b = polyBounds(region.geometry); ctx.moveTo(b.x + b.width, b.y + b.height / 2); ctx.ellipse(b.x + b.width / 2, b.y + b.height / 2, b.width / 2, b.height / 2, 0, 0, Math.PI * 2, negative(matrix)); ctx.closePath(); }
  else {
    let area2 = 0; const points = region.geometry;
    for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; area2 += a.x * b.y - b.x * a.y; }
    const ordered = (area2 < 0) !== negative(matrix) ? [...points].reverse() : points;
    ordered.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
  }
  ctx.restore();
}
export function applyPanelClipPolicy(ctx: CanvasRenderingContext2D, project: Project, op: ScenePaintOp): void {
  const layer = project.layers[op.layerId], policy = layer?.type === 'image' ? layer.panelClip : undefined;
  if (policy?.mode === 'whole') return;
  for (const entry of op.panelClips) {
    ctx.beginPath(); appendPanel(ctx, entry);
    if (policy?.mode === 'partial') appendRegion(ctx, policy.region, multiply(op.worldMatrix, policy.region.matrix));
    ctx.clip('nonzero');
  }
}
let hitContext: CanvasRenderingContext2D | null = null;
export function pointInsideClipEntry(entry: PanelClipEntry, p: Point): boolean {
  hitContext ??= document.createElement('canvas').getContext('2d'); if (!hitContext) return false;
  const inv = inverse(entry.matrix); if (!inv.ok) return false;
  const local = apply(inv.value, p); hitContext.beginPath(); appendPath(hitContext, entry.path); return hitContext.isPointInPath(local.x, local.y);
}
export function imageVisibleAt(project: Project, image: ImageLayer, point: Point, clips: readonly PanelClipEntry[]): boolean {
  const inv = inverse(worldMatrix(project, image.id)); if (!inv.ok) return false;
  const p = apply(inv.value, point);
  const parent=image.parentId?project.layers[image.parentId]:null;
  const m=image.crop&&parent?.type==='panel'?resolveCrop(parent.geometry,{x:image.width,y:image.height},image.crop):{tx:0,ty:0,scale:1};
  if(p.x<m.tx||p.y<m.ty||p.x>m.tx+image.width*m.scale||p.y>m.ty+image.height*m.scale||(image.mask&&!maskContains(image.mask,p)))return false;
  const policy = image.panelClip;
  if (policy?.mode === 'whole') return true;
  const inRegion = policy?.mode === 'partial' && maskContains({ ...policy.region, enabled: true, linked: true }, p);
  return clips.every(entry => inRegion || pointInsideClipEntry(entry, point));
}
