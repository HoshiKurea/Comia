/**
 * M03-T04：共享圆角路径。供分镜填充、描边、图片裁剪、导出、命中共同使用；
 * 禁止 clip 使用直边但描边使用圆角。仅用于凸顶点。
 * 圆弧用三次 Bézier 表达：转角 β=π-α; h=4/3*tan(β/4)*ri。
 */
import type { Point, Rect } from '../domain/types';
import type { ShapePath } from './types';

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalize(v: Point): Point {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-12) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * buildRoundedPolygon：顶点 V 的单位向量 u=(prev-V)/|prev-V|, v=(next-V)/|next-V|，
 * 内角 α=acos(clamp(dot(u,v),-1,1))，初始切点距离 di=r/tan(α/2)；
 * 近 π 直接保留直线。为避免相邻切点相交，统一 λ=min(1,min_edge(edgeLength/(di+dnext)))
 * （分母 0 跳过），令 di*=λ。切点 A=V+u*di，B=V+v*di；有效半径 ri=di*tan(α/2)，
 * 圆心 O=V+normalize(u+v)*ri/sin(α/2)。r=0 输出折线。
 */
export function buildRoundedPolygon(poly: Point[], radius: number): ShapePath {
  const n = poly.length;
  const bounds = pathBoundsOf(poly, radius);
  if (n < 3 || radius <= 0) {
    return { ops: polylineOps(poly), bounds };
  }

  // 每个顶点的初始切点距离
  const di: number[] = new Array(n).fill(0);
  const angles: number[] = new Array(n).fill(Math.PI);
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const cur = poly[i];
    const next = poly[(i + 1) % n];
    const u = normalize({ x: prev.x - cur.x, y: prev.y - cur.y });
    const v = normalize({ x: next.x - cur.x, y: next.y - cur.y });
    const dot = clamp(u.x * v.x + u.y * v.y, -1, 1);
    const alpha = Math.acos(dot); // 内角
    angles[i] = alpha;
    // 近 π 直接保留直线：α 接近 π 时 tan(α/2) 巨大，切点距离自然极小；
    // 显式处理 α > π - 0.05 为直线顶点
    if (alpha >= Math.PI - 0.05) {
      di[i] = 0;
    } else if (alpha <= 1e-9) {
      di[i] = 0; // 0° 角无法圆角，保留直线
    } else {
      di[i] = radius / Math.tan(alpha / 2);
    }
  }

  // 统一 λ：min(1, min_edge(edgeLength/(di+dnext)))，分母 0 跳过
  let lam = 1;
  for (let i = 0; i < n; i++) {
    const edgeLen = dist(poly[i], poly[(i + 1) % n]);
    const denom = di[i] + di[(i + 1) % n];
    if (denom > 1e-12) {
      lam = Math.min(lam, edgeLen / denom);
    }
  }
  for (let i = 0; i < n; i++) di[i] *= lam;

  const ops: ShapePath['ops'] = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const cur = poly[i];
    const next = poly[(i + 1) % n];
    const u = normalize({ x: prev.x - cur.x, y: prev.y - cur.y });
    const v = normalize({ x: next.x - cur.x, y: next.y - cur.y });
    const alpha = angles[i];
    if (di[i] <= 1e-9 || alpha >= Math.PI - 0.05 || alpha <= 1e-9) {
      if (ops.length === 0) ops.push({ op: 'M', p: cur });
      else ops.push({ op: 'L', p: cur });
      continue;
    }
    const A = { x: cur.x + u.x * di[i], y: cur.y + u.y * di[i] };
    const B = { x: cur.x + v.x * di[i], y: cur.y + v.y * di[i] };
    const ri = di[i] * Math.tan(alpha / 2);
    const beta = Math.PI - alpha; // 转角
    const h = (4 / 3) * Math.tan(beta / 4) * ri;
    // A 的前进切向 = -u 的法向旋转？前进切向：沿多边形方向的切线 = normalize(v - u 的角平分…)。
    // 从 A 到 B 的短圆弧：A 处切向 = A 相对圆心方向旋转 90°（沿弧方向）。
    const O = {
      x: cur.x + normalize({ x: u.x + v.x, y: u.y + v.y }).x * (ri / Math.sin(alpha / 2)),
      y: cur.y + normalize({ x: u.x + v.x, y: u.y + v.y }).y * (ri / Math.sin(alpha / 2)),
    };
    // A 处前进切向 = rotate90(O - A)（顺时针多边形，弧沿多边形方向）
    const rA = normalize({ x: O.x - A.x, y: O.y - A.y });
    const tA = { x: -rA.y, y: rA.x };
    const rB = normalize({ x: O.x - B.x, y: O.y - B.y });
    const tB = { x: -rB.y, y: rB.x };
    // 验证切向朝向：前进方向应与 u→v 的转向一致；若与 A→B 方向相反则翻转
    const abDir = { x: B.x - A.x, y: B.y - A.y };
    if (tA.x * abDir.x + tA.y * abDir.y < 0) {
      tA.x = -tA.x;
      tA.y = -tA.y;
      tB.x = -tB.x;
      tB.y = -tB.y;
    }
    const c1 = { x: A.x + tA.x * h, y: A.y + tA.y * h };
    const c2 = { x: B.x + tB.x * h, y: B.y + tB.y * h };
    if (ops.length === 0) ops.push({ op: 'M', p: A });
    else ops.push({ op: 'L', p: A });
    ops.push({ op: 'C', c1, c2, p: B });
  }
  ops.push({ op: 'Z' });
  return { ops, bounds };
}

