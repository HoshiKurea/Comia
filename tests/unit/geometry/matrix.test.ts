import { describe, expect, it } from 'vitest';
import {
  apply,
  clientToPage,
  decompose,
  determinant,
  IDENTITY,
  inverse,
  multiply,
  pageToScreen,
  rotationRad,
  scaling,
  translation,
  worldMatrix,
} from '../../../src/geometry/matrix';
import { createLayer } from '../../../src/domain/factories';
import { createContentProject as createProject } from '../../helpers/contentProject';
import { ok } from '../../../src/domain/types';
import type { Project } from '../../../src/domain/types';

const TOL = 1e-6;

describe('M03-T01 矩阵运算', () => {
  it('单位矩阵乘法', () => {
    expect(multiply(IDENTITY, IDENTITY)).toEqual([...IDENTITY]);
  });

  it('矩阵乘法符合行向量公式', () => {
    const A = translation(10, 20);
    const B = rotationRad(Math.PI / 6);
    const M = multiply(A, B);
    // apply(M, p) 应先旋转再平移
    const p = { x: 1, y: 0 };
    const r = apply(M, p);
    expect(r.x).toBeCloseTo(10 + Math.cos(Math.PI / 6), TOL);
    expect(r.y).toBeCloseTo(20 + Math.sin(Math.PI / 6), TOL);
  });

  it('逆矩阵往返 1e-6 误差', () => {
    const M = multiply(multiply(translation(5, -3), rotationRad(0.7)), scaling(2, 3));
    const inv = inverse(M);
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;
    const p = { x: 12.34, y: -56.78 };
    const rt = apply(inv.value, apply(M, p));
    expect(Math.abs(rt.x - p.x)).toBeLessThan(TOL);
    expect(Math.abs(rt.y - p.y)).toBeLessThan(TOL);
  });

  it('乘逆恢复原矩阵', () => {
    const M = multiply(multiply(translation(1, 2), rotationRad(-1.2)), scaling(0.5, 1.5));
    const inv = inverse(M);
    if (!inv.ok) throw new Error('不可逆');
    const rt = multiply(M, inv.value);
    rt.forEach((v, i) => expect(v).toBeCloseTo(IDENTITY[i], TOL));
  });

  it('奇异矩阵与反射矩阵拒绝', () => {
    expect(inverse([1, 2, 2, 4, 0, 0]).ok).toBe(false); // det=0
    expect(inverse([-1, 0, 0, 1, 0, 0]).ok).toBe(false); // det<0 反射
  });

  it('decompose：sx=hypot(a,b)，sy=det/sx，不用 hypot(c,d)', () => {
    // 构造 R(θ)*[[sx,k*sy],[0,sy]]：θ=30°, sx=2, sy=3, k=0.5
    const th = Math.PI / 6;
    const sx = 2, sy = 3, k = 0.5;
    const A = [sx, 0, k * sy, sy, 0, 0] as const;
    const R = rotationRad(th);
    const M = multiply(R, A);
    const d = decompose(M);
    expect(d.sx).toBeCloseTo(sx, TOL);
    expect(d.sy).toBeCloseTo(sy, TOL);
    expect(d.thetaRad).toBeCloseTo(th, TOL);
    expect(d.k).toBeCloseTo(k, TOL);
  });

  it('嵌套含旋转/剪切的 worldMatrix 与 pageToLocal 往返', () => {
    const project: Project = createProject();
    const pageId = project.pageOrder[0];
    const group = createLayer('group', pageId);
    group.matrix = multiply(rotationRad(0.9), scaling(1.5, 0.8));
    const child = createLayer('panel', pageId);
    child.parentId = group.id;
    child.matrix = multiply(translation(30, 40), rotationRad(-0.4));
    project.layers[group.id] = group;
    project.layers[child.id] = child;
    const W = worldMatrix(project, child.id);
    const p = { x: 7, y: -13 };
    const world = apply(W, p);
    // 手动：world(group) * matrix(child) * p
    const manual = apply(multiply(multiply(rotationRad(0.9), scaling(1.5, 0.8)), multiply(translation(30, 40), rotationRad(-0.4))), p);
    expect(world.x).toBeCloseTo(manual.x, TOL);
    expect(world.y).toBeCloseTo(manual.y, TOL);
  });

  it('clientToPage 不乘 DPR；pageToScreen 往返', () => {
    const rect = { left: 100, top: 50 };
    const vp = { zoom: 2.5, pan: { x: 40, y: -10 } };
    const client = { x: 300, y: 200 };
    const page = clientToPage(client, rect, vp);
    expect(page.x).toBeCloseTo((300 - 100 - 40) / 2.5, TOL);
    expect(page.y).toBeCloseTo((200 - 50 + 10) / 2.5, TOL);
    const back = pageToScreen(page, vp);
    expect(back.x + rect.left).toBeCloseTo(client.x, TOL);
    expect(back.y + rect.top).toBeCloseTo(client.y, TOL);
  });

  it('DPR 1/2 不改变逻辑拖拽距离（同一公式）', () => {
    const vp = { zoom: 1, pan: { x: 0, y: 0 } };
    const a = clientToPage({ x: 0, y: 0 }, { left: 0, top: 0 }, vp);
    const b = clientToPage({ x: 100, y: 100 }, { left: 0, top: 0 }, vp);
    expect(b.x - a.x).toBeCloseTo(100, TOL);
  });

  it('determinant', () => {
    expect(determinant([2, 0, 0, 3, 0, 0])).toBe(6);
  });

  it('ok() 形状', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
  });
});
