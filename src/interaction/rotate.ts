import type { Id, Mat, Point, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { apply, decompose, multiply, rotationRad, translation } from '../geometry/matrix';
import { localLayerBounds } from './layerBounds';

export function normalizeDegrees(degrees: number): number { return ((degrees + 180) % 360 + 360) % 360 - 180; }
export function unwrapStep(previous: number, current: number): number { return Math.atan2(Math.sin(current - previous), Math.cos(current - previous)); }
export function rotateAround(project: Project, id: Id, pivotLocal: Point, deltaRad: number): Mat {
  const layer = project.layers[id], pivot = apply(layer.matrix, pivotLocal);
  return multiply(multiply(multiply(translation(pivot.x, pivot.y), rotationRad(deltaRad)), translation(-pivot.x, -pivot.y)), layer.matrix);
}
export function matrixAtAngle(project: Project, id: Id, degrees: number): Result<Mat> {
  const layer = project.layers[id], box = localLayerBounds(project, id);
  if (!layer || !box || !Number.isFinite(degrees)) return fail(problem('rotate/input', '对象或角度无效'));
  if (layer.type === 'pageBackground') return fail(problem('background/transform', '页面背景不能旋转'));
  const parent = layer.parentId ? project.layers[layer.parentId] : null;
  if ((parent?.type === 'panel' && !(layer.type === 'image' && !layer.crop)) || parent?.type === 'bubble') return fail(problem('rotate/owned', '受容器控制的子层不能独立旋转'));
  const delta = normalizeDegrees(degrees) * Math.PI / 180 - decompose(layer.matrix).thetaRad;
  return ok(rotateAround(project, id, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, delta));
}
export function snappedRotation(startRad: number, deltaRad: number, alt: boolean): number {
  const raw = startRad + deltaRad;
  return alt ? raw : Math.floor(raw / (Math.PI / 36) + .5) * Math.PI / 36;
}