function polylineOps(poly: Point[]): ShapePath['ops'] {
  const ops: ShapePath['ops'] = [];
  for (let i = 0; i < poly.length; i++) {
    ops.push(i === 0 ? { op: 'M', p: poly[i] } : { op: 'L', p: poly[i] });
  }
  ops.push({ op: 'Z' });
  return ops;
}

function pathBoundsOf(poly: Point[], radius: number): Rect {
  if (radius <= 0 || poly.length < 3) {
    return boundsOfPoints(poly);
  }
  // 圆角只在原多边形内部收缩，保守取顶点 bounds 不足——角部圆弧在内，
  // 顶点 bounds 恒为外接，足够（rounded 路径不会超出原凸多边形）。
  return boundsOfPoints(poly);
}

export function boundsOfPoints(points: Point[]): Rect {
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
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 矩形圆角路径（气泡 roundRect / 命中共用） */
export function buildRoundedRect(r: Rect, radius: number): ShapePath {
  const rr = Math.max(0, Math.min(radius, Math.min(r.width, r.height) / 2));
  if (rr <= 0) {
    return {
      ops: [
        { op: 'M', p: { x: r.x, y: r.y } },
        { op: 'L', p: { x: r.x + r.width, y: r.y } },
        { op: 'L', p: { x: r.x + r.width, y: r.y + r.height } },
        { op: 'L', p: { x: r.x, y: r.y + r.height } },
        { op: 'Z' },
      ],
      bounds: { ...r },
    };
  }
  const k = 0.5522847498307936; // 4/3*tan(π/8)
  const x0 = r.x;
  const y0 = r.y;
  const x1 = r.x + r.width;
  const y1 = r.y + r.height;
  const ops: ShapePath['ops'] = [
    { op: 'M', p: { x: x0 + rr, y: y0 } },
    { op: 'L', p: { x: x1 - rr, y: y0 } },
    { op: 'C', c1: { x: x1 - rr + k * rr, y: y0 }, c2: { x: x1, y: y0 + rr - k * rr }, p: { x: x1, y: y0 + rr } },
    { op: 'L', p: { x: x1, y: y1 - rr } },
    { op: 'C', c1: { x: x1, y: y1 - rr + k * rr }, c2: { x: x1 - rr + k * rr, y: y1 }, p: { x: x1 - rr, y: y1 } },
    { op: 'L', p: { x: x0 + rr, y: y1 } },
    { op: 'C', c1: { x: x0 + rr - k * rr, y: y1 }, c2: { x: x0, y: y1 - rr + k * rr }, p: { x: x0, y: y1 - rr } },
    { op: 'L', p: { x: x0, y: y0 + rr } },
    { op: 'C', c1: { x: x0, y: y0 + rr - k * rr }, c2: { x: x0 + rr - k * rr, y: y0 }, p: { x: x0 + rr, y: y0 } },
    { op: 'Z' },
  ];
  return { ops, bounds: { ...r } };
}

/** 椭圆/圆路径：circle 用 4 段圆弧三次 Bézier，系数 4/3*tan(π/8)（M10-T01） */
export function buildEllipse(cx: number, cy: number, a: number, b: number): ShapePath {
  const k = 0.5522847498307936;
  const ops: ShapePath['ops'] = [
    { op: 'M', p: { x: cx + a, y: cy } },
    { op: 'C', c1: { x: cx + a, y: cy + k * b }, c2: { x: cx + k * a, y: cy + b }, p: { x: cx, y: cy + b } },
    { op: 'C', c1: { x: cx - k * a, y: cy + b }, c2: { x: cx - a, y: cy + k * b }, p: { x: cx - a, y: cy } },
    { op: 'C', c1: { x: cx - a, y: cy - k * b }, c2: { x: cx - k * a, y: cy - b }, p: { x: cx, y: cy - b } },
    { op: 'C', c1: { x: cx + k * a, y: cy - b }, c2: { x: cx + a, y: cy - k * b }, p: { x: cx + a, y: cy } },
    { op: 'Z' },
  ];
  return {
    ops,
    bounds: { x: cx - a, y: cy - b, width: 2 * a, height: 2 * b },
  };
}

/** 把路径起点平移到 (dx,dy)（整体平移所有 ops 点） */
export function translatePath(path: ShapePath, dx: number, dy: number): ShapePath {
  const shift = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  const ops = path.ops.map((o) => {
    switch (o.op) {
      case 'M':
      case 'L':
        return { op: o.op, p: shift(o.p) };
      case 'Q':
        return { op: 'Q' as const, control: shift(o.control), p: shift(o.p) };
      case 'C':
        return { op: 'C' as const, c1: shift(o.c1), c2: shift(o.c2), p: shift(o.p) };
      default:
        return o;
    }
  });
  return {
    ops,
    bounds: {
      x: path.bounds.x + dx,
      y: path.bounds.y + dy,
      width: path.bounds.width,
      height: path.bounds.height,
    },
  };
}
