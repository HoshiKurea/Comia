import { useEffect, useRef } from 'react';
import type { Id, Project } from '../domain/types';
import { documentStore, getDocument } from '../state/documentStore';
import { pushNotice } from '../state/sessionStore';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { cancelActiveGesture } from '../interaction/activeGesture';
import { activatePage, reorderPages } from './commands';
import { PageThumbnail, PageThumbnailRetry } from './PageThumbnail';
import { pageDimensionsMm, isB5Manuscript } from './paperSizes';

interface PageDrag {
  id: Id; pointerId: number; stateId: Id; epoch: number; source: HTMLElement;
  start: { x: number; y: number }; latest: { x: number; y: number };
  started: boolean; ghost: HTMLDivElement | null; frame: number | null; lastTime: number;
  marker: HTMLElement | null;
}

/** Pointer capture fixes the source before scrolling. Preview DOM never updates the canvas or document. */
export function PageList({ project, activeId, rename, remove, unit='mm' }: {
  project: Project; activeId: Id; rename: (id: Id) => void; remove: (id: Id) => void; unit?:'mm'|'px';
}) {
  const root = useRef<HTMLDivElement>(null), drag = useRef<PageDrag | null>(null), suppressClick = useRef(false);
  const clear = () => {
    const active = drag.current; drag.current = null; if (!active) return;
    if (active.frame !== null) cancelAnimationFrame(active.frame);
    active.marker?.classList.remove('drop-before');
    const canvas = active.ghost?.querySelector('canvas'); if (canvas) canvas.width = canvas.height = 0;
    active.ghost?.remove();
    if (active.source.hasPointerCapture(active.pointerId)) active.source.releasePointerCapture(active.pointerId);
  };
  const valid = (active: PageDrag) => {
    const doc = getDocument();
    return doc.epoch === active.epoch && doc.history.stateId === active.stateId && !!doc.project.pages[active.id];
  };
  const target = (point: { x: number; y: number }): { beforeId: Id | null; element: HTMLElement } | null => {
    const element = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('[data-page-id],.page-drop-end');
    if (!element || !root.current?.contains(element)) return null;
    return { beforeId: element.dataset.pageId ?? null, element };
  };
  const paint = (now: number) => {
    const active = drag.current; if (!active?.started) return;
    if (!valid(active)) { clear(); return; }
    const { x, y } = active.latest;
    active.ghost!.style.transform = `translate(${x + 12}px,${y + 12}px)`;
    const scroller = root.current?.closest<HTMLElement>('.pages'), rect = scroller?.getBoundingClientRect();
    const elapsed = active.lastTime ? Math.min(32, Math.max(0, now - active.lastTime)) : 16; active.lastTime = now;
    if (scroller && rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      const edge = 36;
      const velocity = y < rect.top + edge ? -480 * (1 - (y - rect.top) / edge)
        : y > rect.bottom - edge ? 480 * (1 - (rect.bottom - y) / edge) : 0;
      scroller.scrollTop += velocity * elapsed / 1000;
    }
    const insertion = target(active.latest), marker = insertion?.beforeId === active.id ? null : insertion?.element ?? null;
    if (marker !== active.marker) { active.marker?.classList.remove('drop-before'); marker?.classList.add('drop-before'); active.marker = marker; }
    active.frame = requestAnimationFrame(paint);
  };
  const start = (active: PageDrag) => {
    const finish = finishActiveTextEdit();
    if (!finish.ok) { pushNotice('error', finish.problems[0].message); clear(); return; }
    cancelActiveGesture();
    // Committing text can change history; the page drag begins against that complete state.
    const doc = getDocument(); active.stateId = doc.history.stateId; active.epoch = doc.epoch;
    if (!doc.project.pages[active.id]) { clear(); return; }
    active.started = true; suppressClick.current = true;
    const ghost = document.createElement('div'); ghost.className = 'page-drag-preview'; ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
    const image = active.source.querySelector('img');
    if (image?.complete && image.naturalWidth) {
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      canvas.getContext('2d')?.drawImage(image, 0, 0); ghost.append(canvas);
    }
    const label = document.createElement('span'); label.textContent = doc.project.pages[active.id].name; ghost.append(label);
    document.body.append(ghost); active.ghost = ghost; active.frame = requestAnimationFrame(paint);
  };
  useEffect(() => {
    const unsubscribe = documentStore.subscribe((doc) => {
      const active = drag.current;
      if (active && (doc.epoch !== active.epoch || !doc.project.pages[active.id] || (active.started && !valid(active)))) clear();
    });
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !drag.current) return;
      event.preventDefault(); event.stopImmediatePropagation(); clear();
    };
    document.addEventListener('keydown', escape, true);
    return () => { unsubscribe(); document.removeEventListener('keydown', escape, true); clear(); };
  }, []);
  return <div ref={root} className="page-list" onClickCapture={(event) => {
    if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); }
  }}>
    {project.pageOrder.map((id, index) => <div key={id} data-page-id={id} className={`page-item ${id === activeId ? 'active' : ''}`}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary || (event.target as HTMLElement).closest('.page-rename,.page-delete,.page-thumbnail-retry')) return;
        clear(); suppressClick.current = false; const doc = getDocument();
        drag.current = { id, pointerId: event.pointerId, stateId: doc.history.stateId, epoch: doc.epoch, source: event.currentTarget,
          start: { x: event.clientX, y: event.clientY }, latest: { x: event.clientX, y: event.clientY }, started: false, ghost: null, frame: null, lastTime: 0, marker: null };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={(event) => {
        const active = drag.current; if (!active || active.pointerId !== event.pointerId) return;
        active.latest = { x: event.clientX, y: event.clientY };
        if (!active.started && Math.hypot(event.clientX - active.start.x, event.clientY - active.start.y) >= 4) start(active);
        if (active.started) event.preventDefault();
      }} onPointerUp={(event) => {
        const active = drag.current; if (!active || active.pointerId !== event.pointerId) return;
        const insertion = target({ x: event.clientX, y: event.clientY }), commit = active.started && valid(active) && insertion;
        const click = !active.started && valid(active) && insertion?.beforeId === active.id;
        clear();
        if (commit) { event.preventDefault(); const result = reorderPages(active.id, insertion!.beforeId); if (!result.ok) pushNotice('error', result.problems[0].message); }
        else if (click) activatePage(active.id);
      }} onPointerCancel={clear} onLostPointerCapture={(event) => { if (drag.current?.pointerId === event.pointerId) clear(); }}>
      <button onClick={() => activatePage(id)}><PageThumbnail pageId={id} index={index} /><span><strong>{project.pages[id].name}</strong>{unit==='px'?<small>{project.pages[id].width} × {project.pages[id].height} px</small>:<small>{isB5Manuscript(project.pages[id])?'B5 漫画原稿 · ':''}{pageDimensionsMm(project.pages[id]).width} × {pageDimensionsMm(project.pages[id]).height} mm</small>}</span></button>
      <PageThumbnailRetry pageId={id} />
      <button className="page-rename" title="重命名页面" aria-label="重命名页面" onClick={() => rename(id)}>✎</button>
      <button className="page-delete" title="删除页面" aria-label="删除页面" onClick={() => remove(id)}>×</button>
    </div>)}
    <div className="page-drop-end">拖到此处移至末尾</div>
  </div>;
}
