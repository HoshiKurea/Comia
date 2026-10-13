import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { Id } from '../domain/types';
import { onBusEvent } from '../history/commandBus';
import { documentStore, getDocument } from '../state/documentStore';
import { runtimeStore } from '../state/runtimeStore';
import { sessionStore } from '../state/sessionStore';
import { manuscriptSegments } from './manuscript';
import { hasCurrentThumbnail, invalidatePage, scheduleThumbnail, subscribeThumbnailState, type ThumbnailState } from './thumbnails';

export function PageThumbnail({ pageId, index }: { pageId: Id; index: number }) {
  const [state, setState] = useState<ThumbnailState>({ status: 'idle', url: null, message: '' });
  const page = useStore(documentStore, (doc) => doc.project.pages[pageId]);
  const showGuides = useStore(sessionStore, s => s.showManuscriptGuides);
  // Reserve the same bordered box through loading/error/retry so native page drop targets stay stable.
  const height = page ? Math.max(54, Math.min(320, 158 * page.height / page.width + 2)) : 54;
  useEffect(() => {
    const schedule = () => {
      const doc = getDocument();
      if (!doc.project.pages[pageId] || runtimeStore.getState().gestureActive) return;
      scheduleThumbnail(pageId, doc.history.stateId, doc.project, runtimeStore.getState().images);
    };
    const unsubThumbnail = subscribeThumbnailState(pageId, setState);
    const unsubBus = onBusEvent((event) => {
      if (event.type === 'documentReplaced' || (event.type === 'documentChanged' && event.pageId === pageId)) schedule();
    });
    const unsubImages = runtimeStore.subscribe((next, old) => {
      if (next.fontGeneration !== old.fontGeneration) { schedule(); return; }
      if (next.images === old.images) return;
      const project = getDocument().project;
      const assets = new Set(Object.values(project.layers).filter((layer) => layer.pageId === pageId && layer.type === 'image').map((layer) => layer.type === 'image' ? project.assets[layer.assetId]?.renderHash : undefined));
      if ([...next.images.keys()].some((hash) => !old.images.has(hash) && assets.has(hash))) schedule();
    });
    if (!hasCurrentThumbnail(pageId)) schedule();
    return () => { unsubThumbnail(); unsubBus(); unsubImages(); if (!getDocument().project.pages[pageId]) invalidatePage(pageId); };
  }, [pageId]);
  return <span className="page-thumbnail" style={{ height }} aria-busy={state.status === 'pending'} title={state.message || undefined}>{state.url ? <img src={state.url} alt={`第 ${index + 1} 页缩略图`} draggable={false} /> : <span>{state.status === 'error' ? '生成失败' : String(index + 1).padStart(2, '0')}</span>}
    {page?.manuscript && showGuides && <svg className="page-guide-overlay" aria-hidden="true" viewBox={`0 0 ${page.width} ${page.height}`}>
      {manuscriptSegments(page).map((s, i) => <line key={i} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} vectorEffect="non-scaling-stroke" stroke="#8a81e5" strokeWidth=".65" strokeDasharray={s.kind === 'safe' ? '3 2' : undefined} />)}
    </svg>}
  </span>;
}
export function PageThumbnailRetry({ pageId }: { pageId: Id }) {
  const [state, setState] = useState<ThumbnailState>({ status: 'idle', url: null, message: '' });
  useEffect(() => subscribeThumbnailState(pageId, setState), [pageId]);
  if (state.status !== 'error') return null;
  return <button className="page-thumbnail-retry" title={state.message} aria-label="重试缩略图" onClick={() => {
    const doc = getDocument(); if (doc.project.pages[pageId] && !runtimeStore.getState().gestureActive) scheduleThumbnail(pageId, doc.history.stateId, doc.project, runtimeStore.getState().images);
  }}>重试</button>;
}
