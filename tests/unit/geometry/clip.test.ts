import { describe, expect, it } from 'vitest';
import { clipHalfPlane, clipAlongVertical, clipAlongHorizontal } from '../../../src/geometry/clip';
import { metrics, validateConvex } from '../../../src/geometry/polygon';
import { DEFAULT_GEOMETRY_POLICY } from '../../../src/geometry/types';

const policy = DEFAULT_GEOMETRY_POLICY;

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

function area(points: { x: number; y: number }[]): number {
  const m = metrics(points);
  return m.ok ? Math.abs(m.value.signedArea) : NaN;
}

describe('M03-T03 半平面裁切', () => {
  it('水平切割：上半保留', () => {
    const top = clipHalfPlane(square, { normal: { x: 0, y: 1 }, offset: 50 });
    expect(top.length).toBe(4);
    expect(area(top)).toBeCloseTo(5000, 6);
  });

  it('垂直切割：gap=0 面积守恒', () => {
    const left = clipAlongVertical(square, 50, 0, 'left');
    const right = clipAlongVertical(square, 50, 0, 'right');
    expect(area(left) + area(right)).toBeCloseTo(10000, 6);
  });

  it('切线经过顶点不生成重复顶点', () => {
    // 切在 y=0（顶边），保留 y>=0 一侧：整形且无重复顶点
    const top = clipHalfPlane(square, { normal: { x: 0, y: -1 }, offset: 0 });
    expect(top.length).toBe(4);
    const ids = new Set(top.map((p) => `${p.x},${p.y}`));
    expect(ids.size).toBe(4);
  });

  it('斜线穿顶点', () => {
    // 法线 (1,1)/√2，offset=0：保留 x+y<=0 一侧 → 只剩原点
    const r = clipHalfPlane(square, { normal: { x: 1, y: 1 }, offset: 0 });
    expect(r.length).toBe(0);
    // normal 与 offset 同步归一化，传入 x+y<=100
    const r2 = clipHalfPlane(square, { normal: { x: 1, y: 1 }, offset: 100 });
    expect(area(r2)).toBeCloseTo(5000, 4);
  });

  it('切线完全在外：返回原多边形或空', () => {
    const all = clipHalfPlane(square, { normal: { x: 0, y: 1 }, offset: 1000 });
    expect(all.map((p) => `${p.x},${p.y}`)).toEqual(square.map((p) => `${p.x},${p.y}`));
    const none = clipHalfPlane(square, { normal: { x: 0, y: 1 }, offset: -1 });
    expect(none.length).toBe(0);
  });

  it('贴边切割（共线边）不产生 NaN', () => {
    const r = clipHalfPlane(square, { normal: { x: 1, y: 0 }, offset: 100 });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it('水平/垂直双侧切割（M07 用）', () => {
    const top = clipAlongHorizontal(square, 40, 16, 'top');
    const bottom = clipAlongHorizontal(square, 40, 16, 'bottom');
    expect(area(top)).toBeCloseTo(40 * 100 - 8 * 100, 6);
    expect(area(bottom)).toBeCloseTo(60 * 100 - 8 * 100, 6);
  });

  it('结果保持凸性', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 0, y: 200 },
    ];
    const r = clipHalfPlane(tri, { normal: { x: 1, y: 1 }, offset: 100 });
    expect(validateConvex(r, policy).ok).toBe(true);
    expect(r.length).toBeGreaterThanOrEqual(3);
  });

  it('负 offset 归一化法线语义一致', () => {
    // 等比例缩放 normal/offset 不改变半平面
    const a = clipHalfPlane(square, { normal: { x: 0, y: 1 }, offset: 50 });
    const b = clipHalfPlane(square, { normal: { x: 0, y: 5 }, offset: 250 });
    expect(a.length).toBe(b.length);
    a.forEach((p, i) => {
      expect(p.x).toBeCloseTo(b[i].x, 9);
      expect(p.y).toBeCloseTo(b[i].y, 9);
    });
  });
});
