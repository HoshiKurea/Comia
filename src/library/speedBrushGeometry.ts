import type { Point, Rect, Result, SpeedBrushOptions, SpeedBrushSpec } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { distanceToSegment } from '../geometry/simplePolygon';
import { polyBounds } from '../geometry/polygon';

export const SPEED_BRUSH = {
  rawPoints: 4096, centerPoints: 512, ribbonPoints: 32768, projectPoints: 500000,
  radius: [8, 256], density: [2, 24], strokeWidth: [.25, 16], irregularity: [0, 1],
} as const;
export const DEFAULT_SPEED_BRUSH: Readonly<SpeedBrushOptions> = Object.freeze({
  radius: 64, density: 8, strokeWidth: 1.5, irregularity: .35, color: '#000000FF',
});
export function validBrushOptions(value: unknown): value is SpeedBrushOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (['radius', 'density', 'strokeWidth', 'irregularity'] as const).every(key =>
    typeof v[key] === 'number' && Number.isFinite(v[key]) && v[key] >= SPEED_BRUSH[key][0] && v[key] <= SPEED_BRUSH[key][1])
    && Number.isInteger(v.density) && typeof v.color === 'string' && /^#[\da-f]{8}$/i.test(v.color);
}
function unit(x: number, y: number): Point { const length = Math.hypot(x, y); return { x: x / length, y: y / length }; }
function paddedBounds(points: Point[]): Rect {
  const b = polyBounds(points), width = Math.max(16, b.width + 2), height = Math.max(16, b.height + 2);
  return { x: b.x - (width - b.width) / 2, y: b.y - (height - b.height) / 2, width, height };
}
export function normalizeBrushGeometry(centerline: Point[], ribbons: Point[][], options: SpeedBrushOptions, seed: number): { bounds: Rect; spec: SpeedBrushSpec } {
  const bounds = paddedBounds([...centerline, ...ribbons.flat()]);
  const normalized = (p: Point): Point => ({ x: (p.x - bounds.x) / bounds.width, y: (p.y - bounds.y) / bounds.height });
  return { bounds, spec: { kind: 'speed-brush', width: bounds.width, height: bounds.height, color: options.color,
    seed, options: { ...options }, centerline: centerline.map(normalized), ribbons: ribbons.map(r => r.map(normalized)) } };
}

/** Parallel straight ribbons. Pointer start/end define the axis; spacing may vary. */
export function buildSpeedBrush(raw: readonly Point[], options: SpeedBrushOptions, seed: number, tolerancePagePx: number): Result<{ bounds: Rect; spec: SpeedBrushSpec }> {
  if (!validBrushOptions(options) || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isFinite(tolerancePagePx) || tolerancePagePx <= 0
    || raw.length > SPEED_BRUSH.rawPoints || raw.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return fail(problem('brush/input', '速度线笔刷参数或采样无效'));
  const dedup = raw.filter((p, i) => !i || Math.hypot(p.x - raw[i - 1].x, p.y - raw[i - 1].y) > 1e-8);
  if (dedup.length < 2) return fail(problem('brush/short', '请拖动绘制速度线'));
  const points = [dedup[0], dedup.at(-1)!];
  const dx = points[1].x - points[0].x, dy = points[1].y - points[0].y, total = Math.hypot(dx, dy);
  if (!Number.isFinite(total) || total < 4) return fail(problem('brush/short', '笔触太短'));
  const tangent = unit(dx, dy), normal = { x: -tangent.y, y: tangent.x };
  let state = seed >>> 0;
  const rand = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
  const ribbons: Point[][] = []; let budget = 0;
  for (let j = 0; j < options.density; j++) {
    // Always consume all recipe values, even when a short line is not yet visible.
    const r = Array.from({ length: 11 }, rand), amount = options.irregularity;
    const offset = options.radius * (2 * (j + .5) / options.density - 1 + amount * (2 * r[0] - 1) / options.density);
    // r[1..3] remain reserved: visible line recipes stay stable as the stroke grows.
    const start = 16 * amount * r[4], end = total - 32 * amount * r[5], width = options.strokeWidth * (1 + .45 * amount * (2 * r[6] - 1));
    if (end - start < 4) continue;
    let spans: [number, number][] = [[start, end]];
    const exclude = (a: number, b: number) => { spans = spans.flatMap(([lo, hi]): [number, number][] => b <= lo || a >= hi ? [[lo, hi]] : [[lo, Math.min(hi, a)], [Math.max(lo, b), hi]].filter(([x, y]) => y - x >= 4) as [number, number][]); };
    if (amount > 0) for (let k = 0; k < 2; k++) { const center = 96 + 160 * k + 48 * amount * (2 * r[7 + k * 2] - 1), gap = (2 + 6 * r[8 + k * 2]) * amount; exclude(center - gap / 2, center + gap / 2); }
    for (const [a, b] of spans) {
      const step = Math.max(2, tolerancePagePx), count = Math.ceil((b - a) / step);
      if (count + 1 > 512) return fail(problem('brush/budget', '笔触过长，请分为多笔绘制'));
      const samples = Array.from({ length: count + 1 }, (_, k) => a + (b - a) * k / count);
      if (samples.length > 512 || (budget += samples.length * 2) > SPEED_BRUSH.ribbonPoints) return fail(problem('brush/budget', '速度线几何超出单笔预算，请分笔绘制'));
      const left: Point[] = [], right: Point[] = [], taper = Math.min(24, (b - a) / 2);
      for (const s of samples) {
        const p = { x: points[0].x + tangent.x * s, y: points[0].y + tangent.y * s }, n = normal;
        const half = width * (.1 + .9 * Math.max(0, Math.min(1, (s - a) / taper, (b - s) / taper)) ** .7) / 2;
        left.push({ x: p.x + n.x * (offset + half), y: p.y + n.y * (offset + half) });
        right.push({ x: p.x + n.x * (offset - half), y: p.y + n.y * (offset - half) });
      }
      ribbons.push([...left, ...right.reverse()]);
    }
  }
  if (!ribbons.length) return fail(problem('brush/short', '笔触太短'));
  const built = normalizeBrushGeometry(points, ribbons, options, seed);
  if (built.bounds.width > 16384 || built.bounds.height > 16384) return fail(problem('brush/bounds', '速度线范围超过16384像素，请分笔绘制'));
  return ok(built);
}

/** The same nonzero winding rule as Canvas fill(), including boundary hits. */
export function speedBrushContains(spec: SpeedBrushSpec, local: Point): boolean {
  const p = { x: local.x / spec.width, y: local.y / spec.height };
  return spec.ribbons.some(ring => {
    let winding = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if (distanceToSegment(p, a, b) < 1e-9) return true;
      const cross = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
      if (a.y <= p.y && b.y > p.y && cross > 0) winding++;
      else if (a.y > p.y && b.y <= p.y && cross < 0) winding--;
    }
    return winding !== 0;
  });
}
