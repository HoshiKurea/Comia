/**
 * M03-T03：半平面裁切。只用于凸分镜与安全区，不承诺一般多边形布尔运算。
 * 对边 S→E，ds=n·S-c; de=n·E-c。inside 为 d≤eps。
 */
import type { Point } from '../domain/types';
import { cross } from './polygon';
import type { HalfPlane } from './types';

/**
 * clipHalfPlane：输出按输入顺序，合并容差内重复点、删近共线点；
 * <3 顶点或面积过小返回空。normal 必须非零且先归一化。
 */
export function clipHalfPlane(poly: Point[], plane: HalfPlane): Point[] {
  // 规格约定 n·p <= offset；normal 防御性归一化，offset 同步缩放保持半平面语义不变
  const len = Math.hypot(plane.normal.x, plane.normal.y);
  if (len < 1e-12) return [];
  const n = { x: plane.normal.x / len, y: plane.normal.y / len };
  const offset = plane.offset / len;
  const count = poly.length;
  if (count < 3) return [];

  // 面积/长度容差：取几何尺度
  let diag = 0;
  for (const p of poly) diag = Math.max(diag, Math.abs(p.x), Math.abs(p.y));
  const eps = 1e-8 * Math.max(1, diag);

  const out: Point[] = [];
  for (let i = 0; i < count; i++) {
    const S = poly[i];
    const E = poly[(i + 1) % count];
    const ds = n.x * S.x + n.y * S.y - offset;
    const de = n.x * E.x + n.y * E.y - offset;
    const sIn = ds <= eps;
    const eIn = de <= eps;
    if (sIn) out.push(S);
    if (sIn !== eIn) {
      const denom = ds - de;
      if (Math.abs(denom) < eps) {
        // 平行边：只保留内侧端点，不产生 NaN
        continue;
      }
      const t = ds / denom;
      out.push({ x: S.x + t * (E.x - S.x), y: S.y + t * (E.y - S.y) });
    }
  }

  return cleanClipResult(out, eps);
}

function cleanClipResult(points: Point[], eps: number): Point[] {
  if (points.length < 3) return [];
  // 合并容差内重复点
  const dedup: Point[] = [];
  for (const p of points) {
    const prev = dedup[dedup.length - 1];
    if (prev && Math.hypot(prev.x - p.x, prev.y - p.y) <= Math.max(eps, 1e-9)) continue;
    dedup.push(p);
  }
  while (dedup.length > 1 && Math.hypot(dedup[0].x - dedup[dedup.length - 1].x, dedup[0].y - dedup[dedup.length - 1].y) <= Math.max(eps, 1e-9)) {
    dedup.pop();
  }
  if (dedup.length < 3) return [];
  // 删近共线点
  const out: Point[] = [...dedup];
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const prev = out[(i - 1 + out.length) % out.length];
      const cur = out[i];
      const next = out[(i + 1) % out.length];
      const c = cross({ x: cur.x - prev.x, y: cur.y - prev.y }, { x: next.x - cur.x, y: next.y - cur.y });
      const base = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      if (Math.abs(c) <= Math.max(eps, 1e-9) * Math.max(1, base)) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out.length >= 3 ? out : [];
}

/**
 * 双侧切割（M07-T05 使用）：左子 = clip(P, {n:(1,0), offset:c-gap/2}) 形式由调用方给出。
 * 这里提供按轴的便捷包装，坐标为分镜局部坐标。
 */
export function clipAlongVertical(poly: Point[], cutX: number, gap: number, side: 'left' | 'right'): Point[] {
  if (side === 'left') {
    return clipHalfPlane(poly, { normal: { x: 1, y: 0 }, offset: cutX - gap / 2 });
  }
  return clipHalfPlane(poly, { normal: { x: -1, y: 0 }, offset: -(cutX + gap / 2) });
}

export function clipAlongHorizontal(poly: Point[], cutY: number, gap: number, side: 'top' | 'bottom'): Point[] {
  if (side === 'top') {
    return clipHalfPlane(poly, { normal: { x: 0, y: 1 }, offset: cutY - gap / 2 });
  }
  return clipHalfPlane(poly, { normal: { x: 0, y: -1 }, offset: -(cutY + gap / 2) });
}
