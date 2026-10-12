import { describe, expect, it } from 'vitest';
import { buildDecoration } from '../../src/library/decorations';

const speed = { kind: 'speed' as const, width: 400, height: 240, count: 24, angleDeg: 0, seed: 42, strokeWidth: 2, color: '#000000FF' as const };
const focus = { kind: 'focus' as const, width: 400, height: 400, count: 48, innerRatio: 0.25, seed: 42, strokeWidth: 2, color: '#000000FF' as const };

function endpoints(paths: ReturnType<typeof buildDecoration>) {
  return paths.map((path) => path.ops.filter((op) => op.op === 'M' || op.op === 'L').map((op) => op.p));
}

describe('deterministic decoration paths', () => {
  it('keeps seeded speed lines stable and clips every rotated endpoint to the box', () => {
    expect(buildDecoration(speed)).toEqual(buildDecoration(speed));
    expect(buildDecoration({ ...speed, seed: 43 })).not.toEqual(buildDecoration(speed));
    for (const angleDeg of [0, 90, 135]) {
      const paths = endpoints(buildDecoration({ ...speed, angleDeg }));
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) for (const p of path) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-8);
        expect(p.x).toBeLessThanOrEqual(speed.width + 1e-8);
        expect(p.y).toBeGreaterThanOrEqual(-1e-8);
        expect(p.y).toBeLessThanOrEqual(speed.height + 1e-8);
      }
    }
  });

  it('moves every focus line start outward when innerRatio grows', () => {
    const a = endpoints(buildDecoration(focus));
    const b = endpoints(buildDecoration({ ...focus, innerRatio: 0.7 }));
    expect(a).toHaveLength(48);
    expect(b).toHaveLength(48);
    for (let i = 0; i < a.length; i++) {
      const distance = (p: { x: number; y: number }) => Math.hypot(p.x - 200, p.y - 200);
      expect(distance(b[i][0])).toBeGreaterThan(distance(a[i][0]));
      expect(b[i][1]).toEqual(a[i][1]);
    }
  });
});
