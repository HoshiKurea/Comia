import type { BubbleLayer, BubbleTailLayer, Point, Rect } from '../domain/types';
import { bubbleBodyPath, flattenPath, atArc, perimeter } from './geometry';
import { polyBounds } from '../geometry/polygon';

/** Bezier control hull gives conservative bounds without sampling a curve. */
export function tailControlPoints(tail: BubbleTailLayer, owner?: BubbleLayer): Point[] {
  let bases: Point[];
  if (tail.attachment.mode === 'free') bases = [tail.attachment.baseA, tail.attachment.baseB];
  else {
    if (!owner) throw Error('绑定尾缺少主体，无法计算边界');
    const points = flattenPath(bubbleBodyPath(owner.shape, owner.width, owner.height, owner.style,owner)), { positions, total } = perimeter(points);
    bases = [atArc(points, positions, total, tail.attachment.attachU * total - tail.attachment.baseWidth / 2), atArc(points, positions, total, tail.attachment.attachU * total + tail.attachment.baseWidth / 2)];
  }
  return [...bases, tail.tip, ...(tail.route.kind === 'polyline' ? tail.route.knots : tail.route.kind === 'spline' ? [tail.route.c1, tail.route.c2] : [])];
}
export function tailControlBounds(tail: BubbleTailLayer, owner?: BubbleLayer): Rect { return polyBounds(tailControlPoints(tail, owner)); }
