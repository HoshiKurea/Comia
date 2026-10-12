import type { BubbleLayer, BubbleTailLayer, Id, Point, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { createLayer } from '../domain/factories';
import { getProject } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { execute } from '../history/commandBus';
import { apply, IDENTITY, inverse, multiply, translation, worldMatrix } from '../geometry/matrix';
import { flattenForRender, LOCAL_TARGET } from '../geometry/flattenForBoolean';
import { mangaBodyPath } from './handDrawn';
import { buildTailAppearance, tailAnchors } from './tailGeometry';
import { bubbleTails, effectiveBubbleStyle } from './ownership';
import { promoteMangaDraft } from './mangaDraft';
import { MANGA } from '../domain/limits';
import { perimeter } from './geometry';

function removeFromOwner(p:Project,layer:BubbleTailLayer):void{
  const owner=layer.parentId?p.layers[layer.parentId]:undefined;
  if(owner&&'children'in owner)owner.children=owner.children.filter(id=>id!==layer.id);
  else p.pages[layer.pageId].roots=p.pages[layer.pageId].roots.filter(id=>id!==layer.id);
}
export function closestTailU(owner:BubbleLayer,point:Point):Result<{u:number;total:number}>{
  const path=mangaBodyPath(owner);if(!path.ok)return path;
  const flat=flattenForRender(path.value,{...LOCAL_TARGET,tolerancePx:1/64});if(!flat.ok)return flat;
  const points=flat.value[0].points,{positions,total}=perimeter(points);let best=Infinity,u=0;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy,t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(len||1))),dist=(point.x-a.x-t*dx)**2+(point.y-a.y-t*dy)**2;
    if(dist<best){best=dist;u=(positions[i]+t*Math.sqrt(len))/total;}
  }
  return ok({u:u%1,total});
}
export function attachTailDraft(p:Project,tailId:Id,bubbleId:Id):Result<void>{
  const tail=p.layers[tailId],owner=p.layers[bubbleId];
  if(tail?.type!=='bubbleTail'||owner?.type!=='bubble'||tail.pageId!==owner.pageId)return fail(problem('tail/target','请选择同页尾巴与气泡'));
  if(tail.parentId===bubbleId&&tail.attachment.mode==='bubble')return ok(undefined);
  if(tail.attachment.mode!=='free')return fail(problem('tail/owned','请先拆出尾巴，再换绑其他气泡'));
  if(bubbleTails(p,bubbleId).length>=MANGA.maxTailsPerBubble)return fail(problem('tail/capacity','同一气泡最多4个尾巴'));
  const flags=effectiveLayerFlags(p,bubbleId),oldFlags=effectiveLayerFlags(p,tailId);if(flags.locked||!flags.visible||oldFlags.locked||!oldFlags.visible)return fail(problem('tail/locked','锁定或隐藏的气泡/尾巴不能绑定'));
  const ownerInv=inverse(worldMatrix(p,bubbleId));if(!ownerInv.ok)return ownerInv;
  const transform=multiply(ownerInv.value,worldMatrix(p,tailId)),a=apply(transform,tail.attachment.baseA),b=apply(transform,tail.attachment.baseB),base={x:(a.x+b.x)/2,y:(a.y+b.y)/2},anchor=closestTailU(owner,base);if(!anchor.ok)return anchor;
  const candidate:BubbleTailLayer={...tail,parentId:bubbleId,matrix:IDENTITY,attachment:{mode:'bubble',attachU:anchor.value.u,baseWidth:Math.max(4,Math.min(128,.2*anchor.value.total,Math.hypot(b.x-a.x,b.y-a.y)))},tip:apply(transform,tail.tip),style:null,stroke:null,legacySplice:false,
    route:tail.route.kind==='polyline'?{kind:'polyline',knots:tail.route.knots.map(pt=>apply(transform,pt))}:tail.route.kind==='spline'?{kind:'spline',c1:apply(transform,tail.route.c1),c2:apply(transform,tail.route.c2)}:{kind:'straight'}};
  const preview={...p,layers:{...p.layers,[tailId]:candidate}},geometry=buildTailAppearance(preview,tailId);if(!geometry.ok)return geometry;
  removeFromOwner(p,tail);p.layers[tailId]=candidate;owner.children.push(tailId);for(const existing of bubbleTails(p,bubbleId))existing.legacySplice=false;
  return ok(undefined);
}
export function createFreeTail(pageId:Id,appearance:BubbleTailLayer['appearance'],origin:Point):Result<Id>{
  const p=getProject();if(!p.pages[pageId]||!Number.isFinite(origin.x)||!Number.isFinite(origin.y))return fail(problem('tail/page','目标页或放置坐标非法'));
  const tail=createLayer('bubbleTail',pageId) as BubbleTailLayer;tail.appearance=appearance;tail.matrix=translation(origin.x,origin.y);
  if(appearance==='curved'){tail.tip={x:12,y:140};tail.route={kind:'spline',c1:{x:12,y:40},c2:{x:60,y:90}};}
  const preview={...p,layers:{...p.layers,[tail.id]:tail}};const checked=buildTailAppearance(preview,tail.id);if(!checked.ok)return checked;
  const result=execute({label:'创建独立尾巴',context:{pageId,selection:sessionStore.getState().selection},afterSelection:[tail.id],mutate(draft){promoteMangaDraft(draft);draft.layers[tail.id]=tail;draft.pages[pageId].roots.push(tail.id);}});
  return result.ok?ok(tail.id):result;
}
export function createAttachedTail(bubbleId:Id,appearance:BubbleTailLayer['appearance'],attachPage?:Point):Result<Id>{
  const p=getProject(),owner=p.layers[bubbleId];if(owner?.type!=='bubble')return fail(problem('tail/owner','请选择气泡'));
  const flags=effectiveLayerFlags(p,bubbleId);if(flags.locked||!flags.visible)return fail(problem('tail/locked','气泡已锁定或隐藏'));
  const preview=structuredClone(p);promoteMangaDraft(preview);const body=preview.layers[bubbleId] as BubbleLayer;
  if(bubbleTails(preview,bubbleId).length>=4)return fail(problem('tail/capacity','同一气泡最多4个尾巴'));
  const tail=createLayer('bubbleTail',owner.pageId) as BubbleTailLayer;tail.appearance=appearance;tail.tip={x:body.width*.65,y:body.height+Math.min(appearance==='curved'?120:60,3*Math.max(body.width,body.height))};
  if(attachPage){const inv=inverse(worldMatrix(preview,bubbleId));if(!inv.ok)return inv;const q=apply(inv.value,attachPage),u=closestTailU(body,q);if(!u.ok)return u;tail.attachment={mode:'bubble',attachU:u.value.u,baseWidth:Math.min(24,.2*u.value.total)};const anchor=tailAnchors(tail,body);if(!anchor.ok)return anchor;const cx=body.width/2,cy=body.height/2,dx=anchor.value.base.x-cx,dy=anchor.value.base.y-cy,len=Math.hypot(dx,dy)||1,extension=appearance==='curved'?120:60;tail.tip={x:anchor.value.base.x+dx/len*extension,y:anchor.value.base.y+dy/len*extension};}
  const anchor=closestTailU(body,tail.tip);if(!anchor.ok)return anchor;
  tail.parentId=bubbleId;tail.matrix=IDENTITY;tail.style=null;tail.stroke=null;tail.attachment={mode:'bubble',attachU:anchor.value.u,baseWidth:Math.min(24,128,.2*anchor.value.total)};
  const bases=tailAnchors(tail,body);if(!bases.ok)return bases;
  if(appearance==='curved'){const dx=tail.tip.x-bases.value.base.x,dy=tail.tip.y-bases.value.base.y;tail.route={kind:'spline',c1:{x:bases.value.base.x+dx*.3+dy*.15,y:bases.value.base.y+dy*.3-dx*.15},c2:{x:tail.tip.x-dx*.3+dy*.15,y:tail.tip.y-dy*.3-dx*.15}};}
  preview.layers[tail.id]=tail;body.children.push(tail.id);for(const t of bubbleTails(preview,bubbleId))t.legacySplice=false;
  const checked=buildTailAppearance(preview,tail.id);if(!checked.ok)return checked;
  const result=execute({label:'添加气泡尾巴',context:{pageId:owner.pageId,selection:sessionStore.getState().selection},afterSelection:[tail.id],mutate(draft){promoteMangaDraft(draft);const b=draft.layers[bubbleId] as BubbleLayer;draft.layers[tail.id]=tail;b.children.push(tail.id);for(const t of bubbleTails(draft,bubbleId))t.legacySplice=false;}});
  if(result.ok)sessionStore.setState(s=>({expanded:[...new Set([...s.expanded,bubbleId])]}));
  return result.ok?ok(tail.id):result;
}
export function attachTail(tailId:Id,bubbleId:Id):Result<void>{
  const p=getProject(),tail=p.layers[tailId];if(tail?.type!=='bubbleTail')return fail(problem('tail/target','尾巴已不存在'));
  const preview=structuredClone(p),checked=attachTailDraft(preview,tailId,bubbleId);if(!checked.ok)return checked;
  const result=execute({label:'绑定气泡尾巴',context:{pageId:tail.pageId,selection:sessionStore.getState().selection},afterSelection:[tailId],mutate(draft){const next=attachTailDraft(draft,tailId,bubbleId);if(!next.ok)throw Error(next.problems[0].message);}});
  return result.ok?ok(undefined):result;
}
export function detachTailDraft(p:Project,tailId:Id,readOnlySnapshot=false):Result<void>{
  const tail=p.layers[tailId];if(tail?.type!=='bubbleTail'||tail.attachment.mode!=='bubble'||!tail.parentId)return fail(problem('tail/owned','请选择已绑定气泡的尾巴'));
  const body=p.layers[tail.parentId];if(body.type!=='bubble')return fail(problem('tail/owner','所属气泡已不存在'));
  if(!readOnlySnapshot&&effectiveLayerFlags(p,tailId).locked)return fail(problem('tail/locked','锁定尾巴不能拆出'));
  const bases=tailAnchors(tail,body);if(!bases.ok)return bases;
  let anchor: Id=body.id,parentId=body.parentId;
  const originalParent=parentId?p.layers[parentId]:null;if(originalParent?.type==='group'&&originalParent.dialogue){anchor=originalParent.id;parentId=originalParent.parentId;}
  const parent=parentId?p.layers[parentId]:null;if(parent&&parent.type!=='group')return fail(problem('tail/parent','尾巴无法拆入这个父容器'));
  const inv=inverse(parentId?worldMatrix(p,parentId):IDENTITY);if(!inv.ok)return inv;
  const effective=effectiveBubbleStyle(p,body);
  const matrix=multiply(inv.value,worldMatrix(p,tailId)),candidate:BubbleTailLayer={...tail,parentId,matrix,attachment:{mode:'free',baseA:bases.value.a,baseB:bases.value.b},style:{...effective.style},stroke:{pressure:effective.pressure,seed:effective.seed},legacySplice:false};
  if(!effectiveLayerFlags(p,tailId).visible)candidate.visible=false;
  const checked=buildTailAppearance({...p,layers:{...p.layers,[tailId]:candidate}},tailId);if(!checked.ok)return checked;
  removeFromOwner(p,tail);p.layers[tailId]=candidate;const siblings=parent?.type==='group'?parent.children:p.pages[tail.pageId].roots;siblings.splice(siblings.indexOf(anchor)+1,0,tailId);
  return ok(undefined);
}
export function detachTail(tailId:Id):Result<void>{const p=getProject(),tail=p.layers[tailId];if(tail?.type!=='bubbleTail')return fail(problem('tail/target','尾巴已不存在'));const preview=structuredClone(p),checked=detachTailDraft(preview,tailId);if(!checked.ok)return checked;const result=execute({label:'拆出独立尾巴',context:{pageId:tail.pageId,selection:sessionStore.getState().selection},afterSelection:[tailId],mutate(draft){const next=detachTailDraft(draft,tailId);if(!next.ok)throw Error(next.problems[0].message);}});return result.ok?ok(undefined):result;}
export function removeTail(id:Id):Result<void>{const p=getProject(),tail=p.layers[id];if(tail?.type!=='bubbleTail')return fail(problem('tail/target','尾巴已不存在'));if(effectiveLayerFlags(p,id).locked)return fail(problem('tail/locked','锁定尾巴不能删除'));const result=execute({label:'删除气泡尾巴',context:{pageId:tail.pageId,selection:sessionStore.getState().selection},afterSelection:tail.parentId?[tail.parentId]:[],mutate(draft){removeFromOwner(draft,draft.layers[id] as BubbleTailLayer);delete draft.layers[id];}});return result.ok?ok(undefined):result;}

