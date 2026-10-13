import type { BubbleContour, BubbleShape, BubbleStyle, BubbleTail, HandDrawnStyle, BubbleEdgeStyle, FreehandBubbleSource, Point, Rect, Result, LegacyBubbleShape } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import type { ShapePath } from '../geometry/types';
import { PANEL_STYLE } from '../domain/limits';
import { legacyBodyPath } from './body';
import { mangaBodyPath } from './handDrawn';
import { safeTextBox } from './safeTextBox';

export interface BubbleBodyOptions { handDrawn?: HandDrawnStyle | null; contour?: BubbleContour | null; edgeStyle?:BubbleEdgeStyle; freehandSource?:FreehandBubbleSource }

export interface BubbleGeometry { outline: ShapePath; tailLine: ShapePath | null; textBox: Rect }

export function bubbleBodyPath(shape: BubbleShape, w: number, h: number, style: BubbleStyle, options: BubbleBodyOptions = {}): ShapePath {
  if (!options.handDrawn && !options.contour && !options.edgeStyle?.wobble && ['rect', 'roundRect', 'circle', 'ellipse', 'cloud', 'spiky'].includes(shape)) return legacyBodyPath((shape==='ellipse'?'circle':shape) as LegacyBubbleShape, w, h, style);
  const result = mangaBodyPath({ shape, width: w, height: h, style, ...options });
  if (!result.ok) throw Error(result.problems.map(p => p.message).join('；'));
  return result.value;
}

function safeBox(shape: BubbleShape, w: number, h: number, radius: number): Rect {
  const padding = 12;
  const centerX = w / 2, centerY = h / 2;
  let halfW: number, halfH: number;
  if (shape === 'circle' || shape === 'ellipse') {
    halfW = w / (2 * Math.SQRT2) - padding;
    halfH = h / (2 * Math.SQRT2) - padding;
  } else if (shape === 'cloud' || shape === 'spiky') {
    const minR = shape === 'cloud' ? 0.92 / 1.08 : 0.76;
    halfW = w / 2 * minR / Math.SQRT2 - padding;
    halfH = h / 2 * minR / Math.SQRT2 - padding;
  } else {
    const inset = padding + (shape === 'roundRect' ? radius * (1 - 1 / Math.SQRT2) : 0);
    halfW = w / 2 - inset;
    halfH = h / 2 - inset;
  }
  return { x: centerX - Math.max(0, halfW), y: centerY - Math.max(0, halfH), width: Math.max(0, 2 * halfW), height: Math.max(0, 2 * halfH) };
}

function distPointLine(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return len < 1e-12 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs(dx * (a.y - p.y) - dy * (a.x - p.x)) / len;
}

function distPointSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const squared = dx * dx + dy * dy;
  if (squared < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / squared));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Sample curves to <=0.25 local-pixel chord error for tail arc-length traversal. */
export function flattenPath(path: ShapePath): Point[] {
  const out: Point[] = [];
  let current: Point | null = null;
  const append = (p: Point) => { if (out.length >= 8192) throw new RangeError('气泡轮廓超出几何预算'); out.push(p); };
  const cubic = (a: Point, b: Point, c: Point, d: Point, depth: number): void => {
    if (depth >= 12 || Math.max(distPointLine(b, a, d), distPointLine(c, a, d)) <= 0.25) { append(d); return; }
    const ab = mid(a, b), bc = mid(b, c), cd = mid(c, d), abc = mid(ab, bc), bcd = mid(bc, cd), m = mid(abc, bcd);
    cubic(a, ab, abc, m, depth + 1); cubic(m, bcd, cd, d, depth + 1);
  };
  for (const op of path.ops) {
    if (op.op === 'M') { current = op.p; append(op.p); }
    else if (op.op === 'L') { current = op.p; append(op.p); }
    else if (op.op === 'C' && current) { cubic(current, op.c1, op.c2, op.p, 0); current = op.p; }
    else if (op.op === 'Q' && current) {
      const c1 = { x: current.x + 2 / 3 * (op.control.x - current.x), y: current.y + 2 / 3 * (op.control.y - current.y) };
      const c2 = { x: op.p.x + 2 / 3 * (op.control.x - op.p.x), y: op.p.y + 2 / 3 * (op.control.y - op.p.y) };
      cubic(current, c1, c2, op.p, 0); current = op.p;
    }
  }
  if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < 1e-9) out.pop();
  return out;
}

