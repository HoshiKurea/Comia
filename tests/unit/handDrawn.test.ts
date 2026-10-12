import { describe, expect, it } from 'vitest';
import { createLayer, createProject } from '../../src/domain/factories';
import type { BubbleLayer, Point } from '../../src/domain/types';
import { buildContourPath, generateContour, handDrawnPreset, mangaBodyPath, mulberry32 } from '../../src/bubbles/handDrawn';
import { bubbleBodyPath } from '../../src/bubbles/geometry';
import { flattenForBoolean, flattenForRender } from '../../src/geometry/flattenForBoolean';
import { safeTextBox } from '../../src/bubbles/safeTextBox';
import { buildPressureRibbon, pressureWidth } from '../../src/bubbles/strokeRibbon';
import { regionArea, regionContains } from '../../src/geometry/pathRegion';
import { pathToRegion, regionToPath } from '../../src/geometry/renderRegion';
import { buildEllipse, buildRoundedPolygon } from '../../src/geometry/roundedPolygon';
import { IDENTITY } from '../../src/geometry/matrix';

function bubble(shape:BubbleLayer['shape']='handOval'):BubbleLayer{return{...createLayer('bubble',createProject().pageOrder[0]) as BubbleLayer,shape,handDrawn:handDrawnPreset('soft',0),contour:null};}
describe('deterministic manga geometry',()=>{
  it.each(['handOval','handPolygon','wave','rect','roundRect','circle','cloud','spiky'] as const)('generates a valid closed %s without re-sampling on redraw',shape=>{
    const b=bubble(shape);if(shape==='circle')b.width=b.height=240;
    const a=generateContour(b),c=generateContour(b);expect(a.ok).toBe(true);expect(c).toEqual(a);
    const p=mangaBodyPath(b);expect(p.ok).toBe(true);if(p.ok){expect(p.value.ops.at(-1)).toEqual({op:'Z'});const flat=flattenForBoolean(p.value);expect(flat.ok).toBe(true);}
    if(a.ok)expect(a.value.nodes.length).toBe(shape==='cloud'||shape==='spiky'||shape==='wave'?24:12);
  });
  it('keeps the phases across uniform resize, and a new seed changes the sketch',()=>{
    const b=bubble(),a=generateContour(b);if(!a.ok)throw Error('shape');
    const double=generateContour({...b,width:b.width*2,height:b.height*2});expect(double).toEqual(a);
    expect(generateContour({...b,handDrawn:handDrawnPreset('soft',1)})).not.toEqual(a);
    expect(Array.from({length:5},mulberry32(0))).toEqual(Array.from({length:5},mulberry32(0)));
  });
  it('preserves the five original outlines when hand-drawn is disabled',()=>{
    for(const shape of ['rect','roundRect','circle','cloud','spiky'] as const){const b=bubble(shape);b.handDrawn=null;if(shape==='circle')b.width=b.height=240;expect(mangaBodyPath(b)).toEqual({ok:true,value:bubbleBodyPath(shape,b.width,b.height,b.style)});}
  });
  it('rejects self crossing, duplicate and excessive manual nodes instead of replacing the contour',()=>{
    const points:Point[]=[{x:0,y:0},{x:.2,y:.2},{x:1,y:1},{x:.8,y:.8},{x:0,y:1},{x:.2,y:.8},{x:1,y:0},{x:.8,y:.2}];
    expect(buildContourPath({nodes:points,tension:.2},300,180).ok).toBe(false);
    expect(buildContourPath({nodes:Array(8).fill({x:.5,y:.5}),tension:.2},300,180).ok).toBe(false);
    expect(buildContourPath({nodes:Array(33).fill({x:.5,y:.5}),tension:.2},300,180).ok).toBe(false);
  });
  it('retains zero-size text safety for the smallest bubble without losing its geometry',()=>{
    const b=bubble();b.width=b.height=16;const body=mangaBodyPath(b);expect(body.ok).toBe(true);if(!body.ok)throw Error('shape');const box=safeTextBox(body.value,3);expect(box.ok).toBe(true);if(box.ok){expect(box.value.width).toBe(0);expect(box.value.height).toBe(0);}
  });
  it('uses a region safety check for a concave outline whose center is outside',()=>{
    const p=buildRoundedPolygon([{x:0,y:0},{x:300,y:0},{x:300,y:80},{x:80,y:80},{x:80,y:300},{x:0,y:300}],0),r=pathToRegion(p),box=safeTextBox(p,3);
    expect(r.ok).toBe(true);expect(box.ok).toBe(true);if(!r.ok||!box.ok)throw Error('region');
    const b=box.value;expect(b.width).toBeGreaterThan(0);for(const x of [b.x,b.x+b.width])for(const y of [b.y,b.y+b.height])expect(regionContains(r.value,{x,y})).toBe(true);
    expect(b.width).toBeLessThan(80);expect(b.height).toBeLessThan(80);
  });
});
describe('strict curve precision and pressure ribbon',()=>{
  it('refines at output zoom and rejects insufficient budgets without chord fallback',()=>{
    const p=buildEllipse(100,100,100,100),one=flattenForBoolean(p),large=flattenForBoolean(p,{localToOutput:[8,0,0,8,0,0],tolerancePx:.25});
    expect(one.ok).toBe(true);expect(large.ok).toBe(true);if(one.ok&&large.ok)expect(large.value[0].length).toBeGreaterThan(one.value[0].length);
    expect(flattenForBoolean(p,{localToOutput:IDENTITY,tolerancePx:.25},4).ok).toBe(false);
  });
  it('handles multiple subpaths and distinguishes open tail routes from filled regions',()=>{
    const open={ops:[{op:'M' as const,p:{x:0,y:0}},{op:'C' as const,c1:{x:0,y:60},c2:{x:80,y:60},p:{x:80,y:0}}],bounds:{x:0,y:0,width:80,height:60}};
    expect(flattenForRender(open).ok).toBe(true);expect(flattenForBoolean(open).ok).toBe(false);
    const region=[[[[0,0],[100,0],[100,100],[0,100],[0,0]],[[20,20],[20,80],[80,80],[80,20],[20,20]]]] as [number,number][][][];
    const result=pathToRegion(regionToPath(region));expect(result.ok).toBe(true);if(result.ok){expect(regionArea(result.value)).toBe(6400);expect(regionContains(result.value,{x:50,y:50})).toBe(false);}
  });
  it('keeps pressure width within limits and continuous at the closing seam',()=>{
    for(let i=0;i<=1000;i++){const w=pressureWidth(3,.65,0,i/1000);expect(w).toBeGreaterThanOrEqual(3*.35-1e-12);expect(w).toBeLessThanOrEqual(3*1.65+1e-12);}
    expect(pressureWidth(3,.65,0,0)).toBeCloseTo(pressureWidth(3,.65,0,1),12);
  });
  it('produces a single hollow border region and no border at zero width',()=>{
    const body=buildEllipse(100,80,90,70),r=buildPressureRibbon(body,3,.15,0);expect(r.ok).toBe(true);
    if(r.ok){expect(regionArea(r.value)).toBeGreaterThan(1000);expect(regionContains(r.value,{x:100,y:80})).toBe(false);expect(regionContains(r.value,{x:190,y:80})).toBe(true);}
    expect(buildPressureRibbon(body,0,.65,0)).toEqual({ok:true,value:[]});
  });
  it('rejects non-finite pressure and excessive outline widths',()=>{
    const p=buildEllipse(100,80,90,70);expect(buildPressureRibbon(p,257,.15,0).ok).toBe(false);expect(buildPressureRibbon(p,3,NaN,0).ok).toBe(false);expect(buildPressureRibbon(p,3,.15,-1).ok).toBe(false);
  });
});
