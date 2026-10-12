import { fail, ok, problem, type Point, type Result } from '../domain/types';

export type DragAxis = 'x' | 'y';
export interface NodeSnap { coordinate:number; vertexIndex:number }
export interface NodeAssistState { axis:DragAxis|null; snapX:NodeSnap|null; snapY:NodeSnap|null }
export interface NodeAssistContext { originPage:Point; pointerDownPage:Point; zoom:number; neighbors:{vertexIndex:number;page:Point}[] }
export interface NodeGuide { coordinate:'x'|'y'; value:number; kind:'axis'|'neighbor'; vertexIndex?:number }
export interface NodeAssistResult { pagePoint:Point; state:NodeAssistState; guides:NodeGuide[] }
export const emptyNodeAssist=():NodeAssistState=>({axis:null,snapX:null,snapY:null});
const finitePoint=(p:Point)=>Number.isFinite(p.x)&&Number.isFinite(p.y);

/** Screen-pixel hysteresis; no timers or dependence on previously snapped positions. */
export function assistNodeDrag(c:NodeAssistContext,pointer:Point,alt:boolean,previous:NodeAssistState):Result<NodeAssistResult> {
  if(!finitePoint(pointer)||!finitePoint(c.originPage)||!finitePoint(c.pointerDownPage)||!Number.isFinite(c.zoom)||c.zoom<=0||c.neighbors.some(n=>!finitePoint(n.page)))return fail(problem('node/assist','节点吸附坐标无效，保留最后合法预览'));
  const q={x:c.originPage.x+pointer.x-c.pointerDownPage.x,y:c.originPage.y+pointer.y-c.pointerDownPage.y};
  const d={x:c.zoom*(q.x-c.originPage.x),y:c.zoom*(q.y-c.originPage.y)};
  if(!finitePoint(q)||!finitePoint(d))return fail(problem('node/assist','节点位移超出有效范围，保留最后合法预览'));
  if(alt)return ok({pagePoint:q,state:emptyNodeAssist(),guides:[]});
  if(Math.hypot(d.x,d.y)<3)return ok({pagePoint:{...c.originPage},state:emptyNodeAssist(),guides:[]});
  let axis=previous.axis,released:DragAxis|null=null;
  if(axis==='x'&&Math.abs(d.y)>12){axis=null;released='x';}
  if(axis==='y'&&Math.abs(d.x)>12){axis=null;released='y';}
  if(!axis){
    if(released!=='x'&&Math.abs(d.x)>=1.5*Math.abs(d.y)&&Math.abs(d.y)<=6)axis='x';
    else if(released!=='y'&&Math.abs(d.y)>=1.5*Math.abs(d.x)&&Math.abs(d.x)<=6)axis='y';
  }
  const point={x:axis==='y'?c.originPage.x:q.x,y:axis==='x'?c.originPage.y:q.y},state:NodeAssistState={axis,snapX:null,snapY:null},guides:NodeGuide[]=[];
  if(axis)guides.push({coordinate:axis==='x'?'y':'x',value:axis==='x'?c.originPage.y:c.originPage.x,kind:'axis'});
  for(const dimension of ['x','y']as const){
    if(axis==='x'&&dimension==='y'||axis==='y'&&dimension==='x')continue;
    const held=dimension==='x'?previous.snapX:previous.snapY;
    let snap=held&&c.zoom*Math.abs(q[dimension]-held.coordinate)<=10?held:null;
    if(!snap){
      const targets=c.neighbors.map(n=>({coordinate:n.page[dimension],vertexIndex:n.vertexIndex})).filter(n=>c.zoom*Math.abs(q[dimension]-n.coordinate)<=6);
      targets.sort((a,b)=>Math.abs(q[dimension]-a.coordinate)-Math.abs(q[dimension]-b.coordinate)||a.vertexIndex-b.vertexIndex);snap=targets[0]??null;
    }
    if(snap){point[dimension]=snap.coordinate;if(dimension==='x')state.snapX=snap;else state.snapY=snap;guides.push({coordinate:dimension,value:snap.coordinate,kind:'neighbor',vertexIndex:snap.vertexIndex});}
  }
  return ok({pagePoint:point,state,guides});
}
