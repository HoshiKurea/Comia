import type { BubbleLayer, BubbleTail, Point, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { atArc, bubbleBodyPath, buildBubble, flattenPath, perimeter } from './geometry';

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function valid(bubble: BubbleLayer, tail: BubbleTail): boolean {
  return buildBubble(bubble.shape, bubble.width, bubble.height, bubble.style, tail, bubble).ok;
}

/** Constrain along the actual pointer path: scan for the first invalid interval, then bisect it. */
function firstValid<T>(start: T, target: T, interpolate: (t: number) => T, accepts: (value: T) => boolean): T {
  if (!accepts(start)) return start;
  let last = 0;
  for (let step = 1; step <= 32; step++) {
    const t = step / 32;
    if (accepts(interpolate(t))) { last = t; continue; }
    let low = last, high = t;
    for (let i = 0; i < 20; i++) {
      const mid = (low + high) / 2;
      if (accepts(interpolate(mid))) low = mid;
      else high = mid;
    }
    return interpolate(low);
  }
  return target;
}

export function tailBasePoint(bubble: BubbleLayer): Result<Point> {
  if (!bubble.tail) return fail(problem('bubble/no-tail', '气泡尚无尾部'));
  try {
    const points = flattenPath(bubbleBodyPath(bubble.shape, bubble.width, bubble.height, bubble.style,bubble));
    const { positions, total } = perimeter(points);
    return ok(atArc(points, positions, total, bubble.tail.attachU * total));
  } catch { return fail(problem('bubble/budget', '气泡轮廓超出几何预算')); }
}

export function defaultTail(bubble: BubbleLayer, kind: BubbleTail['kind']): Result<BubbleTail> {
  let points: Point[];
  try { points = flattenPath(bubbleBodyPath(bubble.shape, bubble.width, bubble.height, bubble.style,bubble)); }
  catch { return fail(problem('bubble/budget', '气泡轮廓超出几何预算')); }
  const { positions, total } = perimeter(points);
  const tip = { x: bubble.width * 0.65, y: bubble.height + 60 };
  const baseWidth = Math.min(24, 128, total * 0.2);
  const preferred: BubbleTail = { kind, attachU: 0.65, baseWidth, tip };
  if (valid(bubble, preferred)) return ok(preferred);
  let best: BubbleTail | null = null, bestDistance = Infinity;
  for (let i = 0; i < 256; i++) {
    const u = i / 256;
    const candidate = { ...preferred, attachU: u };
    if (!valid(bubble, candidate)) continue;
    const base = atArc(points, positions, total, u * total);
    const distance = Math.hypot(base.x - tip.x, base.y - tip.y);
    if (distance < bestDistance) { bestDistance = distance; best = candidate; }
  }
  return best ? ok(best) : fail(problem('bubble/tail-default', '该形状无法放置默认尾部'));
}

export function moveTailTip(bubble: BubbleLayer, tip: Point): Result<BubbleTail> {
  if (!bubble.tail) return fail(problem('bubble/no-tail', '气泡尚无尾部'));
  if (!Number.isFinite(tip.x) || !Number.isFinite(tip.y)) return fail(problem('bubble/tip-finite', '尾尖坐标必须是有限数'));
  const base = tailBasePoint(bubble);
  if (!base.ok) return base;
  const dx = tip.x - base.value.x, dy = tip.y - base.value.y;
  const distance = Math.hypot(dx, dy), maxDistance = 4 * Math.max(bubble.width, bubble.height);
  const bounded = distance > maxDistance ? { x: base.value.x + dx * maxDistance / distance, y: base.value.y + dy * maxDistance / distance } : tip;
  const current = bubble.tail;
  const target = { ...current, tip: bounded };
  const next = firstValid(current, target, (t) => ({ ...current, tip: { x: lerp(current.tip.x, bounded.x, t), y: lerp(current.tip.y, bounded.y, t) } }), (tail) => valid(bubble, tail));
  return ok(next);
}

export function moveTailBase(bubble: BubbleLayer, point: Point): Result<BubbleTail> {
  if (!bubble.tail) return fail(problem('bubble/no-tail', '气泡尚无尾部'));
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return fail(problem('bubble/base-finite', '底座坐标必须是有限数'));
  let points: Point[];
  try { points = flattenPath(bubbleBodyPath(bubble.shape, bubble.width, bubble.height, bubble.style,bubble)); }
  catch { return fail(problem('bubble/budget', '气泡轮廓超出几何预算')); }
  const { positions, total } = perimeter(points);
  if (total <= 0) return fail(problem('bubble/body-perimeter', '气泡轮廓周长无效'));
  let bestDistance = Infinity, bestArcDistance = Infinity, bestU = bubble.tail.attachU;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy;
    if (squared <= 1e-12) continue;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / squared));
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const distance = (point.x - q.x) ** 2 + (point.y - q.y) ** 2;
    const u = ((positions[i] + t * Math.sqrt(squared)) / total) % 1;
    const arcDistance = Math.min(Math.abs(u - bubble.tail.attachU), 1 - Math.abs(u - bubble.tail.attachU));
    if (distance < bestDistance - 1e-8 || Math.abs(distance - bestDistance) <= 1e-8 && arcDistance < bestArcDistance) {
      bestDistance = distance; bestArcDistance = arcDistance; bestU = u;
    }
  }
  const current = bubble.tail;
  let delta = bestU - current.attachU;
  if (delta > 0.5) delta -= 1;
  else if (delta < -0.5) delta += 1;
  const target = { ...current, attachU: bestU };
  const next = firstValid(current, target, (t) => ({ ...current, attachU: ((current.attachU + delta * t) % 1 + 1) % 1 }), (tail) => valid(bubble, tail));
  return ok(next);
}
