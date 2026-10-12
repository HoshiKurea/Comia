import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useModalFocus } from './useModalFocus';

export function ResponsiveSidebar({ side, open, close, children }: { side: 'left' | 'right'; open: boolean; close: () => void; children: ReactNode }) {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 690px)').matches), root = useRef<HTMLElement>(null);
  useEffect(() => { const media = window.matchMedia('(max-width: 690px)'), update = () => setNarrow(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  useModalFocus(root, narrow && open, close);
  const title = side === 'left' ? '组件与页面' : '属性与图层';
  return <aside ref={root} id={`sidebar-${side}`} className={`${side}-panel${open ? ' drawer-open' : ''}`} role={narrow && open ? 'dialog' : undefined} aria-modal={narrow && open ? true : undefined} aria-label={title} aria-hidden={narrow && !open ? true : undefined} tabIndex={narrow && open ? -1 : undefined}>
    <div className="drawer-heading" data-panel-chrome data-text-edit-preserve onPointerDown={e=>e.preventDefault()}><strong>{title}</strong><button aria-label={`关闭${title}`} onClick={close}>关闭</button></div>{children}
  </aside>;
}
