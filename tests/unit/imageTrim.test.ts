import { expect, it } from 'vitest';
import { createLayer, createProject } from '../../src/domain/factories';
import type { ImageLayer, PanelLayer } from '../../src/domain/types';
import { trimImage, restoreImageSourceWindow } from '../../src/images/trimGeometry';
import { apply, multiply } from '../../src/geometry/matrix';

function fixture() {
  const p = createProject(), pid = p.pageOrder[0], image = createLayer('image', pid) as ImageLayer;
  image.width = 100; image.height = 80; image.assetId = crypto.randomUUID(); image.matrix = [0, 2, -3, 0, 300, 400];
  p.assets[image.assetId] = { id: image.assetId, name: '原件', width: 100, height: 80, originalHash: 'a'.repeat(64), renderHash: 'b'.repeat(64), originalMime: 'image/png', renderMime: 'image/png', originalBytes: 1, renderBytes: 1, framePolicy: 'still', normalizedOrientation: true };
  p.layers[image.id] = image; p.pages[pid].roots.push(image.id); return { p, image };
}
it('changes bounds and source window, without moving retained pixels or mutating the resource', () => {
  const { p, image } = fixture(), before = structuredClone(p), r = trimImage(p, image.id, { x: 10, y: 20, width: 40, height: 30 }); expect(r.ok).toBe(true); if (!r.ok) return;
  expect(r.value.width).toBe(40); expect(r.value.height).toBe(30); expect(r.value.sourceRect).toEqual({ x: 10, y: 20, width: 40, height: 30 });
  expect(apply(r.value.matrix, { x: 5, y: 6 })).toEqual(apply(image.matrix, { x: 15, y: 26 })); expect(p).toEqual(before); expect(r.value.assetId).toBe(image.assetId);
});
it('preserves linked and unlinked masks and partial breakout in world coordinates', () => {
  for (const linked of [false, true]) {
    const { p, image } = fixture(); image.mask = { enabled: true, linked, shape: 'rect', geometry: [{x:0,y:0},{x:50,y:0},{x:50,y:40},{x:0,y:40}], matrix: [1,0,0,1,5,7] };
    image.panelClip = { mode: 'partial', region: { shape: 'rect', geometry: structuredClone(image.mask.geometry), matrix: [1,0,0,1,20,30] } };
    const r = trimImage(p, image.id, {x:10,y:20,width:40,height:30}); if (!r.ok) throw Error('trim');
    expect(multiply(r.value.matrix, r.value.mask!.matrix)).toEqual(multiply(image.matrix, image.mask.matrix));
    expect(multiply(r.value.matrix, r.value.panelClip!.region!.matrix)).toEqual(multiply(image.matrix, image.panelClip.region.matrix));
    expect(r.value.mask!.linked).toBe(linked);
  }
});
it('composes consecutive source windows and restores the full source exactly', () => {
  const { p, image } = fixture(), first = trimImage(p, image.id, {x:10,y:20,width:80,height:50}); if (!first.ok) throw Error('first'); p.layers[image.id] = first.value;
  const second = trimImage(p, image.id, {x:5,y:6,width:40,height:30}); if (!second.ok) throw Error('second'); expect(second.value.sourceRect).toEqual({x:15,y:26,width:40,height:30}); p.layers[image.id] = second.value;
  const restored = restoreImageSourceWindow(p, image.id); expect(restored.ok).toBe(true); if (restored.ok) expect(restored.value).toEqual(image);
});
it('maps non 1:1 source coordinates, clamps overlap and rejects empty or invalid rectangles', () => {
  const { p, image } = fixture(); image.width = 200; image.height = 160;
  const r = trimImage(p, image.id, {x:20,y:40,width:80,height:60}); if (!r.ok) throw Error('trim'); expect(r.value.sourceRect).toEqual({x:10,y:20,width:40,height:30});
  const clamped = trimImage(p, image.id, {x:-30,y:-40,width:60,height:70}); if (!clamped.ok) throw Error('clamp'); expect([clamped.value.width,clamped.value.height]).toEqual([30,30]);
  for (const rect of [{x:300,y:0,width:1,height:1},{x:0,y:0,width:.5,height:10},{x:NaN,y:0,width:10,height:10},{x:0,y:0,width:-1,height:10}]) expect(trimImage(p,image.id,rect).ok).toBe(false);
  expect(trimImage(p,image.id,{x:0,y:0,width:200,height:160})).toEqual({ok:true,value:image});
});
it('freezes legacy cover mapping before cropping and leaves the owning panel untouched', () => {
  const { p, image } = fixture(), panel = createLayer('panel', image.pageId) as PanelLayer; panel.geometry = [{x:0,y:0},{x:100,y:0},{x:100,y:80},{x:0,y:80}]; panel.children = [image.id];
  image.parentId = panel.id; image.matrix = [1,0,0,1,0,0]; image.crop = {focus:{u:.5,v:.5},zoom:2}; p.layers[panel.id] = panel;
  const r = trimImage(p,image.id,{x:10,y:20,width:40,height:30}); if (!r.ok) throw Error('cover'); expect(r.value.crop).toBeNull(); expect(r.value.parentId).toBe(panel.id); expect(r.value.matrix).toEqual([2,0,0,2,-30,0]); expect(panel.children).toEqual([image.id]);
});
