import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Id, Point, Result } from '../domain/types';
import { clientToPage } from '../geometry/matrix';
import { registerGestureCanceller } from '../interaction/activeGesture';
import { getDocument } from '../state/documentStore';
import { runtimeStore } from '../state/runtimeStore';
import { getViewport, sessionStore } from '../state/sessionStore';
import { panelAtPoint } from '../images/panelAssociation';
import { associationStore, clearAssociation } from '../images/associationController';
import { placeLibraryAsset } from './libraryCommands';
import { moveLibraryAssets } from './folderCommands';

interface Drag { assetId: Id; pageId: Id; projectId: Id; epoch: number; stateId: Id; alt: boolean; candidate: Id | null; pointerId: number; start: Point; client: Point; started: boolean }

/** Pointer capture works consistently across engines. The fixed bitmap overlay never redraws the scene. */
export function useAssetDrag(pageId: Id, pick: (id: Id) => void, report: (result: Result<unknown>) => void) {
  const drag = useRef<Drag | null>(null), suppressClick = useRef(false), unregister = useRef<(() => void) | null>(null);
  const frame = useRef<number | null>(null), preview = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const cancel = useCallback(() => {
    if (drag.current) suppressClick.current = true;
    clearAssociation(); drag.current = null; unregister.current?.(); unregister.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null;
    if (preview.current) preview.current.hidden = true;
  }, []);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); cancel(); } }; window.addEventListener('keydown', key); return () => { window.removeEventListener('keydown', key); cancel(); }; }, [cancel]);
  useEffect(() => { const unsubscribe = sessionStore.subscribe((state, previous) => { if (state.activePageId !== previous.activePageId) cancel(); }); return unsubscribe; }, [cancel]);
  function paint(assetId: Id): boolean {
    const asset = getDocument().project.assets[assetId], image = asset && runtimeStore.getState().images.get(asset.renderHash), node = canvas.current, ctx = node?.getContext('2d');
    if (!asset || !image || !node || !ctx) return false;
    const scale = Math.min(1, 200 / asset.width, 150 / asset.height), ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.ceil(asset.width * scale)), height = Math.max(1, Math.ceil(asset.height * scale));
    node.width = Math.ceil(width * ratio); node.height = Math.ceil(height * ratio); node.style.width = `${width}px`; node.style.height = `${height}px`;
    ctx.drawImage(image, 0, 0, node.width, node.height); return true;
  }
  function position() {
    frame.current = null; const active = drag.current, node = preview.current;
    if (!active?.started || !node) return;
    // Clamp to the visible window so the preview remains visible over the sidebar and outside the paper.
    const x = Math.max(4, Math.min(window.innerWidth - node.offsetWidth - 4, active.client.x - node.offsetWidth / 2));
    const y = Math.max(4, Math.min(window.innerHeight - node.offsetHeight - 4, active.client.y - node.offsetHeight / 2));
    node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    const doc = getDocument(), host = document.querySelector<HTMLElement>('.canvas-viewport'), vp = getViewport(active.pageId), paper = doc.project.pages[active.pageId];
    if (doc.epoch !== active.epoch || doc.history.stateId !== active.stateId || doc.project.id !== active.projectId || !host || !vp || !paper) { cancel(); return; }
    const rect = host.getBoundingClientRect(), point = clientToPage(active.client, rect, vp);
    if (active.client.x < rect.left || active.client.x > rect.right || active.client.y < rect.top || active.client.y > rect.bottom || point.x < 0 || point.y < 0 || point.x > paper.width || point.y > paper.height) { clearAssociation(); active.candidate = null; return; }
    active.candidate = active.alt ? null : panelAtPoint(doc.project, active.pageId, point);
    associationStore.setState({ hint: { project: doc.project, pageId: active.pageId, panelId: active.candidate, imageId: null, kind: 'library', free: active.alt } });
  }
  const bind = (assetId: Id) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || !event.isPrimary) return;
      cancel(); suppressClick.current = false; pick(assetId); const doc = getDocument();
      drag.current = { assetId, pageId, projectId: doc.project.id, epoch: doc.epoch, stateId: doc.history.stateId, alt: event.altKey, candidate: null, pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, client: { x: event.clientX, y: event.clientY }, started: false };
      unregister.current = registerGestureCanceller(cancel); event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
      const active = drag.current; if (!active || active.pointerId !== event.pointerId) return;
      active.client = { x: event.clientX, y: event.clientY }; active.alt = event.altKey;
      if (!active.started && Math.hypot(event.clientX - active.start.x, event.clientY - active.start.y) >= 4) {
        if (!paint(assetId)) { cancel(); return; } active.started = true; if (preview.current) preview.current.hidden = false;
      }
      if (active.started) { event.preventDefault(); if (frame.current === null) frame.current = requestAnimationFrame(position); }
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      const active = drag.current; if (!active || active.pointerId !== event.pointerId) return;
      const started = active.started; cancel(); suppressClick.current = started;
      if (!started) return;
      const doc = getDocument(), paper = doc.project.pages[active.pageId], node = document.querySelector<HTMLElement>('.canvas-viewport'), vp = getViewport(active.pageId);
      if (doc.epoch !== active.epoch || doc.history.stateId !== active.stateId || doc.project.id !== active.projectId || sessionStore.getState().activePageId !== active.pageId || !node || !paper || !vp) return;
      const folder=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-asset-folder-target]')?.dataset.assetFolderTarget;
      if(folder){report(moveLibraryAssets([assetId],folder==='root'?null:folder));return;}
      const rect = node.getBoundingClientRect(), client = { x: event.clientX, y: event.clientY };
      if (client.x < rect.left || client.x > rect.right || client.y < rect.top || client.y > rect.bottom) return;
      const point = clientToPage(client, rect, vp);
      if (point.x < 0 || point.y < 0 || point.x > paper.width || point.y > paper.height) return;
      const target = event.altKey ? null : panelAtPoint(doc.project, active.pageId, point);
      if (!event.altKey && active.candidate && target !== active.candidate) { report({ ok: false, problems: [{ code: 'association/target-changed', message: '拖放目标已变化，未创建素材，请重新拖放' }] }); return; }
      report(placeLibraryAsset(assetId, active.pageId, point, target ?? undefined));
    },
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
    onClick: () => { if (suppressClick.current) { suppressClick.current = false; return; } pick(assetId); report(placeLibraryAsset(assetId, pageId)); },
  });
  return { bind, preview: createPortal(<div ref={preview} className="asset-drag-preview" data-testid="asset-drag-preview" aria-hidden="true" hidden><canvas ref={canvas} /></div>, document.body) };
}
