import { describe, expect, it } from 'vitest';
import { DoubleTapRecognizer } from '../../src/interaction/doubleTap';

describe('touch double tap recognition', () => {
  it('recognizes a pair within 300ms and 12 CSS px exactly once, independent of pointer id', () => {
    const taps = new DoubleTapRecognizer(); taps.down(1, { x: 10, y: 10 }, 0, 'page'); expect(taps.up(1, { x: 10, y: 10 }, 20)).toBe(false);
    taps.down(2, { x: 22, y: 10 }, 300, 'page'); expect(taps.up(2, { x: 22, y: 10 }, 320)).toBe(true);
    taps.down(3, { x: 22, y: 10 }, 330, 'page'); expect(taps.up(3, { x: 22, y: 10 }, 350)).toBe(false);
  });
  it.each(['time', 'distance', 'scope', 'drag', 'cancel', 'multi', 'clock'] as const)('rejects %s pairs', (kind) => {
    const taps = new DoubleTapRecognizer(); taps.down(1, { x: 10, y: 10 }, 0, 'page'); taps.up(1, { x: 10, y: 10 }, 20);
    const point = { x: kind === 'distance' ? 22.01 : 10, y: 10 }, at = kind === 'time' ? 321 : kind === 'clock' ? -1 : 100;
    taps.down(2, point, at, kind === 'scope' ? 'other-page' : 'page');
    if (kind === 'drag') taps.move(2, { x: 13, y: 10 });
    if (kind === 'cancel') taps.cancel();
    if (kind === 'multi') taps.down(3, point, at, 'page');
    expect(taps.up(2, point, kind === 'clock' ? -1 : at + 10)).toBe(false);
  });
});
