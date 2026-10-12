import { expect, it } from 'vitest';
import { buildPressureRibbon } from '../../src/bubbles/strokeRibbon';
import { LOCAL_TARGET } from '../../src/geometry/flattenForBoolean';
import { regionEdges } from '../../src/geometry/renderRegion';
import { regionContains } from '../../src/geometry/pathRegion';
import type { ShapePath } from '../../src/geometry/types';
it('keeps all disconnected hollow contours for a group exceeding8192 edges without weakening the member budget',()=>{
  const path:ShapePath={ops:[],bounds:{x:0,y:0,width:480,height:320}};for(let i=0;i<600;i++){const x=i%30*16,y=Math.floor(i/30)*16;path.ops.push({op:'M',p:{x,y}},{op:'L',p:{x:x+8,y}},{op:'L',p:{x:x+8,y:y+8}},{op:'L',p:{x,y:y+8}},{op:'Z'});}
  expect(buildPressureRibbon(path,1,0,0,LOCAL_TARGET).ok).toBe(false);const group=buildPressureRibbon(path,1,0,0,LOCAL_TARGET,65536);if(!group.ok)throw Error(JSON.stringify(group));expect(regionEdges(group.value)).toBeGreaterThan(8192);expect(regionContains(group.value,{x:0,y:4})).toBe(true);expect(regionContains(group.value,{x:4,y:4})).toBe(false);expect(regionContains(group.value,{x:29*16,y:19*16+4})).toBe(true);
});
