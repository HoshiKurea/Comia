/**
 * M03-T02：凸性、面积、命中与无效编辑约束。
 * 顶点按屏幕顺时针（y 向下），数学 signedArea 正；顶点数 3～64。
 * epsilon 使用 1e-8*max(1,bbox对角线) 距离量；叉积阈值用 epsilon×相应边长。
 */
import type { Point, Rect, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import type { GeometryPolicy, PolygonMetrics } from './types';

export const MAX_POLY_VERTS = 64;
export const MIN_POLY_VERTS = 3;

export function cross(u: Point, v: Point): number {
  return u.x * v.y - u.y * v.x;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function polyBounds(points: Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function bboxDiagonal(points: Point[]): number {
  const b = polyBounds(points);
  return Math.hypot(b.width, b.height);
}

/** epsilon 距离量：1e-8*max(1,bbox对角线) */
export function polygonEpsilon(points: Point[]): number {
  return 1e-8 * Math.max(1, bboxDiagonal(points));
}

/**
 * metrics：A=Σcross(pi,p(i+1))/2；C=Σ(pi+p(i+1))*cross(pi,p(i+1))/(6A)。
 * 零面积多边形返回失败。
 */
export function metrics(points: Point[]): Result<PolygonMetrics> {
  if (points.length < MIN_POLY_VERTS) {
    return fail(problem('polygon/too-few-verts', `多边形至少 ${MIN_POLY_VERTS} 个顶点，收到 ${points.length}`));
  }
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const c = cross(p, q);
    area2 += c;
    cx += (p.x + q.x) * c;
    cy += (p.y + q.y) * c;
  }
  const signedArea = area2 / 2;
  const bounds = polyBounds(points);
  if (!Number.isFinite(signedArea) || Math.abs(signedArea) < 1e-12) {
    return fail(problem('polygon/degenerate', '多边形面积为 0（退化）', `bounds=${bounds.width}x${bounds.height}`));
  }
  return ok({
    signedArea,
    centroid: { x: cx / (6 * signedArea), y: cy / (6 * signedArea) },
    bounds,
  });
}

/** 线段严格相交（含共线触碰）；共享端点的不算（由调用方排除邻接） */
export function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point, eps: number): boolean {
  const d1 = cross({ x: a2.x - a1.x, y: a2.y - a1.y }, { x: b1.x - a1.x, y: b1.y - a1.y });
  const d2 = cross({ x: a2.x - a1.x, y: a2.y - a1.y }, { x: b2.x - a1.x, y: b2.y - a1.y });
  const d3 = cross({ x: b2.x - b1.x, y: b2.y - b1.y }, { x: a1.x - b1.x, y: a1.y - b1.y });
  const d4 = cross({ x: b2.x - b1.x, y: b2.y - b1.y }, { x: a2.x - b1.x, y: a2.y - b1.y });
  const e = eps * Math.max(1, dist(a1, a2), dist(b1, b2));
  if (((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e))) {
    return true;
  }
  // 共线触碰：任一端点落在另一线段上
  const onSeg = (p: Point, q1: Point, q2: Point): boolean => {
    const crossVal = Math.abs(cross({ x: q2.x - q1.x, y: q2.y - q1.y }, { x: p.x - q1.x, y: p.y - q1.y }));
    if (crossVal > e) return false;
    const dot = (p.x - q1.x) * (q2.x - q1.x) + (p.y - q1.y) * (q2.y - q1.y);
    if (dot < -e) return false;
    const len2 = (q2.x - q1.x) ** 2 + (q2.y - q1.y) ** 2;
    return dot <= len2 + e;
  };
  return onSeg(b1, a1, a2) || onSeg(b2, a1, a2) || onSeg(a1, b1, b2) || onSeg(a2, b1, b2);
}

/**
 * 凸性校验：每条边对所有非邻点 cross(edge, p-pi)*sign > -eps*|edge|，
 * 至少三个非共线点，且非邻边无交叉。
 * 相邻边同向共线（近共线顶点）按顶点数与 minEdge 校验另行处理。
 */
export function validateConvex(points: Point[], policy: GeometryPolicy): Result<void> {
  if (points.length < MIN_POLY_VERTS || points.length > MAX_POLY_VERTS) {
    return fail(
      problem('polygon/vert-count', `顶点数须在 ${MIN_POLY_VERTS}～${MAX_POLY_VERTS}，收到 ${points.length}`),
    );
  }
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      return fail(problem('polygon/nonfinite', '顶点坐标必须为有限数值'));
    }
  }
  const eps = Math.max(policy.epsilon, polygonEpsilon(points));
  const m = metrics(points);
  if (!m.ok) return m;
  const sign = m.value.signedArea >= 0 ? 1 : -1;
  const n = points.length;

  // 非共线点数 ≥3：找一条明显非零的叉积链
  let nonzero = 0;
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const cur = points[i];
    const next = points[(i + 1) % n];
    const c = cross({ x: cur.x - prev.x, y: cur.y - prev.y }, { x: next.x - cur.x, y: next.y - cur.y });
    if (Math.abs(c) > eps * Math.max(1, dist(prev, cur))) nonzero++;
  }
  if (nonzero < 3) {
    return fail(problem('polygon/collinear', '多边形至少需要三个非共线顶点'));
  }

  // 每条边对所有非邻点的内侧检查
  for (let i = 0; i < n; i++) {
    const s = points[i];
    const e = points[(i + 1) % n];
    const edgeLen = dist(s, e);
    if (edgeLen < policy.minEdge - eps) {
      return fail(problem('polygon/edge-too-short', `边长 ${edgeLen.toFixed(3)} 低于最小值 ${policy.minEdge}px`));
    }
    const ex = e.x - s.x;
    const ey = e.y - s.y;
    for (let j = 0; j < n; j++) {
      if (j === i || j === (i + 1) % n) continue;
      const p = points[j];
      const c = cross({ x: ex, y: ey }, { x: p.x - s.x, y: p.y - s.y }) * sign;
      if (c < -eps * Math.max(1, edgeLen)) {
        return fail(problem('polygon/non-convex', `顶点 ${j} 位于边 ${i} 外侧，多边形不是凸形`));
      }
    }
  }

  // 非邻边无交叉
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i || j === (i + 1) % n || (j + 1) % n === i;
      if (adjacent) continue;
      const hit = segmentsIntersect(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n], eps);
      if (hit) {
        return fail(problem('polygon/self-intersect', `边 ${i} 与边 ${j} 相交（自交）`));
      }
    }
  }

  if (Math.abs(m.value.signedArea) < policy.minArea) {
    return fail(problem('polygon/area-too-small', `面积 ${Math.abs(m.value.signedArea).toFixed(3)}px² 低于最小值 ${policy.minArea}px²`));
  }
  return ok(undefined);
}

