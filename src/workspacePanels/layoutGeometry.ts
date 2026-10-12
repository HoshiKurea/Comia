import type { Point,Rect } from '../domain/types';
import type { PanelLayout } from './types';
export const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(n,hi));
export function fitFloatingRect(rect:Rect,size:{width:number;height:number}):Rect {
  const aw=Math.max(1,size.width-16),ah=Math.max(1,size.height-16),width=clamp(rect.width,Math.min(224,aw),aw),height=clamp(rect.height,Math.min(160,ah),ah);
  return {x:clamp(rect.x,8,Math.max(8,size.width-width-8)),y:clamp(rect.y,8,Math.max(8,size.height-height-8)),width,height};
}
export function dockWidths(layout:PanelLayout,width:number) {
  const l=layout.docks.left.groups.length?layout.docks.left.width:0,r=layout.docks.right.groups.length?layout.docks.right.width:0, budget=Math.max(0,width-240),count=Number(l>0)+Number(r>0);
  if(width<=690 || budget<count*192)return {left:0,right:0,narrow:true};
  if(l+r<=budget)return {left:l,right:r,narrow:false};
  const left=l?clamp(budget*l/(l+r),192,budget-(r?192:0)):0;
  return {left,right:budget-left,narrow:false};
}
export const contains=(r:Rect,p:Point)=>p.x>=r.x&&p.y>=r.y&&p.x<=r.x+r.width&&p.y<=r.y+r.height;
