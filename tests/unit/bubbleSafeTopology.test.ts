import { expect, it } from 'vitest';
import clipping from 'polygon-clipping';
import { safeTextBox } from '../../src/bubbles/safeTextBox';
import { closedPolygon, pathToRegion, regionToPath } from '../../src/geometry/renderRegion';
import { polygonRegion, regionArea } from '../../src/geometry/pathRegion';
import { generateContour, buildContourPath, handDrawnPreset } from '../../src/bubbles/handDrawn';
import { createLayer } from '../../src/domain/factories';
import { distanceToSegment } from '../../src/geometry/simplePolygon';
it('keeps each seeded safe rectangle inside the actual region with its full stroke padding, checked by independent boolean difference',()=>{
  for(let seed=0;seed<40;seed++){const b=createLayer('bubble','00000000-0000-4000-8000-000000000000');if(b.type!=='bubble')throw Error('bubble');b.shape=seed%2?'handPolygon':'handOval';b.handDrawn=handDrawnPreset('rough',seed);const c=generateContour(b);if(!c.ok)throw Error(JSON.stringify(c));const path=buildContourPath(c.value,b.width,b.height);if(!path.ok)throw Error(JSON.stringify(path));const r=pathToRegion(path.value),box=safeTextBox(path.value,4);if(!r.ok||!box.ok)throw Error('safe');const q=box.value,corners=[{x:q.x,y:q.y},{x:q.x+q.width,y:q.y},{x:q.x+q.width,y:q.y+q.height},{x:q.x,y:q.y+q.height}];expect(regionArea(clipping.difference(closedPolygon(corners),r.value))).toBeLessThan(1e-7);for(const poly of r.value)for(const ring of poly)for(let i=0;i+1<ring.length;i++)for(const p of corners)expect(distanceToSegment(p,{x:ring[i][0],y:ring[i][1]},{x:ring[i+1][0],y:ring[i+1][1]})).toBeGreaterThanOrEqual(14.25-1e-6);}
});
it('does not admit a rectangle spanning a hole or separated islands, even when its corners are inside',()=>{
  const rect=(x:number,y:number,w:number,h:number)=>polygonRegion([{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]),region=clipping.difference(rect(0,0,300,300),rect(130,130,40,40));for(const r of[region,clipping.union(rect(0,0,100,200),rect(200,0,100,200))]){const b=safeTextBox(regionToPath(r),3);if(!b.ok)throw Error(JSON.stringify(b));const q=b.value;if(q.width*q.height>0)expect(regionArea(clipping.difference(rect(q.x,q.y,q.width,q.height),r))).toBeLessThan(1e-7);}
});
