import { useLayoutEffect, useRef, type ReactNode } from 'react';
import './floatingEdit.css';

export function constrainFloatingPosition(point: { x: number; y: number }, container: { width: number; height: number }, panel: { width: number; height: number }) {
  const marginX = Math.min(16, container.width / 2), marginY = Math.min(16, container.height / 2);
  return { x: Math.max(marginX, Math.min(point.x, Math.max(marginX, container.width - panel.width - marginX))), y: Math.max(marginY, Math.min(point.y, Math.max(marginY, container.height - panel.height - marginY))) };
}

/** Nonmodal DOM UI; pointer movement never updates the document or canvas stores. */
export function FloatingEditPanel({ title, children }: { title: string; children: ReactNode }) {
  const root = useRef<HTMLElement>(null), handle = useRef<HTMLButtonElement>(null);
  const position = useRef({ x: 16, y: 16 }), moved = useRef(false), frame = useRef<number | null>(null);
  const drag = useRef<{ id: number; clientX: number; clientY: number; x: number; y: number } | null>(null);
  const renderPosition = () => {
    const node = root.current, canvas = node?.closest<HTMLElement>('.canvas-viewport'); if (!node || !canvas) return;
    position.current = constrainFloatingPosition(position.current, { width: canvas.clientWidth, height: canvas.clientHeight }, { width: node.offsetWidth, height: node.offsetHeight });
    node.style.transform = `translate(${position.current.x}px, ${position.current.y}px)`;
  };
  const stop = () => {
    const active = drag.current; drag.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; renderPosition();
    if (active && handle.current?.hasPointerCapture(active.id)) handle.current.releasePointerCapture(active.id);
  };
  useLayoutEffect(() => {
    const node = root.current, canvas = node?.closest<HTMLElement>('.canvas-viewport'); if (!node || !canvas) return;
    const resize = () => {
      node.style.maxHeight = `${Math.max(48, canvas.clientHeight - 32)}px`;
      if (!moved.current) position.current = { x: (canvas.clientWidth - node.offsetWidth) / 2, y: 16 };
      renderPosition();
    };
    resize(); const observer = new ResizeObserver(resize); observer.observe(canvas); observer.observe(node);
    const blur = () => stop(); window.addEventListener('blur', blur);
    return () => { observer.disconnect(); window.removeEventListener('blur', blur); stop(); };
  }, []);
  return <section ref={root} role="dialog" aria-label={`${title}操作`} className="floating-edit-panel" data-text-edit-preserve
    onPointerDown={e => e.stopPropagation()} onPointerMove={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
    <header className="floating-edit-heading"><button ref={handle} type="button" className="floating-edit-handle" aria-label={`移动${title}浮窗`} title="拖动移动 · 方向键10px · Shift+方向键1px"
      onPointerDown={e => { if (e.button !== 0 || drag.current) return; e.preventDefault(); e.stopPropagation(); moved.current = true; drag.current = { id: e.pointerId, clientX: e.clientX, clientY: e.clientY, ...position.current }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { const active = drag.current; if (!active || active.id !== e.pointerId) return; position.current = { x: active.x + e.clientX - active.clientX, y: active.y + e.clientY - active.clientY }; if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; renderPosition(); }); }}
      onPointerUp={e => { if (drag.current?.id === e.pointerId) { const active = drag.current; position.current = { x: active.x + e.clientX - active.clientX, y: active.y + e.clientY - active.clientY }; stop(); } }}
      onPointerCancel={stop} onLostPointerCapture={() => { if (drag.current) stop(); }}
      onKeyDown={e => { if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); moved.current = true; const step = e.shiftKey ? 1 : 10; position.current = { x: position.current.x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0), y: position.current.y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0) }; renderPosition(); }}>
      <span aria-hidden="true" className="floating-edit-grip">⠿</span><strong>{title}</strong><span aria-hidden="true" className="floating-edit-move-hint">拖动移动</span>
    </button></header>
    <div className="floating-edit-content">{children}</div>
  </section>;
}
