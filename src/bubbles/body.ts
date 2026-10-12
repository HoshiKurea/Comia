import type { BubbleStyle, LegacyBubbleShape, Point } from '../domain/types';
import type { ShapePath } from '../geometry/types';
import { buildEllipse, buildRoundedPolygon, buildRoundedRect } from '../geometry/roundedPolygon';

/** This recipe is retained byte-for-byte for legacy scenes. */
export function legacyBodyPath(shape: LegacyBubbleShape, w: number, h: number, style: BubbleStyle): ShapePath {
  if (shape === 'circle') return buildEllipse(w / 2, h / 2, w / 2, h / 2);
  if (shape === 'rect' || shape === 'roundRect') return buildRoundedRect({ x: 0, y: 0, width: w, height: h }, shape === 'rect' ? 0 : style.radius);
  const count = shape === 'cloud' ? 96 : 24, points: Point[] = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.PI * 2 * i / count;
    const radius = shape === 'cloud' ? (1 + .08 * Math.cos(12 * angle)) / 1.08 : i % 2 === 0 ? 1 : .76;
    points.push({ x: w / 2 + w / 2 * radius * Math.cos(angle), y: h / 2 + h / 2 * radius * Math.sin(angle) });
  }
  return buildRoundedPolygon(points, 0);
}
