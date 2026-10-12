import { describe, expect, it } from 'vitest';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import { apply, worldMatrix } from '../../src/geometry/matrix';
import { layerScreenBounds, runScreenBounds } from '../../src/render/screenBounds';

describe('gesture cache bounds', () => {
  it('contains every rotated panel vertex plus border and clips to the viewport', () => {
    const project = createProject();
    const pageId = project.pageOrder[0];
    const panel = createLayer('panel', pageId);
    if (panel.type !== 'panel') throw new Error('factory type');
    panel.matrix = [0.8, 0.6, -0.6, 0.8, 500, 700];
    panel.style.borderWidth = 20;
    project.layers[panel.id] = panel;
    project.pages[pageId].roots.push(panel.id);
    const vp = { zoom: 0.5, pan: { x: 5, y: 9 } };
    const box = layerScreenBounds(project, panel.id, vp)!;
    for (const vertex of panel.geometry) {
      const p = apply(worldMatrix(project, panel.id), vertex);
      const x = vp.pan.x + vp.zoom * p.x, y = vp.pan.y + vp.zoom * p.y;
      expect(x).toBeGreaterThan(box.x);
      expect(x).toBeLessThan(box.x + box.width);
      expect(y).toBeGreaterThan(box.y);
      expect(y).toBeLessThan(box.y + box.height);
    }
    const clipped = runScreenBounds(project, [panel.id], vp, { width: 400, height: 500 })!;
    expect(clipped.x).toBeGreaterThanOrEqual(0);
    expect(clipped.y).toBeGreaterThanOrEqual(0);
    expect(clipped.x + clipped.width).toBeLessThanOrEqual(400);
    expect(clipped.y + clipped.height).toBeLessThanOrEqual(500);
  });

  it('includes a line tail that extends outside the bubble body', () => {
    const project = createProject();
    const pageId = project.pageOrder[0];
    const bubble = createLayer('bubble', pageId);
    if (bubble.type !== 'bubble') throw new Error('factory type');
    bubble.tail = { kind: 'line', attachU: 0.6, baseWidth: 12, tip: { x: bubble.width + 90, y: bubble.height + 80 } };
    project.layers[bubble.id] = bubble;
    project.pages[pageId].roots.push(bubble.id);
    const box = layerScreenBounds(project, bubble.id, { zoom: 1, pan: { x: 0, y: 0 } })!;
    expect(box.x + box.width).toBeGreaterThanOrEqual(bubble.width + 90);
    expect(box.y + box.height).toBeGreaterThanOrEqual(bubble.height + 80);
  });
});
