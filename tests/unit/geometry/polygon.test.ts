import { describe, expect, it } from 'vitest';
import {
  cleanPolygon,
  constrainCandidate,
  containsConvex,
  cross,
  metrics,
  perimeter,
  validateConvex,
} from '../../../src/geometry/polygon';
import { DEFAULT_GEOMETRY_POLICY } from '../../../src/geometry/types';

const policy = DEFAULT_GEOMETRY_POLICY;

// 屏幕顺时针（y 向下）：signedArea 为正
const rect = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 80 },
  { x: 0, y: 80 },
];

const trapezoid = [
  { x: 80, y: 0 },
  { x: 520, y: 0 },
  { x: 600, y: 400 },
  { x: 0, y: 400 },
];

describe('M03-T02 凸多边形', () => {
  it('顺时针顶点 signedArea 为正；逆时针为负（均可通过）', () => {
    const m1 = metrics(rect);
    expect(m1.ok).toBe(true);
    if (m1.ok) expect(m1.value.signedArea).toBeCloseTo(8000, 6);
    const reversed = [...rect].reverse();
    const m2 = metrics(reversed);
    expect(m2.ok).toBe(true);
    if (m2.ok) expect(m2.value.signedArea).toBeCloseTo(-8000, 6);
    expect(validateConvex(rect, policy).ok).toBe(true);
    expect(validateConvex(reversed, policy).ok).toBe(true);
  });

  it('重心公式', () => {
    const m = metrics(rect);
    if (!m.ok) throw new Error('fail');
    expect(m.value.centroid.x).toBeCloseTo(50, 6);
    expect(m.value.centroid.y).toBeCloseTo(40, 6);
  });

  it('自交蝴蝶形拒绝', () => {
    const bowtie = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    expect(validateConvex(bowtie, policy).ok).toBe(false);
  });

  it('凹形拒绝', () => {
    const concave = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(validateConvex(concave, policy).ok).toBe(false);
  });

  it('重复点与共线拒绝/清理', () => {
    const dup = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];
    expect(validateConvex(dup, policy).ok).toBe(false);
    const cleaned = cleanPolygon(dup, policy);
    expect(cleaned).not.toBeNull();
    expect(cleaned!.length).toBe(4);
    const collinearExtra = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];
    const c2 = cleanPolygon(collinearExtra, policy);
    expect(c2!.length).toBe(4);
  });

  it('极窄三角形拒绝（边过短）', () => {
    const thin = [
      { x: 0, y: 0 },
      { x: 1000, y: 0.001 },
      { x: 500, y: 0.002 },
    ];
    expect(validateConvex(thin, policy).ok).toBe(false);
  });

  it('负坐标与面积下限', () => {
    expect(validateConvex(
      [
        { x: -50, y: -50 },
        { x: -49, y: -50 },
        { x: -50, y: -49 },
      ],
      policy,
    ).ok).toBe(false); // 面积 0.5 < 4
    const big = [
      { x: -500, y: -400 },
      { x: 500, y: -400 },
      { x: 500, y: 400 },
      { x: -500, y: 400 },
    ];
    expect(validateConvex(big, policy).ok).toBe(true);
  });

  it('containsConvex：bbox 内轮廓外不误选', () => {
    expect(containsConvex(trapezoid, { x: 300, y: 200 })).toBe(true);
    // 梯形左上角外、矩形 bbox 内
    expect(containsConvex(trapezoid, { x: 10, y: 10 })).toBe(false);
    // 容差边缘算内侧
    expect(containsConvex(rect, { x: -0.5, y: 40 }, 1)).toBe(true);
  });

  it('constrainCandidate：拖角过对边停在有效边界，不翻转', () => {
    // 把矩形右下角往左上拖过对角线 → 自交候选，约束停在边界
    const start = [...rect];
    const candidate = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: -50, y: -50 },
      { x: 0, y: 80 },
    ];
    const constrained = constrainCandidate(start, candidate, policy);
    // 结果仍是凸形
    expect(validateConvex(constrained, policy).ok).toBe(true);
    // 第 2 顶点没有越过对边
    expect(constrained[2].x).toBeGreaterThan(0);
  });

  it('constrainCandidate：有效候选直接通过', () => {
    const candidate = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 140, y: 120 },
      { x: 0, y: 80 },
    ];
    expect(constrainCandidate(rect, candidate, policy)).toEqual(candidate);
  });

  it('a valid triangle endpoint beyond the opposite edge cannot tunnel through zero area or reverse winding', () => {
    const start = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 100, y: 160 }];
    const candidate = [start[0], start[1], { x: 100, y: -160 }];
    expect(validateConvex(candidate, policy).ok).toBe(true);
    for (const reverse of [false, true]) {
      const a = reverse ? [...start].reverse() : start, b = reverse ? [...candidate].reverse() : candidate;
      const result = constrainCandidate(a, b, policy), measure = metrics(result);
      expect(measure.ok).toBe(true); if (!measure.ok) throw Error('degenerate constrained triangle');
      expect(Math.sign(measure.value.signedArea)).toBe(reverse ? -1 : 1);
      expect(Math.abs(measure.value.signedArea)).toBeGreaterThanOrEqual(policy.minArea - 1e-6);
      expect(Math.abs(measure.value.signedArea)).toBeLessThan(policy.minArea + .001);
      expect(result[reverse ? 0 : 2].y).toBeGreaterThan(0);
    }
  });

  it('valid endpoints cannot skip a subpixel short-edge interval between the prescribed 1/32 samples', () => {
    const height = .999999;
    const start = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: -2, y: height }];
    const candidate = [start[0], start[1], { x: 3, y: height }];
    expect(validateConvex(start, policy).ok).toBe(true); expect(validateConvex(candidate, policy).ok).toBe(true);
    const result = constrainCandidate(start, candidate, policy);
    expect(result[2].x).toBeLessThan(0);
    expect(Math.hypot(result[2].x, result[2].y)).toBeGreaterThanOrEqual(policy.minEdge - 1e-6);
    expect(result[2].x).toBeGreaterThan(-.002);
  });

  it('顶点数 3～64 限制', () => {
    const many = Array.from({ length: 65 }, (_, i) => ({
      x: 1000 + 800 * Math.cos((2 * Math.PI * i) / 65),
      y: 1000 + 800 * Math.sin((2 * Math.PI * i) / 65),
    }));
    expect(validateConvex(many, policy).ok).toBe(false);
  });

  it('cross 与 perimeter', () => {
    expect(cross({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(1);
    expect(perimeter(rect)).toBeCloseTo(360, 6);
  });
});
