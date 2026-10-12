import { expect, it } from 'vitest';
import clipping from 'polygon-clipping';
import { polygonRegion, regionArea, regionContains } from '../../src/geometry/pathRegion';
import { checkedUnion, pathToRegion, regionToPath } from '../../src/geometry/renderRegion';
const rect=(x:number,y:number,size:number)=>polygonRegion([{x,y},{x:x+size,y},{x:x+size,y:y+size},{x,y:y+size}]);
it('preserves a filled island inside a hole when canonical multi-contour paths are flattened again',()=>{
  const region=clipping.union(clipping.difference(rect(0,0,100),rect(20,20,60)),rect(40,40,20)),result=pathToRegion(regionToPath(region));if(!result.ok)throw Error(JSON.stringify(result));expect(regionContains(result.value,{x:50,y:50})).toBe(true);expect(regionContains(result.value,{x:30,y:30})).toBe(false);expect(regionContains(result.value,{x:10,y:10})).toBe(true);expect(regionArea(result.value)).toBe(6800);
});
it('removes only exact zero-area snapped inputs and retains real hollow contours',()=>{
  const tiny=polygonRegion([{x:0,y:0},{x:.000001,y:0},{x:0,y:.000001}]),hollow=clipping.difference(rect(0,0,10),rect(2,2,6)),result=checkedUnion([tiny,hollow],8192,.001);
  if(!result.ok)throw Error(JSON.stringify(result));expect(regionArea(result.value)).toBe(64);expect(regionContains(result.value,{x:5,y:5})).toBe(false);
});
it('merges eight-piece positive batches into the same independent union including holes and disconnected islands',()=>{
  const pieces=Array.from({length:72},(_,i)=>i%3===0?clipping.difference(rect(i%12*7,Math.floor(i/12)*15,10),rect(i%12*7+2,Math.floor(i/12)*15+2,6)):rect(i%12*7,Math.floor(i/12)*15,10));
  const reference=clipping.union(pieces[0],...pieces.slice(1)),result=checkedUnion(pieces,65536,1/65536,8);if(!result.ok)throw Error(JSON.stringify(result));expect(result.value).toEqual(reference);
  expect(checkedUnion(pieces,65536,0,1).ok).toBe(false);expect(checkedUnion(pieces,65536,0,2.5).ok).toBe(false);
});
