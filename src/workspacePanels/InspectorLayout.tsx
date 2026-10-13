import { useId, useRef, useState, type ReactNode } from 'react';
import type { Layer, Project } from '../domain/types';
import { LayerThumbnail } from '../layers/LayerThumbnail';
import { renameLayer } from '../layers/visibility';
import { sessionStore,pushNotice } from '../state/sessionStore';
import './inspector.css';

const names: Record<Layer['type'], string> = { panel: '图形图层', image: '素材图层', bubble: '气泡图层', bubbleTail: '气泡尾图层', text: '文字图层', decoration: '装饰图层', group: '编组', pageBackground: '页面背景' };
export function InspectorLayout({ layer, project, count = 1, children }: { layer: Layer; project: Project; count?: number; children: ReactNode }) {
  const [view, setView] = useState('all'), [renaming, setRenaming] = useState(false), [draft, setDraft] = useState(layer.name), cancelled = useRef(false);
  const instance = useId(), categories = [['all', '图层属性'], ['adjustments', '调整'], ['effects', '效果']];
  const rename = () => { if (!cancelled.current && draft !== layer.name) { const r = renameLayer(layer.id, draft); if (!r.ok) pushNotice('error', r.problems[0].message); } setRenaming(false); };
  return <div className="inspector-content inspector-modern" data-inspector-view={view}>
    <div className="inspector-category-tabs" role="tablist" aria-label="属性类别" onKeyDown={e => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return; e.preventDefault(); const current = categories.findIndex(c => c[0] === view), next = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (current + (e.key === 'ArrowRight' ? 1 : 2)) % 3; setView(categories[next][0]); (e.currentTarget.querySelectorAll('button')[next] as HTMLButtonElement).focus(); }}>{categories.map(([id, label]) => <button role="tab" id={`${instance}-${id}`} aria-controls={`${instance}-sections`} tabIndex={view === id ? 0 : -1} aria-selected={view === id} key={id} onClick={() => setView(id)}>{label}</button>)}</div>
    <div className="inspector-layer-summary"><div className="inspector-preview"><LayerThumbnail project={project} id={layer.id} size={64}/></div><div className="inspector-layer-description">
      {renaming ? <input autoFocus aria-label="图层名称" value={draft} onChange={e => setDraft(e.target.value)} onBlur={rename} onKeyDown={e => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelled.current = true; e.currentTarget.blur(); } }}/> : <div className="inspector-layer-name"><strong>{count > 1 ? `已选择 ${count} 个对象` : layer.name}</strong>{count === 1 && <button aria-label="重命名图层" title="重命名图层" onClick={() => { setDraft(layer.name); cancelled.current = false; setRenaming(true); }}><InspectorIcon kind="rename"/></button>}</div>}
      <small>{count > 1 ? '共同变换 · 单次撤销' : layer.type==='decoration'&&layer.spec.kind==='shape'?'图形图层':names[layer.type]}</small>
    </div><div className="inspector-layer-cycle">{[-1,1].map(direction=><button key={direction} aria-label={direction<0?'选择上一个图层':'选择下一个图层'} onClick={()=>{const order:string[]=[];const visit=(id:string)=>{const l=project.layers[id];if(l){order.push(id);if('children'in l)l.children.forEach(visit);}};project.pages[layer.pageId].roots.forEach(visit);const index=order.indexOf(layer.id),next=order[(index+direction+order.length)%order.length];if(next)sessionStore.setState({selection:[next],selectionAnchorId:next});}}>{direction<0?'⌃':'⌄'}</button>)}</div></div>
    <div className="inspector-sections" id={`${instance}-sections`} role="tabpanel" aria-labelledby={`${instance}-${view}`}>{children}</div>
  </div>;
}
export function InspectorSection({ title, category, children }: { title: string; category: 'transform' | 'appearance' | 'adjustments' | 'effects' | 'quick'; children: ReactNode }) {
  const ref=useRef<HTMLDetailsElement>(null),[menu,setMenu]=useState(false);
  return <details ref={ref} open className="inspector-section" data-inspector-category={category}><summary><span className="inspector-chevron" aria-hidden="true"/><span>{title}</span>{category!=='transform'&&category!=='quick'&&<button className="inspector-section-menu" aria-label={`${title}选项`} onClick={e=>{e.preventDefault();e.stopPropagation();setMenu(!menu);}}>⋯</button>}</summary>{menu&&<div className="inspector-section-options" role="menu"><button role="menuitem" onClick={()=>{if(ref.current)ref.current.open=false;setMenu(false);}}>折叠此区域</button><button role="menuitem" onClick={()=>{ref.current?.closest('.inspector-sections')?.querySelectorAll<HTMLDetailsElement>('.inspector-section').forEach(d=>d.open=true);setMenu(false);}}>展开所有区域</button></div>}<div className="inspector-section-content">{children}</div></details>;
}
export function InspectorIcon({ kind }: { kind: 'rename' | 'copy' | 'delete' | 'up' | 'down' | 'top' | 'bottom' }) {
  const paths = { rename: 'M4 17l1-5L15 2l5 5-10 10-6 1zm9-12l5 5', copy: 'M8 8h12v12H8zM4 16H2V2h14v2', delete: 'M4 6h16M9 3h6M6 6l1 14h10l1-14M10 10v6m4-6v6', up: 'M12 20V5m-6 6l6-6 6 6', down: 'M12 4v15m-6-6l6 6 6-6', top: 'M4 3h16M12 21V7m-6 6l6-6 6 6', bottom: 'M4 21h16M12 3v14m-6-6l6 6 6-6' };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]}/></svg>;
}
