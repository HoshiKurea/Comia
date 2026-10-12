/**
 * M03-T05：路径包围盒与描边扩展。
 * 先把所有控制点经 matrix 变换，再对曲线求页面轴极值。
 * 三次 Bézier 每轴 B(t)=(1-t)³p0+3(1-t)²t·p1+3(1-t)t²p2+t³p3；
 * 导数除3得 A·t²+B·t+C=0，A=-p0+3p1-3p2+p3, B=2(p0-2p1+p2), C=p1-p0。
 */
import type { Mat, Rect } from '../domain/types';
import { apply } from './matrix';
import type { ShapePath } from './types';

function extremumCubic(p0: number, p1: number, p2: number, p3: number, out: number[]): void {
  out.push(p0, p3);
  const A = -p0 + 3 * p1 - 3 * p2 + p3;
  const B = 2 * (p0 - 2 * p1 + p2);
  const C = p1 - p0;
  const EPS = 1e-12;
  if (Math.abs(A) < EPS) {
    if (Math.abs(B) < EPS) return; // 无内部极值
    const t = -C / B;
    if (t > 0 && t < 1) {
      out.push(cubicAt(p0, p1, p2, p3, t));
    }
    return;
  }
  const disc = B * B - 4 * A * C;
  if (disc < 0) return;
  const sq = Math.sqrt(disc);
  for (const t of [(-B + sq) / (2 * A), (-B - sq) / (2 * A)]) {
    if (t > 0 && t < 1) out.push(cubicAt(p0, p1, p2, p3, t));
  }
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/** 二次 Bézier 极值 t=(p0-p1)/(p0-2p1+p2) */
function extremumQuadratic(p0: number, p1: number, p2: number, out: number[]): void {
  out.push(p0, p2);
  const denom = p0 - 2 * p1 + p2;
  if (Math.abs(denom) < 1e-12) return;
  const t = (p0 - p1) / denom;
  if (t > 0 && t < 1) {
    const u = 1 - t;
    out.push(u * u * p0 + 2 * u * t * p1 + t * t * p2);
  }
}

/**
 * pathBounds：空路径返回 null（由调用方禁用尺寸柄）。
 * 分镜吸附忽略描边；缓存裁切必须扩描边（strokeExpand）。
 */
export function pathBounds(path: ShapePath, matrix: Mat): Rect | null {
  if (path.ops.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const xs: number[] = [];
  const ys: number[] = [];
  let current: { x: number; y: number } | null = null;

  for (const o of path.ops) {
    if (o.op === 'M' || o.op === 'L') {
      const p = apply(matrix, o.p);
      xs.push(p.x);
      ys.push(p.y);
      current = p;
    } else if (o.op === 'Q') {
      if (!current) return null;
      const c = apply(matrix, o.control);
      const p = apply(matrix, o.p);
      extremumQuadratic(current.x, c.x, p.x, xs);
      extremumQuadratic(current.y, c.y, p.y, ys);
      current = p;
    } else if (o.op === 'C') {
      if (!current) return null;
      const c1 = apply(matrix, o.c1);
      const c2 = apply(matrix, o.c2);
      const p = apply(matrix, o.p);
      extremumCubic(current.x, c1.x, c2.x, p.x, xs);
      extremumCubic(current.y, c1.y, c2.y, p.y, ys);
      current = p;
    }
    // 'Z' 无点
  }
  for (const x of xs) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  for (const y of ys) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function unionBounds(bounds: Rect[]): Rect | null {
  let result: Rect | null = null;
  for (const b of bounds) {
    if (!result) {
      result = { ...b };
      continue;
    }
    const x = Math.min(result.x, b.x);
    const y = Math.min(result.y, b.y);
    result = {
      x,
      y,
      width: Math.max(result.x + result.width, b.x + b.width) - x,
      height: Math.max(result.y + result.height, b.y + b.height) - y,
    };
  }
  return result;
}

/**
 * 描边扩展保守半径：r=(strokeWidth/2)*sqrt(a²+b²+c²+d²)+2CSSpx。
 * Frobenius 范数是最大伸缩的上界（矩阵包含 viewport 时同样适用）。
 */
export function strokeExpand(bounds: Rect, matrix: Mat, strokeWidth: number, cssPadding = 2): Rect {
  const [a, b, c, d] = matrix;
  const r = (strokeWidth / 2) * Math.sqrt(a * a + b * b + c * c + d * d) + cssPadding;
  return {
    x: bounds.x - r,
    y: bounds.y - r,
    width: bounds.width + 2 * r,
    height: bounds.height + 2 * r,
  };
}
