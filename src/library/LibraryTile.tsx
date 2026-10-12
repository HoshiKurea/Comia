import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './library.css';
import { hideElementHint, requestElementHint, leaveElementHint } from '../app/ElementHintPanel';
import type { HintTarget } from '../commands/elementHints';

type TileProps = ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode; preview?: ReactNode; hintTarget?:HintTarget };
// A focused icon and a hovered icon can differ. Only the latest request owns the UI preview.
let activeTooltip: { id: string; dismiss: () => void } | null = null;

function ComponentTooltip({ label, id, anchor, preview }: { label: string; id: string; anchor: HTMLButtonElement; preview: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const tip = ref.current; if (!tip) return;
    const box = anchor.getBoundingClientRect(), bounds = tip.getBoundingClientRect(), gap = 8;
    const right = box.right + gap;
    const left = right + bounds.width <= window.innerWidth - gap ? right : box.left - bounds.width - gap;
    setPosition({
      left: Math.max(gap, Math.min(left, window.innerWidth - bounds.width - gap)),
      top: Math.max(gap, Math.min(box.top + (box.height - bounds.height) / 2, window.innerHeight - bounds.height - gap)),
    });
  }, [anchor, label]);
  return createPortal(<div ref={ref} id={id} role="tooltip" className="component-tooltip" style={position}>
    <span className="component-tooltip-preview" aria-hidden="true">{preview}</span><span>{label}</span>
  </div>, document.body);
}

/** The hover name is outside the scroll container. Pointer movement never updates it. */
export function LibraryTile({ label, children, preview = children, hintTarget, className = '', onPointerEnter, onPointerLeave, onPointerDown, onFocus, onBlur, onClick, ...props }: TileProps) {
  const ref = useRef<HTMLButtonElement>(null), tooltipId = useId();
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false), [visible, setVisible] = useState(false);
  const requested = (hovered || focused) && !dismissed;
  useEffect(() => {
    if (!requested) { setVisible(false); return; }
    const dismiss = () => { setDismissed(true); setVisible(false); if(hintTarget)leaveElementHint(); };
    const timer = window.setTimeout(() => {
      activeTooltip?.dismiss(); activeTooltip = { id: tooltipId, dismiss }; setVisible(true);
      if(hintTarget&&ref.current){const b=ref.current.getBoundingClientRect();requestElementHint(hintTarget,{x:b.right,y:b.top},0);}
    }, 180);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { dismiss(); if(hintTarget)hideElementHint(); } };
    // A scrolled/collapsed drawer or resized viewport must not leave a floating name behind.
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('keydown', escape);
    return () => {
      window.clearTimeout(timer); if (activeTooltip?.id === tooltipId) activeTooltip = null;
      window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss); window.removeEventListener('keydown', escape);
    };
  }, [requested, tooltipId]);
  const dismiss = () => { setDismissed(true); setVisible(false); if(hintTarget)hideElementHint(); };
  return <>
    <button {...props} type={props.type ?? 'button'} ref={ref} className={`library-tile ${className}`.trim()} aria-label={label} aria-controls={hintTarget?'panel-content-hints':undefined} aria-describedby={visible&&!hintTarget?tooltipId:undefined}
      onPointerEnter={event => { if (event.pointerType !== 'touch' && event.buttons === 0) { setHovered(true); setDismissed(false); } onPointerEnter?.(event); }}
      onPointerLeave={event => { setHovered(false); setVisible(false); if(hintTarget)leaveElementHint();onPointerLeave?.(event); }}
      onPointerDown={event => { dismiss(); onPointerDown?.(event); }}
      onClick={event => { dismiss(); onClick?.(event); }}
      onFocus={event => { if (event.currentTarget.matches(':focus-visible')) { setFocused(true); setDismissed(false); } onFocus?.(event); }}
      onBlur={event => { setFocused(false); setVisible(false); onBlur?.(event); }}>
      <span className="library-icon" aria-hidden="true">{children}</span><span className="component-label">{label}</span>
    </button>
    {!hintTarget&&visible && requested && ref.current && <ComponentTooltip label={label} id={tooltipId} anchor={ref.current} preview={preview} />}
  </>;
}
