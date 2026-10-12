import { describe, expect, it } from 'vitest';
import { fitPage, pinchViewport, zoomAt } from '../../src/interaction/viewport';
describe('viewport formulas', () => {
  it('keeps the pointer page point fixed when zoom is clamped or changes', () => {
    const initial = { zoom: .5, pan: { x: 90, y: 20 } }, pointer = { x: 300, y: 200 };
    for (const factor of [.0001, .5, 2, 1000]) {
      const next = zoomAt(initial, pointer, factor);
      expect((pointer.x - next.pan.x) / next.zoom).toBeCloseTo((pointer.x - initial.pan.x) / initial.zoom);
      expect((pointer.y - next.pan.y) / next.zoom).toBeCloseTo((pointer.y - initial.pan.y) / initial.zoom);
      expect(next.zoom).toBeGreaterThanOrEqual(.05); expect(next.zoom).toBeLessThanOrEqual(8);
    }
  });
  it('fits with 32px margins and centers even in a narrow viewport', () => {
    expect(fitPage({ width: 500, height: 400 }, { x: 1064, y: 864 })).toEqual({ zoom: 2, pan: { x: 32, y: 32 } });
    const small = fitPage({ width: 500, height: 400 }, { x: 20, y: 10 }); expect(small.zoom).toBe(.05); expect(small.pan).toEqual({ x: -2.5, y: -5 });
  });
  it('anchors pinch to the starting page point plus midpoint movement and rejects zero distance', () => {
    const initial = { zoom: 1, pan: { x: 20, y: 30 } }, midpoint = { x: 200, y: 200 };
    expect(pinchViewport(initial, midpoint, 0, { x: 220, y: 210 }, 100)).toBe(initial);
    const next = pinchViewport(initial, midpoint, 100, { x: 220, y: 210 }, 200);
    expect(next.zoom).toBe(2); expect((220 - next.pan.x) / next.zoom).toBe(180); expect((210 - next.pan.y) / next.zoom).toBe(170);
  });
});
