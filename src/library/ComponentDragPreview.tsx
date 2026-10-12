import { useEffect, useRef } from 'react';
import { clientToPage, translation } from '../geometry/matrix';
import { getProject } from '../state/documentStore';
import { getViewport } from '../state/sessionStore';
import { drawPage } from '../render/drawScene';
import { componentBounds } from './placement';
import { currentCreation, subscribeCreation, type CreationDrag } from './creationController';
import { componentSceneDraft } from '../panels/instantiate';

const MAX_WIDTH = 176;
const MAX_HEIGHT = 136;
const PADDING = 12;

function paint(canvas: HTMLCanvasElement, drag: CreationDrag): void {
  const box = componentBounds(drag.draft);
  const scale = Math.min(1, MAX_WIDTH / Math.max(1, box.width), MAX_HEIGHT / Math.max(1, box.height));
  const width = Math.ceil(box.width * scale + PADDING * 2);
  const height = Math.ceil(box.height * scale + PADDING * 2);
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.ceil(width * ratio);
  canvas.height = Math.ceil(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const source = getProject();
  const page = source.pages[drag.pageId];
  if (!page) return;
  const margin=260,root = {...drag.draft.layer,matrix:translation(margin-box.x,margin-box.y),parentId:null};
  const scene = componentSceneDraft(root, drag.draft.descendants, drag.draft.independentRoots); if (!scene.ok) return;
  const layers = { ...source.layers };
  for (const child of scene.value.layers) layers[child.id] = child;
  const project = {
    ...source,
    layers,
    pages: { ...source.pages, [drag.pageId]: { ...page, width: Math.ceil(box.width+margin*2), height: Math.ceil(box.height+margin*2), roots: scene.value.roots } },
  };
  ctx.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * (PADDING - margin * scale), ratio * (PADDING - margin * scale));
  drawPage(ctx, project, drag.pageId, new Map(), scene.value.roots, false);
}

function isInsidePage(drag: CreationDrag): boolean {
  const node = document.querySelector<HTMLElement>('.canvas-viewport');
  const page = getProject().pages[drag.pageId];
  const viewport = getViewport(drag.pageId);
  if (!node || !page || !viewport) return false;
  const rect = node.getBoundingClientRect();
  if (drag.client.x < rect.left || drag.client.x > rect.right || drag.client.y < rect.top || drag.client.y > rect.bottom) return false;
  const point = clientToPage(drag.client, rect, viewport);
  return point.x >= 0 && point.y >= 0 && point.x <= page.width && point.y <= page.height;
}

/** Fixed overlay stays visible outside the clipped Konva viewport; pointer motion only changes CSS position. */
export function ComponentDragPreview() {
  const frameRef = useRef<number | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paintedIdRef = useRef<string | null>(null);
  useEffect(() => {
    const update = () => {
      frameRef.current = null;
      const node = previewRef.current, canvas = canvasRef.current, drag = currentCreation();
      if (!node || !canvas) return;
      if (!drag) { node.hidden = true; paintedIdRef.current = null; return; }
      if (paintedIdRef.current !== drag.draft.layer.id) { paint(canvas, drag); paintedIdRef.current = drag.draft.layer.id; }
      if (isInsidePage(drag)) { node.hidden = true; return; }
      node.hidden = false;
      const width = canvas.offsetWidth + 2, height = canvas.offsetHeight + 2;
      const x = Math.max(8, Math.min(window.innerWidth - width - 8, drag.client.x - width / 2));
      const y = Math.max(8, Math.min(window.innerHeight - height - 8, drag.client.y - height / 2));
      node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };
    const unsubscribe = subscribeCreation(() => {
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(update);
    });
    update();
    return () => { unsubscribe(); if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); };
  }, []);
  return <div ref={previewRef} className="component-drag-preview" data-testid="component-drag-preview" aria-hidden="true" hidden><canvas ref={canvasRef} /></div>;
}