/** 命中：所有叉积 ≥负容差；容差点算内侧。兼容两种顶点方向。 */
export function containsConvex(points: Point[], p: Point, tolerance = 0): boolean {
  const n = points.length;
  if (n < 3) return false;
  const m = metrics(points);
  if (!m.ok) return false;
  const sign = m.value.signedArea >= 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const s = points[i];
    const e = points[(i + 1) % n];
    const c = cross({ x: e.x - s.x, y: e.y - s.y }, { x: p.x - s.x, y: p.y - s.y }) * sign;
    if (c < -tolerance * Math.hypot(e.x - s.x, e.y - s.y)) return false;
  }
  return true;
}

/** 多边形周长（气泡尾 baseWidth 上限用） */
export function perimeter(points: Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    total += dist(points[i], points[(i + 1) % points.length]);
  }
  return total;
}

function isValid(points: Point[], policy: GeometryPolicy): boolean {
  return validateConvex(points, policy).ok;
}

function lerpPoly(a: Point[], b: Point[], t: number): Point[] {
  return a.map((p, i) => ({
    x: p.x + (b[i].x - p.x) * t,
    y: p.y + (b[i].y - p.y) * t,
  }));
}

/** Include interior minima so a short invalid interval cannot hide between
 * the 1/32 samples. Each vertex is p(t)=p0+t*d. Edge length squared, signed
 * area and convex half-plane crosses are quadratic functions of t. */
