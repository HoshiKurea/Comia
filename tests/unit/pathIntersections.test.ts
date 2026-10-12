import { expect, it } from 'vitest';
import { pathsHaveIntersection } from '../../src/geometry/pathIntersections';
import { segmentsIntersect } from '../../src/geometry/polygon';
import { mulberry32 } from '../../src/bubbles/handDrawn';
it('matches independent brute-force intersections for open/closed paths, including short segments',()=>{
  const rng=mulberry32(392);for(const closed of [false,true])for(let trial=0;trial<300;trial++){const points=Array.from({length:12},()=>({x:rng()*100,y:rng()*100}));if(trial%3===0)points[4]={x:points[3].x+1e-7,y:points[3].y};let expected=false;const count=points.length-(closed?0:1);for(let i=0;i<count;i++)for(let j=i+2;j<count;j++){if(closed&&(j+1)%count===i)continue;if(segmentsIntersect(points[i],points[(i+1)%points.length],points[j],points[(j+1)%points.length],1e-8))expected=true;}expect(pathsHaveIntersection([{points,closed}]),`${closed}:${trial}`).toBe(expected);}
});
it('rejects intersecting separate rings but permits a properly contained hole and sharp authored corners',()=>{
  const outer={points:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}],closed:true},hole={points:[{x:2,y:2},{x:8,y:2},{x:8,y:8},{x:2,y:8}],closed:true};expect(pathsHaveIntersection([outer,hole])).toBe(false);expect(pathsHaveIntersection([outer,{...hole,points:hole.points.map(p=>({x:p.x+6,y:p.y}))}])).toBe(true);
});
