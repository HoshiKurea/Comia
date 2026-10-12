import { describe, expect, it } from 'vitest';
import { cropFromMapping, panCrop, resolveCrop, zoomCrop } from '../../src/images/crop';

const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
const image = { x: 400, y: 200 };

describe('non-destructive image crop', () => {
  it('covers a square with a wide image and clamps panning without gaps', () => {
    const start = { focus: { u: 0.5, v: 0.5 }, zoom: 1 };
    expect(resolveCrop(square, image, start)).toEqual({ scale: 0.5, tx: -50, ty: 0 });
    const far = panCrop(square, image, start, { x: 10000, y: -10000 });
    expect(resolveCrop(square, image, far)).toEqual({ scale: 0.5, tx: 0, ty: 0 });
  });

  it('keeps the same source pixels on both sides of a split', () => {
    const first = [{ x: 0, y: 0 }, { x: 42, y: 0 }, { x: 42, y: 100 }, { x: 0, y: 100 }];
    const second = [{ x: 58, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 58, y: 100 }];
    const source = resolveCrop(square, image, { focus: { u: 0.4, v: 0.5 }, zoom: 2 });
    for (const poly of [first, second]) {
      const inherited = resolveCrop(poly, image, cropFromMapping(poly, image, source));
      expect(inherited.scale).toBeCloseTo(source.scale, 8);
      expect(inherited.tx).toBeCloseTo(source.tx, 8);
      expect(inherited.ty).toBeCloseTo(source.ty, 8);
    }
  });

  it('zooms around a source-pixel anchor and rejects invalid inputs', () => {
    const start = { focus: { u: 0.5, v: 0.5 }, zoom: 1 };
    const before = resolveCrop(square, image, start);
    const after = resolveCrop(square, image, zoomCrop(square, image, start, 3, { x: 50, y: 50 }));
    expect((50 - after.tx) / after.scale).toBeCloseTo((50 - before.tx) / before.scale, 8);
    expect(() => zoomCrop(square, image, start, Number.NaN, { x: 50, y: 50 })).toThrow();
  });
  it('rejects empty/zero/nonfinite dimensions, malformed focus, invalid deltas and overflow before producing a mapping', () => {
    const crop = { focus: { u: .5, v: .5 }, zoom: 1 };
    for (const poly of [[], [{ x: 0, y: 0 }], square.map((point) => ({ ...point, y: 0 })), [{ x: NaN, y: 0 }, ...square]]) expect(() => resolveCrop(poly, image, crop)).toThrow(RangeError);
    for (const size of [{ x: 0, y: 10 }, { x: Infinity, y: 20 }, { x: 10, y: NaN }]) expect(() => resolveCrop(square, size, crop)).toThrow(RangeError);
    expect(() => resolveCrop(square, image, { ...crop, focus: { u: NaN, v: .5 } })).toThrow(RangeError);
    expect(() => resolveCrop(square, image, { ...crop, zoom: Number.MAX_VALUE })).toThrow(RangeError);
    expect(() => panCrop(square, image, crop, { x: Infinity, y: 0 })).toThrow(RangeError);
    expect(() => zoomCrop(square, image, crop, 2, { x: NaN, y: 0 })).toThrow(RangeError);
    expect(() => cropFromMapping(square, image, { scale: Infinity, tx: 0, ty: 0 })).toThrow(RangeError);
  });
});
