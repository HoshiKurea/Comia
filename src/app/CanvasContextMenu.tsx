import { useEffect, useRef, useState } from 'react';
import type { Id, Project, Result, Viewport } from '../domain/types';
import { clientToPage } from '../geometry/matrix';
import { getProject } from '../state/documentStore';
import { runtimeStore } from '../state/runtimeStore';
import { sessionStore, setSelection, pushNotice } from '../state/sessionStore';
import { hitLayer } from '../render/drawScene';
import { bindImagesToPanel, bindSelectedImages, bindingDisabledReason, panelAtPoint, unbindPanelImages, unbindingDisabledReason } from '../images/panelAssociation';
import { createDialogue, dialogueEligibility, dissolveDialogue } from '../bubbles/dialogueCommands';
import { openDrawingWindow } from '../freehand/session';
import { activateHandBubbleEdit } from '../bubbles/brushController';

export function CanvasContextMenu({ pageId, viewport }: { pageId: Id; viewport: Viewport }) {
  const [menu, setMenu] = useState<{ project: Project; panelId: Id | null; imageIds: Id[]; x: number; y: number } | null>(null), ref = useRef<HTMLDivElement>(null), origin = useRef<HTMLElement | null>(null);
  const close = () => { setMenu(null); origin.current?.focus(); };
  useEffect(() => {
    const open = (e: MouseEvent) => {
      const target = e.target as HTMLElement, host = target.closest<HTMLElement>('.canvas-viewport');
      if (!host || target.closest('input,textarea,[contenteditable=true],button,select,[role=menu]') || runtimeStore.getState().gestureActive) return;
      const project = getProject(), point = clientToPage({ x: e.clientX, y: e.clientY }, host.getBoundingClientRect(), viewport), selected = sessionStore.getState().selection;
      const panelId = panelAtPoint(project, pageId, point), imageIds = selected.filter(id => project.layers[id]?.type === 'image');
      const hit = hitLayer(project, pageId, point, sessionStore.getState().scopeId, selected);
      if (!(panelId && imageIds.length) && hit && !selected.includes(hit)) setSelection([hit]);
      if (!hit && !panelId && !selected.length) return;
      e.preventDefault(); origin.current = host; if (!host.hasAttribute('tabindex')) host.tabIndex = -1;
      setMenu({ project, panelId: panelId && imageIds.length ? panelId : null, imageIds, x: Math.max(8, Math.min(innerWidth - 240, e.clientX)), y: Math.max(8, Math.min(innerHeight - 140, e.clientY)) });
    }; window.addEventListener('contextmenu', open); return () => window.removeEventListener('contextmenu', open);
  }, [pageId, viewport]);
  useEffect(() => { if (!menu) return; (ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? ref.current)?.focus(); const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); }; window.addEventListener('pointerdown', outside, true); return () => window.removeEventListener('pointerdown', outside, true); }, [menu]);
  useEffect(() => setMenu(null), [pageId]);
  if (!menu) return null;
  const stale = menu.project !== getProject(), reason = runtimeStore.getState().gestureActive ? '请先完成当前编辑' : stale ? '作品已变化，请重新打开菜单' : null;
  const run = (fn: () => Result<unknown>) => { if (menu.project === getProject() && !runtimeStore.getState().gestureActive) { const r = fn(); if (!r.ok) pushNotice('error', r.problems[0].message); } close(); };
  const bindReason = reason ?? (menu.panelId ? bindingDisabledReason(menu.imageIds, menu.panelId) : bindingDisabledReason()), unbindReason = reason ?? unbindingDisabledReason();
  const selection=sessionStore.getState().selection,dialogue=dialogueEligibility(menu.project,selection),dialogueReason=reason??(dialogue.ok?null:dialogue.problems[0].message),selectedGroup=menu.project.layers[selection[0]];
  return <div ref={ref} tabIndex={-1} className="layer-menu" role="menu" aria-label="画布关联操作" style={{ left: menu.x, top: menu.y }} onPointerDown={e => e.stopPropagation()} onKeyDown={e => {
    e.stopPropagation(); const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(); } else if (['ArrowDown','ArrowUp','Home','End'].includes(e.key)) { e.preventDefault(); buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
  }}>{selection.length===1&&selectedGroup?.type==='image'&&menu.project.assets[selectedGroup.assetId]?.drawingSource&&<button role="menuitem" disabled={!!reason} onClick={()=>run(()=>openDrawingWindow(selectedGroup.id))}>在绘画窗口编辑</button>}{selection.length===1&&selectedGroup?.type==='bubble'&&selectedGroup.shape==='freehand'&&<button role="menuitem" disabled={!!reason} onClick={()=>run(()=>activateHandBubbleEdit({targetId:selectedGroup.id,mode:'ink'}))}>画气泡细节</button>}{(['connector','fused','overlap'] as const).map((mode,i)=><button key={mode} role="menuitem" disabled={!!dialogueReason} title={dialogueReason??undefined} onClick={()=>run(()=>createDialogue(selection,mode))}>{['建立连接对白','建立融合对白','建立叠加对白'][i]}</button>)}{selectedGroup?.type==='group'&&selectedGroup.dialogue&&<button role="menuitem" disabled={!!reason} onClick={()=>run(()=>dissolveDialogue(selectedGroup.id))}>解散连续对白</button>}<button role="menuitem" disabled={!!bindReason} title={bindReason ?? undefined} onClick={() => run(() => menu.panelId ? bindImagesToPanel(menu.imageIds, menu.panelId) : bindSelectedImages())}>{menu.panelId ? '关联到此分镜' : '关联素材到分镜'}</button><button role="menuitem" disabled={!!unbindReason} title={unbindReason ?? undefined} onClick={() => run(() => unbindPanelImages(sessionStore.getState().selection))}>解除素材分镜关联</button></div>;
}
