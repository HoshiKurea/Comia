import {StrokeBandFields} from './StrokeBandFields';
import { useStore } from 'zustand';
import type { BubbleTailLayer, Id, Result } from '../domain/types';
import { getProject } from '../state/documentStore';
import { mangaEditStore } from './mangaEditController';
import { beginTailEdit, updateTailEdit } from './tailEditController';
import { tailAnchors } from './tailGeometry';
import { apply, worldMatrix } from '../geometry/matrix';
import { setTailDirection } from './tailEditGeometry';
import { attachTail, detachTail } from './tailCommands';
import { MangaNumber, reportManga } from './MangaFields';

const labels: Record<BubbleTailLayer['appearance'],string>={triangle:'短直尾',line:'细线尾',curved:'弯曲长尾',thought:'多泡内心尾',jagged:'锯齿喊叫尾',flat:'平头低语尾'};
export function TailInspector({tail}:{tail:BubbleTailLayer}){
  const active=useStore(mangaEditStore,s=>s.active?.id===tail.id?s.active:null),project=active?.preview??getProject(),source=project.layers[tail.id],t=source?.type==='bubbleTail'?source:tail;
  const owner=t.parentId?project.layers[t.parentId]:undefined,anchor=tailAnchors(t,owner?.type==='bubble'?owner:undefined),world=worldMatrix(project,t.id),base=anchor.ok?apply(world,anchor.value.base):apply(world,{x:0,y:0}),tip=apply(world,t.tip),length=Math.hypot(tip.x-base.x,tip.y-base.y),angle=Math.atan2(tip.y-base.y,tip.x-base.x)*180/Math.PI;
  const run=(fn:()=>Result<unknown>)=>{const begun=beginTailEdit(t.id);if(!begun.ok){reportManga(begun);return;}reportManga(fn());};
  const direction=(degrees:number,nextLength:number)=>run(()=>{const p=mangaEditStore.getState().active!.preview,next=setTailDirection(p,t.id,degrees,nextLength);return next.ok?updateTailEdit({attachment:next.value.attachment,tip:next.value.tip,route:next.value.route}):next;});
  const setWidth=(width:number)=>run(()=>{if(t.attachment.mode==='bubble')return updateTailEdit({attachment:{...t.attachment,baseWidth:width}});const a=t.attachment.baseA,b=t.attachment.baseB,len=Math.hypot(b.x-a.x,b.y-a.y),x=(a.x+b.x)/2,y=(a.y+b.y)/2,dx=(b.x-a.x)*width/(2*len),dy=(b.y-a.y)*width/(2*len);return updateTailEdit({attachment:{mode:'free',baseA:{x:x-dx,y:y-dy},baseB:{x:x+dx,y:y+dy}}});});
  const width=t.attachment.mode==='bubble'?t.attachment.baseWidth:Math.hypot(t.attachment.baseB.x-t.attachment.baseA.x,t.attachment.baseB.y-t.attachment.baseA.y);
  const bubbles=Object.values(getProject().layers).filter(l=>l.type==='bubble'&&l.pageId===t.pageId);
  return <section className="manga-inspector" aria-label="尾巴属性"><h4>独立尾巴</h4>
    <label className="field"><span>尾形</span><select aria-label="气泡尾形" value={t.appearance} onChange={e=>run(()=>updateTailEdit({appearance:e.target.value as BubbleTailLayer['appearance']}))}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label className="field"><span>路由</span><select aria-label="气泡尾路由" value={t.route.kind} onChange={e=>run(()=>{const a=tailAnchors(t,owner?.type==='bubble'?owner:undefined);if(!a.ok)return a;const dx=t.tip.x-a.value.base.x,dy=t.tip.y-a.value.base.y;return updateTailEdit({route:e.target.value==='straight'?{kind:'straight'}:e.target.value==='polyline'?{kind:'polyline',knots:[{x:a.value.base.x+dx*.5,y:a.value.base.y+dy*.5}]}:{kind:'spline',c1:{x:a.value.base.x+dx/3+dy*.1,y:a.value.base.y+dy/3-dx*.1},c2:{x:a.value.base.x+dx*2/3+dy*.1,y:a.value.base.y+dy*2/3-dx*.1}}});})}><option value="straight">直线</option><option value="polyline">折线</option><option value="spline">三次样条</option></select></label>
    <div className="field-grid"><MangaNumber key={`${t.id}-direction`} label="尾巴方向" value={angle} step={1} apply={n=>direction(n,length)}/><MangaNumber key={`${t.id}-length`} label="尾巴长度" value={length} min={4} step={1} apply={n=>direction(angle,n)}/><MangaNumber key={`${t.id}-width`} label="尾巴底座宽" value={width} min={4} max={128} step={1} apply={setWidth}/></div>
    {t.appearance==='thought'&&<MangaNumber key={`${t.id}-beads`} label="尾巴小泡数量" value={t.beads} min={3} max={9} apply={n=>run(()=>updateTailEdit({beads:n}))}/>}
    {t.appearance==='jagged'&&<MangaNumber key={`${t.id}-zigzag`} label="尾巴锯齿数量" value={t.zigzag} min={2} max={8} apply={n=>run(()=>updateTailEdit({zigzag:n}))}/>}
    {t.route.kind==='polyline'&&<><button disabled={t.route.knots.length>=6} onClick={()=>run(()=>{const route=t.route;if(route.kind!=='polyline')return updateTailEdit({});const a=tailAnchors(t,owner?.type==='bubble'?owner:undefined);if(!a.ok)return a;const last=route.knots.at(-1)??a.value.base;return updateTailEdit({route:{kind:'polyline',knots:[...route.knots,{x:(last.x+t.tip.x)/2,y:(last.y+t.tip.y)/2}]}});})}>增加尾巴折点</button><button disabled={!t.route.knots.length} onClick={()=>run(()=>updateTailEdit({route:t.route.kind==='polyline'?{kind:'polyline',knots:t.route.knots.slice(0,-1)}:t.route}))}>删除最后折点</button></>}
    {t.attachment.mode==='free'&&t.style&&<><label className="field">尾巴填充RGBA<input aria-label="尾巴填充RGBA" defaultValue={t.style.fill} key={`${t.id}-${t.style.fill}`} onBlur={e=>run(()=>updateTailEdit({style:{...t.style!,fill:e.target.value.toUpperCase()}}))}/></label><label className="field">尾巴边色RGBA<input aria-label="尾巴边色RGBA" defaultValue={t.style.borderColor} key={`${t.id}-${t.style.borderColor}`} onBlur={e=>run(()=>updateTailEdit({style:{...t.style!,borderColor:e.target.value.toUpperCase()}}))}/></label><MangaNumber label="独立尾巴边宽" value={t.style.borderWidth} min={0} max={256} apply={n=>run(()=>updateTailEdit({style:{...t.style!,borderWidth:n}}))}/><MangaNumber label="独立尾巴笔压" value={t.stroke?.pressure??0} min={0} max={.65} step={.01} apply={n=>run(()=>updateTailEdit({stroke:{pressure:n,seed:t.stroke?.seed??42}}))}/></>}
    {t.attachment.mode==='free'&&t.style&&<StrokeBandFields prefix="独立尾巴" style={t.style} update={patch=>run(()=>updateTailEdit({style:{...t.style!,...patch}}))}/>}
    {t.attachment.mode==='bubble'?<><p className="hint">填充、边色与笔压继承气泡主体。拖底座改变附着点，拖尖端与路由柄独立调整。</p><button disabled={!!active} onClick={()=>reportManga(detachTail(t.id))}>拆出独立尾巴</button></>:<label className="field"><span>绑定气泡</span><select aria-label="绑定尾巴到气泡" disabled={!!active} value="" onChange={e=>{if(e.target.value)reportManga(attachTail(t.id,e.target.value as Id));}}><option value="">选择同页气泡</option>{bubbles.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
    <p className="hint">直接拖画布手柄，一次拖动对应一次撤销。属性预览可集中调整后完成或取消。</p>{active&&<p className="hint">在画布浮窗中完成或取消本次编辑。</p>}
  </section>;
}