function mid(a: Point, b: Point): Point { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

export function perimeter(points: Point[]): { positions: number[]; total: number } {
  const positions = [0];
  for (let i = 0; i < points.length; i++) positions.push(positions[i] + Math.hypot(points[(i + 1) % points.length].x - points[i].x, points[(i + 1) % points.length].y - points[i].y));
  return { positions, total: positions[positions.length - 1] };
}

export function atArc(points: Point[], positions: number[], total: number, distance: number): Point {
  const s = ((distance % total) + total) % total;
  let index = positions.findIndex((value, i) => i < positions.length - 1 && value <= s && s <= positions[i + 1]);
  if (index < 0) index = points.length - 1;
  const t = (s - positions[index]) / (positions[index + 1] - positions[index] || 1);
  const a = points[index], b = points[(index + 1) % points.length];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function pointInside(points: Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function buildBubble(shape: BubbleShape, w: number, h: number, style: BubbleStyle, tail: BubbleTail | null = null, options: BubbleBodyOptions = {}): Result<BubbleGeometry> {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 16 || h < 16 || w > 16384 || h > 16384) return fail(problem('bubble/size', '气泡宽高须在16～16384之间'));
  if (shape === 'circle' && Math.abs(w - h) > 1e-6) return fail(problem('bubble/circle', '圆形气泡宽高必须相等'));
  if (!Number.isFinite(style.radius) || style.radius < PANEL_STYLE.radius.min || style.radius > PANEL_STYLE.radius.max || !Number.isFinite(style.borderWidth) || style.borderWidth < PANEL_STYLE.borderWidth.min || style.borderWidth > PANEL_STYLE.borderWidth.max) return fail(problem('bubble/style', '气泡圆角须在0～4096、边框宽度须在0～256之间'));
  let body: ShapePath;
  try { body = bubbleBodyPath(shape, w, h, style, options); } catch(error) { return fail(problem('bubble/body', (error as Error).message)); }
  const newStyle = shape==='freehand' || !!options.handDrawn || !!options.contour || !!options.edgeStyle?.wobble || !!(style.innerStroke?.enabled&&style.innerStroke.width) || ['handOval', 'handPolygon', 'wave'].includes(shape);
  const inset=Math.max(style.borderWidth,2*(style.innerStroke?.enabled?style.innerStroke.width:0))*(1+(options.handDrawn?.pressure??0));
  const safe = newStyle ? safeTextBox(body,inset) : ok(safeBox(shape, w, h, Math.min(style.radius, w / 2, h / 2)));
  if (!safe.ok) return safe;
  const textBox = safe.value;
  if (!tail) return ok({ outline: body, tailLine: null, textBox });
  if (!Number.isFinite(tail.attachU) || tail.attachU < 0 || tail.attachU >= 1 || !Number.isFinite(tail.baseWidth) || !Number.isFinite(tail.tip.x) || !Number.isFinite(tail.tip.y)) return fail(problem('bubble/tail', '气泡尾部参数无效'));
  let points: Point[];
  try { points = flattenPath(body); } catch { return fail(problem('bubble/budget', '气泡轮廓超出几何预算')); }
  const { positions, total } = perimeter(points);
  if (tail.baseWidth < 4 || tail.baseWidth > Math.min(128, total * 0.2)) return fail(problem('bubble/tail-width', '尾部底座宽度超出范围'));
  const center = tail.attachU * total;
  const base = atArc(points, positions, total, center);
  const tipDistance = Math.min(...points.map((p, i) => distPointSegment(tail.tip, p, points[(i + 1) % points.length])));
  if (pointInside(points, tail.tip) || tipDistance < 4 || tipDistance > 4 * Math.max(w, h)) return fail(problem('bubble/tail-tip', '尾尖必须位于气泡外合理距离'));
  if (tail.kind === 'line') {
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if (!onSegment(a, b, base) && segmentsIntersect(base, tail.tip, a, b)) return fail(problem('bubble/tail-self-intersection', '尾线穿过气泡主体'));
    }
    return ok({ outline: body, tailLine: { ops: [{ op: 'M', p: base }, { op: 'L', p: tail.tip }], bounds: boundsOf([base, tail.tip]) }, textBox });
  }
  const half = tail.baseWidth / 2;
  const aDistance = center - half, bDistance = center + half;
  const a = atArc(points, positions, total, aDistance), b = atArc(points, positions, total, bDistance);
  const longArc: Point[] = [b];
  const start = ((bDistance % total) + total) % total;
  let end = ((aDistance % total) + total) % total;
  if (end <= start) end += total;
  const inner = points.map((p, i) => ({ p, s: positions[i] > start ? positions[i] : positions[i] + total }))
    .filter((item) => item.s > start && item.s < end).sort((one, two) => one.s - two.s);
  for (const item of inner) longArc.push(item.p);
  longArc.push(a, tail.tip);
  if (tailCrossesBody(longArc)) return fail(problem('bubble/tail-self-intersection', '尾部与气泡轮廓相交'));
  const ops: ShapePath['ops'] = longArc.map((p, i) => i === 0 ? { op: 'M', p } : { op: 'L', p });
  ops.push({ op: 'Z' });
  return ok({ outline: { ops, bounds: boundsOf(longArc) }, tailLine: null, textBox });
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return Math.abs(orientation(a, b, p)) < 1e-8 &&
    p.x >= Math.min(a.x, b.x) - 1e-8 && p.x <= Math.max(a.x, b.x) + 1e-8 &&
    p.y >= Math.min(a.y, b.y) - 1e-8 && p.y <= Math.max(a.y, b.y) + 1e-8;
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = orientation(a, b, c), abD = orientation(a, b, d);
  const cdA = orientation(c, d, a), cdB = orientation(c, d, b);
  if (abC * abD < -1e-8 && cdA * cdB < -1e-8) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

/** The body arc is simple; only the two new tail sides can introduce crossings. */
function tailCrossesBody(contour: Point[]): boolean {
  const n = contour.length;
  const tip = contour[n - 1], a = contour[n - 2], b = contour[0];
  for (let i = 0; i < n - 2; i++) {
    const c = contour[i], d = contour[i + 1];
    if (i !== n - 3 && segmentsIntersect(a, tip, c, d)) return true;
    if (i !== 0 && segmentsIntersect(tip, b, c, d)) return true;
  }
  return false;
}

function boundsOf(points: Point[]): Rect {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function bubbleContains(geometry: BubbleGeometry, point: Point): boolean {
  return pointInside(flattenPath(geometry.outline), point);
}
