import { expect, it } from 'vitest';
import { closestPathPoint } from '../../src/geometry/closestPathPoint';
import { apply } from '../../src/geometry/matrix';
import type { ShapePath } from '../../src/geometry/types';
const path:ShapePath={ops:[{op:'M',p:{x:0,y:0}},{op:'C',c1:{x:0,y:100},c2:{x:100,y:100},p:{x:100,y:0}}],bounds:{x:0,y:0,width:100,height:100}};
it('inserts on the actual cubic under a rotated nonuniform output metric, not on its chord',()=>{
  const matrix:[number,number,number,number,number,number]=[2,.5,.3,.7,200,80],q={x:48,y:78},r=closestPathPoint(path,q,{localToOutput:matrix,tolerancePx:.25});if(!r.ok)throw Error(JSON.stringify(r));expect(r.value.afterIndex).toBe(0);expect(r.value.point.y).toBeGreaterThan(74);
  let minimum=Infinity;const out=apply(matrix,q);for(let i=0;i<=10000;i++){const t=i/10000,p=apply(matrix,{x:100*(3*t*t-2*t*t*t),y:300*t*(1-t)});minimum=Math.min(minimum,Math.hypot(p.x-out.x,p.y-out.y));}expect(r.value.distance).toBeCloseTo(minimum,4);
});
it('rejects empty, nonfinite and unbounded projection requests without fabricating a point',()=>{
  expect(closestPathPoint({...path,ops:[]},{x:0,y:0}).ok).toBe(false);expect(closestPathPoint(path,{x:NaN,y:0}).ok).toBe(false);
  expect(closestPathPoint(path,{x:0,y:0},{localToOutput:[1e20,0,0,1e20,0,0],tolerancePx:.25}).ok).toBe(false);
});
