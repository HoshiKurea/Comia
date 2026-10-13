import type { DecorationSpec, Point } from '../domain/types';
import type { ShapePath } from '../geometry/types';
import { polyBounds } from '../geometry/polygon';
import { buildRoundedPolygon } from '../geometry/roundedPolygon';

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 0x100000000; };
}

/** Liang–Barsky clipping preserves the line direction and the exact rectangle boundary. */
function clipSegment(a: Point, b: Point, width: number, height: number): [Point, Point] | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy], q = [a.x, width - a.x, a.y, height - a.y];
  let enter = 0, leave = 1;
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) { if (q[i] < 0) return null; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) enter = Math.max(enter, t);
    else leave = Math.min(leave, t);
    if (enter > leave) return null;
  }
  return [{ x: a.x + enter * dx, y: a.y + enter * dy }, { x: a.x + leave * dx, y: a.y + leave * dy }];
}

function line(a: Point, b: Point): ShapePath {
  return { ops: [{ op: 'M', p: a }, { op: 'L', p: b }], bounds: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) } };
}

export function buildDecoration(spec: DecorationSpec): ShapePath[] {
  if (spec.kind === 'sfx' || spec.kind === 'paint' || spec.kind === 'background-fill') return [];
  if (spec.kind === 'shape') return [buildRoundedPolygon(spec.geometry, spec.style.borderRadius)];
  if (spec.kind === 'speed-brush') return spec.ribbons.map(ring => {
    const points = ring.map(p => ({ x: p.x * spec.width, y: p.y * spec.height }));
    return { ops: [{ op: 'M', p: points[0] }, ...points.slice(1).map(p => ({ op: 'L' as const, p })), { op: 'Z' }], bounds: polyBounds(points) };
  });
  const rand = random(spec.seed);
  const paths: ShapePath[] = [];
  const w = spec.width, h = spec.height;
  if (spec.kind === 'speed') {
    const angle = spec.angleDeg * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const rotate = (p: Point): Point => { const x = p.x - w / 2, y = p.y - h / 2; return { x: w / 2 + cos * x - sin * y, y: h / 2 + sin * x + cos * y }; };
    for (let i = 0; i < spec.count; i++) {
      const y = h * i / (spec.count - 1);
      const a = rotate({ x: w * 0.15 * rand(), y });
      const b = rotate({ x: w * (0.75 + 0.25 * rand()), y });
      const clipped = clipSegment(a, b, w, h);
      if (clipped) paths.push(line(clipped[0], clipped[1]));
    }
  } else {
    for (let i = 0; i < spec.count; i++) {
      const theta = 2 * Math.PI * (i + (rand() - 0.5) * 0.4) / spec.count;
      const dx = Math.cos(theta), dy = Math.sin(theta);
      const tx = Math.abs(dx) < 1e-12 ? Infinity : w / 2 / Math.abs(dx);
      const ty = Math.abs(dy) < 1e-12 ? Infinity : h / 2 / Math.abs(dy);
      const t = Math.min(tx, ty);
      paths.push(line(
        { x: w / 2 + dx * t * spec.innerRatio, y: h / 2 + dy * t * spec.innerRatio },
        { x: w / 2 + dx * t, y: h / 2 + dy * t },
      ));
    }
  }
  return paths;
}
