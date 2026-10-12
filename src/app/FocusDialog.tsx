import { useRef, type ReactNode } from 'react';
import { useModalFocus } from './useModalFocus';

export function FocusDialog({ title, onCancel, children, className='' }: { title: string; onCancel: () => void; children: ReactNode; className?:string }) {
  const root = useRef<HTMLDivElement>(null); useModalFocus(root, true, onCancel);
  return <div className="dialog-backdrop"><div ref={root} className={`text-dialog open-dialog ${className}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>{children}</div></div>;
}
