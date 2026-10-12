import { describe, expect, it } from 'vitest';
import { buildBubble, bubbleContains, flattenPath } from '../../src/bubbles/geometry';
import { defaultTail, moveTailBase, moveTailTip, tailBasePoint } from '../../src/bubbles/tail';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';

const style = { fill: '#FFFFFFFF', borderWidth: 3, borderColor: '#000000FF', radius: 24 };

describe('shared bubble geometry', () => {
  it('builds five deterministic outlines and keeps text within safe zones', () => {
    for (const shape of ['rect', 'roundRect', 'circle', 'cloud', 'spiky'] as const) {
      const size = shape === 'circle' ? 240 : 300;
      const bubble = buildBubble(shape, size, size, style, null);
      expect(bubble.ok).toBe(true);
      if (!bubble.ok) continue;
      expect(bubble.value.textBox.width).toBeGreaterThan(0);
      expect(bubble.value.textBox.height).toBeGreaterThan(0);
      expect(bubbleContains(bubble.value, { x: size / 2, y: size / 2 })).toBe(true);
      if (shape === 'cloud' || shape === 'spiky') expect(flattenPath(bubble.value.outline).length).toBe(shape === 'cloud' ? 96 : 24);
    }
  });

  it('keeps the circle square and clips a too-small safe zone to zero', () => {
    expect(buildBubble('circle', 240, 180, style, null).ok).toBe(false);
    const small = buildBubble('rect', 16, 16, style, null);
    expect(small.ok).toBe(true);
    if (small.ok) expect(small.value.textBox.width).toBe(0);
  });

  it('joins a triangular tail into one outline and rejects a tip inside the body', () => {
    const tail = { kind: 'triangle' as const, attachU: 0.65, baseWidth: 24, tip: { x: 195, y: 240 } };
    const geometry = buildBubble('roundRect', 300, 180, style, tail);
    expect(geometry.ok).toBe(true);
    if (geometry.ok) {
      expect(geometry.value.tailLine).toBeNull();
      expect(geometry.value.outline.bounds.y + geometry.value.outline.bounds.height).toBe(240);
      const contour = geometry.value.outline.ops.filter((op) => op.op === 'M' || op.op === 'L').map((op) => op.p);
      const a = contour[contour.length - 2], b = contour[0];
      expect(bubbleContains(geometry.value, { x: (a.x + b.x + tail.tip.x) / 3, y: (a.y + b.y + tail.tip.y) / 3 })).toBe(true);
    }
    expect(buildBubble('roundRect', 300, 180, style, { ...tail, tip: { x: 150, y: 90 } }).ok).toBe(false);
  });

  it('constrains tip entry and long drags without accepting an intersecting outline', () => {
    const project = createProject();
    const bubble = createLayer('bubble', project.pageOrder[0]);
    if (bubble.type !== 'bubble') throw new Error('factory returned wrong layer');
    bubble.tail = { kind: 'triangle', attachU: 0.65, baseWidth: 24, tip: { x: 195, y: 240 } };
    const inside = moveTailTip(bubble, { x: 150, y: 90 });
    expect(inside.ok).toBe(true);
    if (inside.ok) {
      expect(buildBubble(bubble.shape, bubble.width, bubble.height, bubble.style, inside.value).ok).toBe(true);
      expect(inside.value.tip.y).toBeGreaterThanOrEqual(180);
    }
    const far = moveTailTip(bubble, { x: 200000, y: 200000 });
    expect(far.ok).toBe(true);
    if (far.ok) expect(buildBubble(bubble.shape, bubble.width, bubble.height, bubble.style, far.value).ok).toBe(true);
    expect(buildBubble('roundRect', 300, 180, style, { ...bubble.tail, attachU: 0.1, tip: { x: 150, y: 240 } }).ok).toBe(false);
    expect(buildBubble('roundRect', 300, 180, style, { ...bubble.tail, kind: 'line', attachU: 0.1, tip: { x: 150, y: 240 } }).ok).toBe(false);
  });

  it('moves the tail base along the body arc and keeps the contour valid', () => {
    const project = createProject();
    const bubble = createLayer('bubble', project.pageOrder[0]);
    if (bubble.type !== 'bubble') throw new Error('factory returned wrong layer');
    bubble.tail = { kind: 'triangle', attachU: 0.65, baseWidth: 24, tip: { x: 195, y: 240 } };
    const before = tailBasePoint(bubble);
    expect(before.ok).toBe(true);
    const moved = moveTailBase(bubble, { x: 240, y: 180 });
    expect(moved.ok).toBe(true);
    if (!moved.ok || !before.ok) return;
    expect(moved.value.attachU).not.toBe(bubble.tail.attachU);
    bubble.tail = moved.value;
    const after = tailBasePoint(bubble);
    expect(after.ok).toBe(true);
    if (after.ok) expect(Math.hypot(after.value.x - 240, after.value.y - 180)).toBeLessThan(Math.hypot(before.value.x - 240, before.value.y - 180));
    expect(buildBubble(bubble.shape, bubble.width, bubble.height, bubble.style, bubble.tail).ok).toBe(true);
  });

  it('chooses a non-crossing default tail on all five bodies', () => {
    const project = createProject();
    for (const shape of ['rect', 'roundRect', 'circle', 'cloud', 'spiky'] as const) {
      const bubble = createLayer('bubble', project.pageOrder[0]);
      if (bubble.type !== 'bubble') throw new Error('factory returned wrong layer');
      bubble.shape = shape;
      if (shape === 'circle') bubble.width = bubble.height = 240;
      for (const kind of ['triangle', 'line'] as const) {
        const tail = defaultTail(bubble, kind);
        expect(tail.ok, `${shape}/${kind}`).toBe(true);
        if (tail.ok) expect(buildBubble(shape, bubble.width, bubble.height, bubble.style, tail.value).ok).toBe(true);
      }
    }
  });
});
