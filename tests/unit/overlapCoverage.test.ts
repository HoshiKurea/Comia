import { expect, it } from 'vitest';
import clipping from 'polygon-clipping';
import { compileCoverageTile, prepareCoverage, rasterizeCoverageTile, rasterizeOwnedFills, type ColoredRegion } from '../../src/bubbles/overlapFill';
import { polygonRegion, regionArea } from '../../src/geometry/pathRegion';
import type { Mat } from '../../src/domain/types';

it('retains exact per-pixel polygon areas and re-evaluates shared alpha before a single quantization',()=>{
  const square=polygonRegion([{x:0,y:0},{x:12,y:0},{x:12,y:12},{x:0,y:12}]);
  const hole=polygonRegion([{x:3,y:3},{x:9,y:3},{x:9,y:9},{x:3,y:9}]);
  const left=polygonRegion([{x:0,y:0},{x:12,y:0},{x:0,y:12}]);
  const parts:ColoredRegion[]=[{region:clipping.difference(left,hole),color:'#FF480080',multiplier:1},{region:clipping.difference(square,left,hole),color:'#236DFFAA',multiplier:1,shared:true}];
  for(const matrix of [[1,0,0,1,.25,.1],[1,.2,.3,.9,.25,.1],[-1,0,0,1,12.25,.1]] as Mat[]){
    const tile={x:-2,y:-2,width:20,height:20},coverage=compileCoverageTile(prepareCoverage(parts,matrix),tile);if(!coverage.ok)throw Error(JSON.stringify(coverage));
    const transformed=parts.map(p=>({...p,region:p.region.map(poly=>poly.map(ring=>ring.map(([x,y])=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]] as [number,number])))}));
    const areas=Array.from({length:400},(_,pixel)=>{const x=tile.x+pixel%20,y=tile.y+Math.floor(pixel/20),box=polygonRegion([{x,y},{x:x+1,y},{x:x+1,y:y+1},{x,y:y+1}]);return transformed.map(p=>regionArea(clipping.intersection(p.region,box)));});
    for(const factor of [0,.01,.25,.5,.65,.99,1]){
      const result=rasterizeCoverageTile(coverage.value,factor);if(!result.ok)throw Error(JSON.stringify(result));
      const expected=new Uint8ClampedArray(1600);
      areas.forEach((weights,pixel)=>{const channels=[0,0,0];let alpha=0;weights.forEach((w,index)=>{const p=parts[index],rgba=[0,1,2,3].map(i=>parseInt(p.color.slice(1+2*i,3+2*i),16)),a=w*rgba[3]/255*(p.shared?factor:1);alpha+=a;channels.forEach((_,c)=>channels[c]+=a*rgba[c]);});if(alpha){for(let c=0;c<3;c++)expected[pixel*4+c]=channels[c]/alpha;expected[pixel*4+3]=Math.min(1,alpha)*255;}});
      // Different exact integration orders can round at a half-byte boundary.
      // The independent area oracle must agree within one encoding level;
      // interiors, holes and alpha coefficients have exact explicit tests below.
      expect(Math.max(...result.value.map((v,i)=>Math.abs(v-expected[i])))).toBeLessThanOrEqual(1);
      const direct=rasterizeOwnedFills(prepareCoverage(parts.map(p=>({...p,multiplier:p.shared?factor:1})),matrix),tile);if(!direct.ok)throw Error(JSON.stringify(direct));
      expect(Math.max(...result.value.map((v,i)=>Math.abs(v-direct.value.data[i])))).toBeLessThanOrEqual(1);
    }
  }
});
it('keeps full coverage/diagonal mixtures, clears zero-alpha pixels, and uses only the requested scratch stride',()=>{
  const a=polygonRegion([{x:0,y:0},{x:2,y:0},{x:0,y:2}]),b=polygonRegion([{x:2,y:0},{x:2,y:2},{x:0,y:2}]);
  const c=compileCoverageTile(prepareCoverage([{region:a,color:'#FF000080',multiplier:1},{region:b,color:'#0000FF80',multiplier:1,shared:true}],[1,0,0,1,0,0]),{x:0,y:0,width:2,height:2});if(!c.ok)throw Error(JSON.stringify(c));
  const scratch=new Uint8ClampedArray(128*128*4);scratch.fill(255);const r=rasterizeCoverageTile(c.value,.65,scratch,128);if(!r.ok)throw Error(JSON.stringify(r));expect(r.value).toBe(scratch);
  expect([...scratch.slice(0,4)]).toEqual([255,0,0,128]);expect([...scratch.slice(4,8)]).toEqual([Math.round(255/1.65),0,Math.round(255*.65/1.65),Math.round(128*.825)]);
  expect([...scratch.slice(128*4+4,128*4+8)]).toEqual([0,0,255,83]);expect([...scratch.slice(8,128*4)]).toEqual(Array(128*4-8).fill(0));
  const zero=rasterizeCoverageTile(c.value,0,scratch,128);expect(zero.ok).toBe(true);expect([...scratch.slice(128*4+4,128*4+8)]).toEqual([0,0,0,0]);
  expect(rasterizeCoverageTile(c.value,NaN).ok).toBe(false);expect(rasterizeCoverageTile(c.value,.5,new Uint8ClampedArray(2)).ok).toBe(false);
});
