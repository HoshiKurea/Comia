import { bindSelectedImages, unbindPanelImages, bindingDisabledReason, unbindingDisabledReason } from '../images/panelAssociation';
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { Id, LabelColor, Project, Result } from '../domain/types';
import { firstMessage } from '../domain/types';
import { sessionStore, setSelection, pushNotice } from '../state/sessionStore';
import { buildRows, rangeSelection } from './selectors';
import { renameLayer, setLabel, setLocked, setVisible } from './visibility';
import { moveLayers, reorderSiblings } from './reorder';
import { copyToClipboard, pasteFromClipboard } from './clipboard';
import { deleteSelected } from '../app/actions';
import { addPageBackground } from '../pages/backgroundCommands';
import { LayerThumbnail } from './LayerThumbnail';
import './panel.css';
import { FocusDialog } from '../app/FocusDialog';
import { clearHistory } from '../history/commandBus';
import { mangaLayerCounts } from '../domain/mangaCounts';
import { isPanelRelocating } from '../workspacePanels/panelInteraction';

const labels: { value: LabelColor; name: string }[] = [{ value: null, name: '无标签' }, { value: 'red', name: '红色' }, { value: 'orange', name: '橙色' }, { value: 'yellow', name: '黄色' }, { value: 'green', name: '绿色' }, { value: 'blue', name: '蓝色' }, { value: 'purple', name: '紫色' }];
const notify = (result: Result<unknown>) => { if (!result.ok) pushNotice('error', firstMessage(result)); };
const rowHeight = 38;
export function LayerPanel({ project, pageId, selection }: { project: Project; pageId: Id; selection: Id[] }) {
  const expanded = useStore(sessionStore, (state) => state.expanded), filter = useStore(sessionStore, (state) => state.filter);
  const rows = buildRows(project, pageId, expanded, filter), filtering = Boolean(filter.name.trim() || filter.color);
  const list = useRef<HTMLDivElement>(null), menuRef = useRef<HTMLDivElement>(null), origin = useRef<HTMLElement | null>(null);
  const [scroll, setScroll] = useState(0), [height, setHeight] = useState(300), [renaming, setRenaming] = useState<Id | null>(null), [name, setName] = useState('');
  const composing = useRef(false), cancelledName = useRef(false), drag = useRef<Id[]>([]);
  const [drop, setDrop] = useState<{ id: Id; above: boolean } | null>(null), [menu, setMenu] = useState<{ id: Id; x: number; y: number } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => { const node = list.current; if (!node) return; const observer = new ResizeObserver(() => setHeight(node.clientHeight)); observer.observe(node); setHeight(node.clientHeight); return () => observer.disconnect(); }, []);
  useEffect(() => { if (list.current) list.current.scrollTop = 0; setScroll(0); }, [pageId, filter.name, filter.color]);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null); };
    window.addEventListener('pointerdown', outside, true); return () => window.removeEventListener('pointerdown', outside, true);
  }, [menu]);
  const closeMenu = () => { setMenu(null); origin.current?.focus(); };
  const beginRename = (id: Id) => { setRenaming(id); setName(project.layers[id].name); cancelledName.current = false; composing.current = false; };
  const commitName = () => { if (!renaming || cancelledName.current || composing.current) return; const result = renameLayer(renaming, name); notify(result); if (result.ok) setRenaming(null); };
  const choose = (id: Id, shift: boolean, toggle: boolean) => {
    const anchor = sessionStore.getState().selectionAnchorId ?? selection[0] ?? null;
    if (shift) setSelection(rangeSelection(rows, anchor, id), anchor && rows.some((row) => row.id === anchor) ? anchor : id);
    else setSelection(toggle ? selection.includes(id) ? selection.filter((item) => item !== id) : [...selection, id] : [id], id);
  };
  const openMenu = (id: Id, button: HTMLElement, x: number, y: number) => {
    if (!selection.includes(id)) setSelection([id], id);
    origin.current = button;
    setMenu({ id, x: Math.max(8, Math.min(window.innerWidth - 180, x)), y: Math.max(8, Math.min(window.innerHeight - 350, y)) });
  };
  const virtual = rows.length > 100, start = virtual ? Math.max(0, Math.min(rows.length - 1, Math.floor(scroll / rowHeight) - 6)) : 0, end = virtual ? Math.min(rows.length, start + Math.ceil(height / rowHeight) + 12) : rows.length;
  const counts=mangaLayerCounts(project);
  return <div className="layers-panel">
    <div className="section-title"><span>图层</span><small>{project.pages[pageId]?.roots.length ?? 0} 根</small>{!project.pages[pageId]?.roots.some(id => project.layers[id]?.type === 'pageBackground') && <button className="tiny-action" onClick={() => notify(addPageBackground(pageId))}>添加页面背景</button>}<button className="tiny-action" onClick={() => setConfirmClear(true)}>清空历史</button></div>
    <p className="layer-filter-hint" aria-label="漫画图层配额">{counts.content}/5000 内容层 · {counts.boundTails}/20000 绑定尾巴</p>
    <div className="layer-filters"><input aria-label="搜索图层" className="search" placeholder="搜索图层" value={filter.name} onChange={(event) => sessionStore.setState({ filter: { ...filter, name: event.target.value } })} /><select aria-label="按颜色筛选图层" value={filter.color ?? ''} onChange={(event) => sessionStore.setState({ filter: { ...filter, color: event.target.value ? event.target.value as LabelColor : null } })}><option value="">所有颜色</option>{labels.filter((label) => label.value).map((label) => <option key={label.value} value={label.value!}>{label.name}</option>)}</select></div>
    {filtering && <p className="layer-filter-hint">筛选只影响列表；清除筛选后可拖动排序</p>}
    <div ref={list} className="layer-list" onScroll={(event) => setScroll(event.currentTarget.scrollTop)} data-total-rows={rows.length}>
      {virtual && <div aria-hidden="true" style={{ height: start * rowHeight }} />}
      {rows.slice(start, end).map((row) => { const layer = project.layers[row.id]; return <div key={layer.id} data-layer-id={layer.id} data-layer-type={layer.type} className={`layer-row ${selection.includes(layer.id) ? 'selected' : ''} ${row.contextOnly ? 'context-only' : ''} ${drop?.id === layer.id ? drop.above ? 'drop-above' : 'drop-below' : ''}`} style={{ paddingLeft: 6 + row.depth * 12 }} draggable={layer.type !== 'pageBackground' && !filtering && renaming !== layer.id}
        onDragStart={(event) => { if (filtering) { event.preventDefault(); return; } drag.current = selection.includes(layer.id) ? selection : [layer.id]; if (!selection.includes(layer.id)) setSelection([layer.id], layer.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-comia-layers', JSON.stringify(drag.current)); }}
        onDragOver={(event) => { if (!drag.current.length || filtering) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setDrop({ id: layer.id, above: event.clientY < rect.top + rect.height / 2 }); }}
        onDrop={(event) => { event.preventDefault(); if (!drag.current.length || filtering) return; const parent = layer.parentId ? project.layers[layer.parentId] : null, siblings = parent ? ('children' in parent ? parent.children : []) : project.pages[pageId].roots;
          const beforeId = drop?.above ? siblings[siblings.indexOf(layer.id) + 1] ?? null : layer.id; notify(reorderSiblings({ draggedIds: drag.current, parentId: layer.parentId, beforeId })); drag.current = []; setDrop(null); }} onDragEnd={() => { drag.current = []; setDrop(null); }}
        onContextMenu={(event) => { event.preventDefault(); const button = event.currentTarget.querySelector<HTMLElement>('.layer-name'); if (button) openMenu(layer.id, button, event.clientX, event.clientY); }}>
        {'children' in layer ? <button className="icon-button" title="展开图层" aria-label="展开图层" aria-expanded={filtering || expanded.includes(layer.id)} onClick={() => sessionStore.setState({ expanded: expanded.includes(layer.id) ? expanded.filter((id) => id !== layer.id) : [...expanded, layer.id] })}>{filtering || expanded.includes(layer.id) ? '⌄' : '›'}</button> : <span className="row-spacer" />}
        <LayerThumbnail project={project} id={layer.id} />
        {renaming === layer.id ? <input className="layer-rename" aria-label="图层名称" autoFocus value={name} onChange={(event) => setName(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onBlur={()=>{if(!isPanelRelocating())commitName();}} onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composing.current) return;
          if (event.key === 'Enter') { event.preventDefault(); commitName(); } else if (event.key === 'Escape') { event.preventDefault(); cancelledName.current = true; setRenaming(null); }
        }} /> : <button className="layer-name" aria-haspopup="menu" onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); openMenu(layer.id, event.currentTarget, rect.left, rect.bottom); }
        }} onClick={(event) => choose(layer.id, event.shiftKey, event.ctrlKey || event.metaKey)} onDoubleClick={() => beginRename(layer.id)} title={`${layer.name}${row.effectiveVisible ? '' : '（有效隐藏）'}${row.effectiveLocked ? '（有效锁定）' : ''} · Shift+F10打开图层菜单`}>{layer.name}</button>}
        {layer.type === 'image' && layer.parentId && project.layers[layer.parentId]?.type === 'panel' && <span className="panel-clip-badge" title={layer.panelClip?.mode && layer.panelClip.mode !== 'normal' ? '破格素材：在所属最外层分镜分支的框线之上绘制，相邻分支仍按图层顺序' : '普通素材：遵循分镜裁剪'}>{layer.panelClip?.mode && layer.panelClip.mode !== 'normal' ? '破格' : '普通'}</span>}
        <select className={`layer-color ${layer.colorLabel ?? ''}`} aria-label={`${layer.name}颜色标签`} title="颜色标签" value={layer.colorLabel ?? ''} onChange={(event) => notify(setLabel(selection.includes(layer.id) ? selection : [layer.id], event.target.value ? event.target.value as LabelColor : null))}>{labels.map((label) => <option key={label.value ?? ''} value={label.value ?? ''}>{label.name}</option>)}</select>
        <button className="icon-button" title={layer.visible ? '隐藏' : '显示'} aria-label={layer.visible ? '隐藏' : '显示'} data-inherited={!row.effectiveVisible && layer.visible} onClick={() => notify(setVisible([layer.id], !layer.visible))}>{layer.visible ? '◉' : '○'}</button>
        <button className="icon-button" title={layer.locked ? '解锁' : '锁定'} aria-label={layer.locked ? '解锁' : '锁定'} data-inherited={row.effectiveLocked && !layer.locked} onClick={() => notify(setLocked([layer.id], !layer.locked))}>{layer.locked ? '▣' : '□'}</button>
      </div>; })}
      {virtual && <div aria-hidden="true" style={{ height: (rows.length - end) * rowHeight }} />}
      {!rows.length && <div className="empty-hint">{filtering ? '没有匹配图层；可清除名称或颜色筛选' : '从组件库点击添加，或拖入组件开始创作'}</div>}
    </div>
    {menu && <div ref={menuRef} className="layer-menu" role="menu" aria-label="图层操作" style={{ left: menu.x, top: menu.y }} onKeyDown={(event) => {
      event.stopPropagation(); const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); closeMenu(); } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
    }}>
      {filtering && <p className="layer-filter-hint">清除图层筛选后可调整画序</p>}
      {(['top', 'up', 'down', 'bottom'] as const).map((direction, index) => <button role="menuitem" key={direction} title={filtering ? '请先清除图层筛选再调整画序' : undefined} disabled={filtering || project.layers[menu.id]?.type === 'pageBackground'} onClick={() => { notify(moveLayers(sessionStore.getState().selection, direction)); closeMenu(); }}>{['置顶', '上移一层', '下移一层', '置底'][index]}</button>)}
      <button role="menuitem" disabled={!!bindingDisabledReason()} title={bindingDisabledReason() ?? undefined} onClick={() => { notify(bindSelectedImages()); closeMenu(); }}>关联素材到分镜</button>
      <button role="menuitem" disabled={!!unbindingDisabledReason()} title={unbindingDisabledReason() ?? undefined} onClick={() => { notify(unbindPanelImages(sessionStore.getState().selection)); closeMenu(); }}>解除素材分镜关联</button>
      <button role="menuitem" onClick={() => { beginRename(menu.id); setMenu(null); }}>重命名</button>
      <button role="menuitem" onClick={() => { notify(copyToClipboard(sessionStore.getState().selection)); closeMenu(); }}>复制</button>
      <button role="menuitem" onClick={() => { const result = copyToClipboard(sessionStore.getState().selection); notify(result); if (result.ok) notify(pasteFromClipboard(pageId)); closeMenu(); }}>创建副本</button>
      <button role="menuitem" onClick={() => { notify(deleteSelected()); closeMenu(); }}>删除</button>
    </div>}
    {confirmClear && <FocusDialog title="清空编辑历史" onCancel={() => setConfirmClear(false)}><strong>清空编辑历史</strong><p>当前画面会保留，此前操作将无法撤销。正在编辑时须先完成或取消编辑。</p><div className="dialog-actions"><button onClick={() => setConfirmClear(false)}>取消</button><button onClick={() => { const result = clearHistory(true); notify(result); if (result.ok) setConfirmClear(false); }}>确认清空</button></div></FocusDialog>}
  </div>;
}
