import { expect, it } from 'vitest';
import { IDENTITY } from '../../src/geometry/matrix';
import { multiply } from '../../src/geometry/matrix';
it('sanity', () => {
  expect(multiply(IDENTITY, IDENTITY)[0]).toBe(1);
});
