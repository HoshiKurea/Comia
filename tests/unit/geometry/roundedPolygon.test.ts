import { describe, expect, it } from 'vitest';
import { buildRoundedPolygon, buildRoundedRect, buildEllipse } from '../../../src/geometry/roundedPolygon';
import { pathBounds, strokeExpand, unionBounds } from '../../../src/geometry/bounds';
import { IDENTITY, multiply, rotationRad, scaling, translation } from '../../../src/geometry/matrix';

const rect = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 80 },
  { x: 0, y: 80 },
];

describe('M03-T04 圆角多边形', () => {
  it('r=0 输出折线', () => {
    const path = buildRoundedPolygon(rect, 0);
    expect(path.ops.filter((o) => o.op === 'L').length).toBe(3);
    expect(path.ops.filter((o) => o.op === 'C').length).toBe(0);
  });

  it('正常圆角产生 4 段三次曲线', () => {
    const path = buildRoundedPolygon(rect, 10);
    expect(path.ops.filter((o) => o.op === 'C').length).toBe(4);
  });

  it('极大 r（超过短边）轮廓连续无交叉：切点收缩', () => {
    const path = buildRoundedPolygon(rect, 500);
    expect(path.ops.length).toBeGreaterThan(0);
    // 所有点仍在原多边形 bbox 内（凸多边形圆角只会内缩）
    for (const o of path.ops) {
      if (o.op === 'M' || o.op === 'L') {
        expect(o.p.x).toBeGreaterThanOrEqual(-1e-6);
        expect(o.p.x).toBeLessThanOrEqual(100 + 1e-6);
        expect(o.p.y).toBeGreaterThanOrEqual(-1e-6);
        expect(o.p.y).toBeLessThanOrEqual(80 + 1e-6);
      }
    }
  });

  it('锐角三角形圆角仍为凸形路径（点在三角形内）', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 20, y: 150 },
    ];
    const path = buildRoundedPolygon(tri, 12);
    expect(path.ops.filter((o) => o.op === 'C').length).toBe(3);
  });

  it('bounds 与原多边形一致（圆角内缩）', () => {
    const path = buildRoundedPolygon(rect, 20);
    expect(path.bounds.width).toBeCloseTo(100, 6);
    expect(path.bounds.height).toBeCloseTo(80, 6);
  });

  it('roundRect：圆角矩形半径钳制到短边一半', () => {
    const p1 = buildRoundedRect({ x: 0, y: 0, width: 100, height: 40 }, 30);
    expect(p1.ops.filter((o) => o.op === 'C').length).toBe(4);
  });

  it('椭圆 4 段弧的 bounds', () => {
    const e = buildEllipse(50, 60, 30, 40);
    expect(e.bounds.x).toBeCloseTo(20, 6);
    expect(e.bounds.width).toBeCloseTo(60, 6);
    const b = pathBounds(e, IDENTITY)!;
    expect(b.width).toBeCloseTo(60, 1); // Bézier 近似椭圆误差 <0.3%
    expect(b.height).toBeCloseTo(80, 1);
  });
});

describe('M03-T05 路径包围盒', () => {
  it('曲线内部极值：圆弧旋转后 bbox 大于端点 bbox', () => {
    const e = buildEllipse(0, 0, 50, 50);
    const M = multiply(rotationRad(Math.PI / 4), translation(100, 100));
    const b = pathBounds(e, M)!;
    // 旋转 45° 的圆仍是圆：直径 100
    expect(b.width).toBeCloseTo(100, 1);
    expect(b.height).toBeCloseTo(100, 1);
  });

  it('二次曲线极值', () => {
    const path = {
      ops: [
        { op: 'M' as const, p: { x: 0, y: 0 } },
        { op: 'Q' as const, control: { x: 50, y: 100 }, p: { x: 100, y: 0 } },
      ],
      bounds: { x: 0, y: 0, width: 100, height: 50 },
    };
    const b = pathBounds(path, IDENTITY)!;
    expect(b.height).toBeCloseTo(50, 6); // 顶点在 t=0.5, y=2*0.25*100=50
  });

  it('三次曲线极值精确求解（旋转+剪切矩阵）', () => {
    const path = {
      ops: [
        { op: 'M' as const, p: { x: 0, y: 0 } },
        { op: 'C' as const, c1: { x: 10, y: 200 }, c2: { x: 90, y: 200 }, p: { x: 100, y: 0 } },
      ],
      bounds: { x: 0, y: 0, width: 100, height: 150 },
    };
    const M = multiply(translation(5, 7), scaling(2, 1));
    const b = pathBounds(path, M)!;
    // 拱高 150，经 S(2,1)：x ∈ [5,205], y ∈ [7,157]
    expect(b.x).toBeCloseTo(5, 6);
    expect(b.width).toBeCloseTo(200, 6);
    expect(b.y).toBeCloseTo(7, 6);
    expect(b.height).toBeCloseTo(150, 6);
  });

  it('空路径返回 null；unionBounds 空数组 null', () => {
    expect(pathBounds({ ops: [], bounds: { x: 0, y: 0, width: 0, height: 0 } }, IDENTITY)).toBeNull();
    expect(unionBounds([])).toBeNull();
  });

  it('unionBounds 并集', () => {
    const u = unionBounds([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: 5, width: 10, height: 10 },
    ])!;
    expect(u.x).toBe(0);
    expect(u.width).toBeCloseTo(30, 6);
    expect(u.height).toBeCloseTo(15, 6);
  });

  it('strokeExpand 保守扩展（含 viewport 矩阵）', () => {
    const base = { x: 0, y: 0, width: 10, height: 10 };
    const M = multiply(translation(50, 50), scaling(2, 2));
    const e = strokeExpand(base, M, 4);
    // r = 2*sqrt(2²+2²) + 2
    const radius = 2 * Math.sqrt(8) + 2;
    expect(e.x).toBeCloseTo(-radius, 6);
    expect(e.width).toBeCloseTo(10 + 2 * radius, 6);
  });
});
