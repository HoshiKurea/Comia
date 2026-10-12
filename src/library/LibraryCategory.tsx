import { useId, useState, type ReactNode } from 'react';

export function LibraryCategory({ name, id, children, footer }: { name: string; id: string; children: ReactNode; footer?: ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  const gridId = useId();
  return <section className="library-category" data-category={id} aria-label={name}>
    <h3 className="library-category-heading"><button type="button" aria-expanded={expanded} aria-controls={gridId} onClick={() => setExpanded(!expanded)}>
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2 8 6 4 10" /></svg><span>{name}</span>
    </button></h3>
    <div id={gridId} hidden={!expanded}>
      <div className="component-grid">{children}</div>
      {footer}
    </div>
  </section>;
}
