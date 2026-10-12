/**
 * M03-T01：四空间变换与完整仿射运算。
 * 禁止读取 Konva 节点 transform 作为持久化真值；所有拖拽以手势起始矩阵推导。
 */
import type { Mat, Point, Project, Rect, Result, Viewport } from '../domain/types';
import { fail, ok, problem } from '../domain/types';

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** A*B（按列主序记法 [a,b,c,d,e,f] 的行向量公式见规格） */
export function multiply(A: Mat, B: Mat): Mat {
  const [Aa, Ab, Ac, Ad, Ae, Af] = A;
  const [Ba, Bb, Bc, Bd, Be, Bf] = B;
  return [
    Aa * Ba + Ac * Bb,
    Ab * Ba + Ad * Bb,
    Aa * Bc + Ac * Bd,
    Ab * Bc + Ad * Bd,
    Aa * Be + Ac * Bf + Ae,
    Ab * Be + Ad * Bf + Af,
  ];
}

export function determinant(M: Mat): number {
  return M[0] * M[3] - M[1] * M[2];
}

export function inverse(M: Mat): Result<Mat> {
  const det = determinant(M);
  if (!(det > 1e-8)) {
    return fail(problem('matrix/singular', `矩阵不可逆（det=${det}），不允许奇异或反射矩阵`));
  }
  const [a, b, c, d, e, f] = M;
  return ok([d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]);
}

export function apply(M: Mat, p: Point): Point {
  return {
    x: M[0] * p.x + M[2] * p.y + M[4],
    y: M[1] * p.x + M[3] * p.y + M[5],
  };
}

export function translation(tx: number, ty: number): Mat {
  return [1, 0, 0, 1, tx, ty];
}

export function scaling(sx: number, sy: number): Mat {
  return [sx, 0, 0, sy, 0, 0];
}

/** 弧度旋转。角度 UI 用度，内部函数用弧度 */
export function rotationRad(rad: number): Mat {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
}

export function translationScale(tx: number, ty: number, sx: number, sy: number): Mat {
  return [sx, 0, 0, sy, tx, ty];
}

/** world(id)=world(parent)*local(id); world(rootParent)=I */
export function worldMatrix(project: Project, id: string): Mat {
  const layer = project.layers[id];
  if (!layer) return IDENTITY;
  if (layer.parentId === null) return layer.matrix;
  return multiply(worldMatrix(project, layer.parentId), layer.matrix);
}

/**
 * 属性分解用于显示/旋转（M03-T01）：
 * sx=hypot(a,b); θ=atan2(b,a); sy=det/sx; k=(a*c+b*d)/(sx*sy)
 * 线性部分 R(θ)*[[sx,k*sy],[0,sy]]。不把 hypot(c,d) 误当 sy。
 */
export interface Decomposed {
  sx: number;
  sy: number;
  /** 局部 x 轴相对父坐标轴的角度（弧度） */
  thetaRad: number;
  k: number;
}

export function decompose(M: Mat): Decomposed {
  const [a, b, c, d] = M;
  const sx = Math.hypot(a, b);
  const det = a * d - b * c;
  const sy = sx === 0 ? 0 : det / sx;
  const k = sx === 0 || sy === 0 ? 0 : (a * c + b * d) / (sx * sy);
  return { sx, sy, thetaRad: Math.atan2(b, a), k };
}

/** 屏幕空间矩阵：T(pan)*Sc(zoom)*W */
export function screenMatrix(project: Project, id: string, viewport: Viewport): Mat {
  return multiply(
    translationScale(viewport.pan.x, viewport.pan.y, viewport.zoom, viewport.zoom),
    worldMatrix(project, id),
  );
}

/** s=(clientX-rect.left,clientY-rect.top) CSS px，不乘 DPR；p=(s-pan)/zoom */
export function clientToPage(
  client: Point,
  canvasRect: { left: number; top: number },
  viewport: Viewport,
): Point {
  const sx = client.x - canvasRect.left;
  const sy = client.y - canvasRect.top;
  return {
    x: (sx - viewport.pan.x) / viewport.zoom,
    y: (sy - viewport.pan.y) / viewport.zoom,
  };
}

/** 页面点 → 屏幕 CSS px */
export function pageToScreen(p: Point, viewport: Viewport): Point {
  return {
    x: viewport.pan.x + viewport.zoom * p.x,
    y: viewport.pan.y + viewport.zoom * p.y,
  };
}

/** local=inverse(world)*p */
export function pageToLocal(project: Project, id: string, p: Point): Result<Point> {
  const inv = inverse(worldMatrix(project, id));
  if (!inv.ok) return inv;
  return ok(apply(inv.value, p));
}

/** 局部点 → 页面点 */
export function localToPage(project: Project, id: string, p: Point): Point {
  return apply(worldMatrix(project, id), p);
}

/** 围绕父坐标 pivot 的旋转合成：T(pivot)*R(Δ)*T(-pivot) 再乘原矩阵 */
export function rotateAroundMatrix(pivot: Point, deltaRad: number, M: Mat): Mat {
  const R = rotationRad(deltaRad);
  return multiply(multiply(multiply(translation(pivot.x, pivot.y), R), translation(-pivot.x, -pivot.y)), M);
}

/** 围绕父坐标 anchor 的非等比缩放合成：T(anchor)*S(kx,ky)*T(-anchor) */
export function scaleAroundMatrix(anchor: Point, kx: number, ky: number, M: Mat): Mat {
  return multiply(
    multiply(multiply(translation(anchor.x, anchor.y), scaling(kx, ky)), translation(-anchor.x, -anchor.y)),
    M,
  );
}

/** 矩形四角经矩阵变换 */
export function rectCorners(r: Rect, M: Mat): Point[] {
  return [
    apply(M, { x: r.x, y: r.y }),
    apply(M, { x: r.x + r.width, y: r.y }),
    apply(M, { x: r.x + r.width, y: r.y + r.height }),
    apply(M, { x: r.x, y: r.y + r.height }),
  ];
}

/** 数值有限校验（NaN/Infinity 不能当成 0） */
export function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

export function isFiniteMat(M: Mat): boolean {
  return M.every((v) => Number.isFinite(v));
}