function editSampleTimes(start: Point[], candidate: Point[], winding: number): number[] {
  const times = new Set(Array.from({ length: 32 }, (_, i) => (i + 1) / 32));
  const delta = candidate.map((p, i) => ({ x: p.x - start[i].x, y: p.y - start[i].y }));
  const addMinimum = (quadratic: number, linear: number) => {
    if (quadratic <= 0) return;
    const t = -linear / (2 * quadratic);
    if (t > 0 && t < 1 && Number.isFinite(t)) times.add(t);
  };
  let areaQuadratic = 0, areaLinear = 0;
  for (let i = 0; i < start.length; i++) {
    const next = (i + 1) % start.length, a = start[i], b = start[next], da = delta[i], db = delta[next];
    const edge = { x: b.x - a.x, y: b.y - a.y }, change = { x: db.x - da.x, y: db.y - da.y };
    addMinimum(change.x ** 2 + change.y ** 2, 2 * (edge.x * change.x + edge.y * change.y));
    areaQuadratic += cross(da, db) * winding;
    areaLinear += (cross(da, b) + cross(a, db)) * winding;
    for (let j = 0; j < start.length; j++) {
      if (j === i || j === next) continue;
      const gap = { x: start[j].x - a.x, y: start[j].y - a.y }, gapChange = { x: delta[j].x - da.x, y: delta[j].y - da.y };
      addMinimum(cross(change, gapChange) * winding, (cross(change, gap) + cross(edge, gapChange)) * winding);
    }
  }
  addMinimum(areaQuadratic, areaLinear);
  return [...times].sort((a, b) => a - b);
}

/**
 * 候选无效时沿 p(t)=start+t*(candidate-start) 取最大有效 t：
 * 先按1/32及边长/面积/凸性二次函数内部极值扫描，首次无效后24次二分；
 * 编辑保持起始绕序，即使候选反向三角形本身凸，也不能越过零面积。
 * 不能二分跨过凹形区间去另一个有效形状。
 * 无有效前进时返回起点（调用方提示最小尺寸/凸形约束）。
 */
export function constrainCandidate(start: Point[], candidate: Point[], policy: GeometryPolicy): Point[] {
  if (start.length !== candidate.length) return start;
  if (!isValid(start, policy)) return start;
  if (!candidate.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return start;
  const initial = metrics(start); if (!initial.ok) return start;
  const winding = Math.sign(initial.value.signedArea);
  const validEdit = (points: Point[]) => {
    const measure = metrics(points);
    return measure.ok && measure.value.signedArea * winding > 0 && isValid(points, policy);
  };
  let lastValid = 0;
  let firstInvalid = -1;
  for (const t of editSampleTimes(start, candidate, winding)) {
    if (!validEdit(lerpPoly(start, candidate, t))) {
      firstInvalid = t;
      break;
    }
    lastValid = t;
  }
  if (firstInvalid < 0) return candidate;
  // 二分 [lastValid, firstInvalid) 找最大有效 t
  let lo = lastValid;
  let hi = firstInvalid;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (validEdit(lerpPoly(start, candidate, mid))) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  if (lo <= 0) return start;
  return lerpPoly(start, candidate, lo);
}

/**
 * 导入清理：清除相邻重复点和近共线点后重新验证。
 * 不可任意排序顶点修复自交；清理后顶点不足返回 null。
 */
export function cleanPolygon(points: Point[], policy: GeometryPolicy): Point[] | null {
  const eps = Math.max(policy.epsilon, polygonEpsilon(points));
  const out: Point[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && dist(prev, p) <= Math.max(eps, 1e-6)) continue;
    out.push({ x: p.x, y: p.y });
  }
  // 首尾重复
  while (out.length > 1 && dist(out[0], out[out.length - 1]) <= Math.max(eps, 1e-6)) out.pop();
  // 近共线顶点
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const prev = out[(i - 1 + out.length) % out.length];
      const cur = out[i];
      const next = out[(i + 1) % out.length];
      const c = cross({ x: cur.x - prev.x, y: cur.y - prev.y }, { x: next.x - cur.x, y: next.y - cur.y });
      const base = dist(prev, cur);
      if (Math.abs(c) <= eps * Math.max(1, base)) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out.length >= 3 ? out : null;
}
