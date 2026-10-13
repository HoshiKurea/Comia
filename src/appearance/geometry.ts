import type { Id, Layer, PanelLayer, Point, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { getProject } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { execute } from '../history/commandBus';
import { appearanceGuard } from './commands';
import { freeImage } from '../images/freeImage';
import { multiply } from '../geometry/matrix';
import { polyBounds } from '../geometry/polygon';
import { migrateProject } from '../storage/migrateProject';
import { finishActiveTextEdit } from '../text/editLifecycle';
export function geometryPanel(layer:Layer|undefined):PanelLayer|null {
  if(layer?.type==='panel')return layer;
  if(layer?.type==='decoration'&&layer.spec.kind==='shape')return {...layer,type:'panel',role:'leaf',children:[],geometry:layer.spec.geometry,geometryMode:layer.spec.geometryMode,style:layer.spec.style};
  return null;
}
export function setGeometry(layer:Layer,geometry:Point[]):void {
  if(layer.type==='panel')layer.geometry=geometry;
  else if(layer.type==='decoration'&&layer.spec.kind==='shape'){const box=polyBounds(geometry);layer.spec={...layer.spec,geometry,width:box.width,height:box.height};}
}
export function isRectangle(p:Point[]):boolean {
  if(p.length!==4)return false;return p.every((a,i)=>{const b=p[(i+1)%4],c=p[(i+2)%4],u={x:b.x-a.x,y:b.y-a.y},v={x:c.x-b.x,y:c.y-b.y};return Math.hypot(u.x,u.y)>1e-6&&Math.abs(u.x*v.x+u.y*v.y)<=1e-6*Math.hypot(u.x,u.y)*Math.hypot(v.x,v.y);});
}
export function rectangleVertex(p:Point[],i:number,q:Point):Point[]{
  if(!isRectangle(p))return p;const a=p[(i+2)%4],b=p[(i+1)%4],len=Math.hypot(b.x-a.x,b.y-a.y),e={x:(b.x-a.x)/len,y:(b.y-a.y)/len},f={x:-e.y,y:e.x},d={x:q.x-a.x,y:q.y-a.y},x=d.x*e.x+d.y*e.y,y=d.x*f.x+d.y*f.y;
  return p.map((v,j)=>j===i?q:j===(i+1)%4?{x:a.x+x*e.x,y:a.y+x*e.y}:j===(i+3)%4?{x:a.x+y*f.x,y:a.y+y*f.y}:{...v});
}
export function convertPanelToShape(id:Id):Result<void>{
  const text=finishActiveTextEdit();if(!text.ok)return text;
  const p=getProject(),l=p.layers[id],guard=appearanceGuard(p,[id]);if(!guard.ok)return guard;if(l?.type!=='panel'||l.role!=='leaf')return fail(problem('shape/source','分格父框请先“拆为独立分镜”，再转换其中一格'));
  const upgraded=migrateProject(p);if(!upgraded.ok)return upgraded;const draft=structuredClone(upgraded.value),target=draft.layers[id] as PanelLayer,b=polyBounds(target.geometry),children=[...target.children];
  for(const child of children){const image=freeImage(draft,child);draft.layers[child]={...image,parentId:target.parentId,matrix:multiply(target.matrix,image.matrix)};if(draft.layers[child].type==='image')delete draft.layers[child].panelClip;}
  const {editorNumber,nameMode,geometry,geometryMode,style,children:unused,role,...base}=target;
  draft.layers[id]={...base,type:'decoration',spec:{kind:'shape',width:b.width,height:b.height,geometry:structuredClone(geometry),geometryMode:geometryMode??'convex',style:structuredClone(style)}};
  const owner=target.parentId?draft.layers[target.parentId]:null;if(owner?.type==='panel')return fail(problem('shape/parent','请先将嵌套分格拆为独立分镜，再转为形状'));
  const list=owner?.type==='group'?owner.children:draft.pages[target.pageId].roots;list.splice(list.indexOf(id)+1,0,...children);
  const r=execute({label:'分镜转为形状',context:{pageId:l.pageId,selection:sessionStore.getState().selection},afterSelection:[id],mutate(p){Object.assign(p,draft);}});return r.ok?ok(undefined):r;
}
