import { describe, expect, it } from 'vitest';
import { edgeDisplacement, vertexAngle } from '../../src/panels/geometryFeedback';
const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }];
describe('geometry gesture feedback in local coordinates', () => {
  it('reports an interior angle for every vertex of a non-axis-aligned convex polygon', () => {
    for (let index = 0; index < 4; index++) expect(vertexAngle(square, index)).toBe(90);
    const parallelogram = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 180, y: 80 }, { x: 80, y: 80 }];
    expect(parallelogram.map((_, i) => vertexAngle(parallelogram, i))).toEqual([45, 135, 45, 135]);
  });
  it('reports signed accepted displacement projected onto the original edge normal, excluding tangent motion', () => {
    const pushed = square.map((p, index) => index < 2 ? { x: p.x + 7, y: p.y - 25 } : p);
    expect(edgeDisplacement(square, pushed, 0)).toBe(25);
    expect(edgeDisplacement(square, square.map((p) => ({ x: p.x, y: p.y + 10 })), 0)).toBe(-10);
    expect(edgeDisplacement([{ x: 0, y: 0 }, { x: 0, y: 0 }], square, 0)).toBe(0);
  });
});