/** Legacy inspector buttons remain real operations after a project upgrades to6. */
export function setPrimaryTailKind(bubbleId:Id,kind:'triangle'|'line'|null):Result<void>{
  const p=getProject(),body=p.layers[bubbleId];if(body?.type!=='bubble')return fail(problem('tail/owner','请选择气泡'));
  if(effectiveLayerFlags(p,bubbleId).locked)return fail(problem('tail/locked','气泡已锁定'));
  const tails=bubbleTails(p,bubbleId);
  if(kind&&!tails.length){const result=createAttachedTail(bubbleId,kind);if(!result.ok)return result;sessionStore.setState({selection:[bubbleId]});return ok(undefined);}
  const changed=kind?tails.slice(0,1):tails;
  if(changed.some(t=>effectiveLayerFlags(p,t.id).locked))return fail(problem('tail/locked','目标尾巴已锁定'));
  const result=execute({label:kind?'修改主尾巴形态':'移除气泡全部尾巴',context:{pageId:body.pageId,selection:sessionStore.getState().selection},afterSelection:[bubbleId],mutate(draft){const b=draft.layers[bubbleId] as BubbleLayer;if(kind){const t=draft.layers[tails[0].id] as BubbleTailLayer;t.appearance=kind;if(t.route.kind!=='straight')t.legacySplice=false;}else{b.children=b.children.filter(id=>!tails.some(t=>t.id===id));for(const t of tails)delete draft.layers[t.id];}}});
  return result.ok?ok(undefined):result;
}
