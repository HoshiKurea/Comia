import { panelChangeAllowed } from '../workspacePanels/panelInteraction';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { EditorMenu, MenuEntry } from './menuTypes';
import './menu.css';

type Item = Exclude<MenuEntry, { kind: 'separator' }>;
function items(entries: MenuEntry[]): Item[] { return entries.filter((e): e is Item => e.kind !== 'separator'); }
function position(anchor: DOMRect, child: boolean) {
  const margin = 8, width = Math.min(260, window.innerWidth - margin * 2);
  const rightFits = anchor.right + 3 + width <= window.innerWidth - margin, leftFits = anchor.left - width - 3 >= margin;
  const stacked = child && !rightFits && !leftFits;
  const desired = child && !stacked ? rightFits ? anchor.right + 3 : anchor.left - width - 3 : anchor.left;
  const left = Math.max(margin, Math.min(desired, window.innerWidth - width - margin));
  // Narrow windows cannot fit two columns. Stack below the parent row so hover
  // expansion cannot cover its own click target; use the space above if needed.
  if (stacked && window.innerHeight - margin - anchor.bottom - 3 < 30 && anchor.top - 3 - margin >= 30) return { left, top: margin, width, maxHeight: anchor.top - 3 - margin };
  const desiredTop = child && !stacked ? anchor.top : anchor.bottom + 3;
  const top = Math.max(margin, Math.min(desiredTop, window.innerHeight - margin - 30));
  return { left, top, width, maxHeight: Math.max(30, window.innerHeight - top - margin) };
}

export function AppMenuBar({ menus }: { menus: EditorMenu[] }) {
  const [open, setOpen] = useState<string | null>(null), [sub, setSub] = useState<string | null>(null), [focused, setFocused] = useState(0), [reason, setReason] = useState<string | null>(null);
  const [rootPosition, setRootPosition] = useState<ReturnType<typeof position> | null>(null), [subPosition, setSubPosition] = useState<ReturnType<typeof position> | null>(null);
  const bar = useRef<HTMLDivElement>(null), popup = useRef<HTMLDivElement>(null), child = useRef<HTMLDivElement>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>()), entries = useRef(new Map<string, HTMLButtonElement>());
  const menu = menus.find(m => m.id === open), submenu = menu?.entries.find(e => e.kind === 'submenu' && e.id === sub);
  const close = (restore = false) => { if (restore && open) triggers.current.get(open)?.focus({ preventScroll: true }); setOpen(null); setSub(null); setReason(null); };
  const focusItem = (list: Item[], index: number) => { if (!list.length) return; entries.current.get(list[(index + list.length) % list.length].id)?.focus({ preventScroll: true }); };
  const show = (index: number, focus: 'first' | 'last' | null = null) => {
    const i = (index + menus.length) % menus.length, m = menus[i], trigger = triggers.current.get(m.id);
    setFocused(i); setSub(null); setReason(null); setOpen(m.id); if (trigger) setRootPosition(position(trigger.getBoundingClientRect(), false));
    if (focus) requestAnimationFrame(() => focusItem(items(m.entries), focus === 'first' ? 0 : -1));
  };
  const expand = (entry: Item, keyboard = false) => {
    if (entry.kind !== 'submenu' || entry.disabledReason) return;
    const anchor = entries.current.get(entry.id); if (anchor) setSubPosition(position(anchor.getBoundingClientRect(), true));
    setSub(entry.id); if (keyboard) requestAnimationFrame(() => focusItem(items(entry.entries), 0));
  };
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { const t = e.target as Node; if (![bar.current, popup.current, child.current].some(n => n?.contains(t))) close(); };
    const blur = () => close();
    const focusOutside = (e: FocusEvent) => { const t = e.target as Node; if (![bar.current, popup.current, child.current].some(n => n?.contains(t))) close(); };
    document.addEventListener('pointerdown', outside, true); window.addEventListener('blur', blur); document.addEventListener('focusin', focusOutside);
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('blur', blur); document.removeEventListener('focusin', focusOutside); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
      const trigger = triggers.current.get(open), box = trigger?.getBoundingClientRect();
      if (!box || box.right <= 0 || box.left >= window.innerWidth) { close(); return; }
      setRootPosition(position(box, false));
      const anchor = sub && entries.current.get(sub); if (anchor) setSubPosition(position(anchor.getBoundingClientRect(), true));
    }); };
    window.addEventListener('resize', update); document.addEventListener('scroll', update, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', update); document.removeEventListener('scroll', update, true); };
  }, [open, sub]);
  const topKey = (e: KeyboardEvent, index: number) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); e.stopPropagation(); const next = (index + (e.key === 'ArrowLeft' ? -1 : 1) + menus.length) % menus.length;
      setFocused(next); triggers.current.get(menus[next].id)?.focus(); if (open) show(next);
    } else if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); show(index, e.key === 'ArrowUp' ? 'last' : 'first'); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') close();
  };
  const popupKey = (e: KeyboardEvent, list: Item[], nested: boolean) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    const index = list.findIndex(item => entries.current.get(item.id) === document.activeElement), item = list[index];
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); e.stopPropagation(); focusItem(list, e.key === 'Home' ? 0 : e.key === 'End' ? -1 : index + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); if (item?.kind === 'submenu') expand(item, true); else if (!nested) show(focused + 1, 'first'); }
    else if (e.key === 'ArrowLeft' || e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation(); if (nested) { entries.current.get(sub ?? '')?.focus(); setSub(null); }
      else if (e.key === 'ArrowLeft') show(focused - 1, 'first'); else close(true);
    } else if (e.key === 'Tab') {
      // Move focus back to the logical trigger before the browser advances through normal DOM order.
      triggers.current.get(open ?? '')?.focus(); close(); e.stopPropagation();
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (item) activate(item); }
    else if (e.ctrlKey || e.metaKey) e.stopPropagation();
  };
  const activate = (entry: Item) => {
    if (entry.disabledReason) { setReason(entry.disabledReason); return; }
    if (entry.kind === 'submenu') { expand(entry, true); return; }
    // The persistent category button is the modal/picker's logical opener.
    triggers.current.get(open ?? '')?.focus({ preventScroll: true }); close();
    void entry.run();
  };
  const render = (list: MenuEntry[], nested: boolean) => list.map(entry => entry.kind === 'separator' ? <div className="app-menu-separator" role="separator" key={entry.id} /> :
    <button key={entry.id} ref={node => { if (node) entries.current.set(entry.id, node); else entries.current.delete(entry.id); }} className="app-menu-command" role={entry.kind === 'check' ? 'menuitemcheckbox' : entry.kind === 'radio' ? 'menuitemradio' : 'menuitem'}
      aria-label={entry.label} aria-keyshortcuts={entry.kind!=='submenu'?entry.ariaShortcut||undefined:undefined} aria-disabled={!!entry.disabledReason} aria-checked={entry.kind === 'check' || entry.kind === 'radio' ? typeof entry.checked === 'function' ? entry.checked() : entry.checked : undefined} aria-haspopup={entry.kind === 'submenu' ? 'menu' : undefined} aria-expanded={entry.kind === 'submenu' ? sub === entry.id : undefined}
      aria-describedby={entry.disabledReason ? 'app-menu-reason' : undefined} tabIndex={-1} title={entry.disabledReason ?? entry.label}
      onFocus={() => setReason(entry.disabledReason)} onPointerEnter={() => { setReason(entry.disabledReason); if (entry.kind === 'submenu') expand(entry); else if (!nested) setSub(null); }} onClick={() => activate(entry)}>
      <span className="menu-check" aria-hidden="true">{(entry.kind === 'check' || entry.kind === 'radio') && (typeof entry.checked === 'function' ? entry.checked() : entry.checked) ? '✓' : ''}</span><span>{entry.label}</span><kbd>{entry.kind !== 'submenu' ? entry.shortcut : ''}</kbd>{entry.kind === 'submenu' && <span aria-hidden="true">›</span>}
    </button>);
  return <><div ref={bar} className="app-menubar" role="menubar" aria-label="应用菜单">{menus.map((m, index) => <button key={m.id} data-panel-chrome={m.id==='window'?'':undefined} data-text-edit-preserve={m.id==='window'?'':undefined} ref={node => { if (node) triggers.current.set(m.id, node); }} className={open === m.id ? 'menu-trigger active' : 'menu-trigger'} role="menuitem" aria-haspopup="menu" aria-expanded={open === m.id} aria-controls={`menu-${m.id}`} tabIndex={focused === index ? 0 : -1}
    onPointerDown={e=>{if(m.id==='window'){e.preventDefault();panelChangeAllowed();}}} onFocus={() => setFocused(index)} onClick={e => { if(m.id==='window'&&!panelChangeAllowed(false))return;e.currentTarget.focus({ preventScroll: true }); if (open === m.id) close(); else show(index); }} onPointerEnter={() => { if (open && open !== m.id) show(index); }} onKeyDown={e => topKey(e, index)}>{m.label}</button>)}</div>
    {menu && rootPosition && createPortal(<div className="app-menu-popup" data-panel-chrome={menu.id==='window'?'':undefined} data-text-edit-preserve={menu.id==='window'?'':undefined} ref={popup} role="menu" id={`menu-${menu.id}`} aria-label={`${menu.label}菜单`} style={rootPosition} onKeyDown={e => popupKey(e, items(menu.entries), false)}>{render(menu.entries, false)}<div id="app-menu-reason" className="app-menu-reason" role="status">{reason ?? ' '}</div></div>, document.body)}
    {submenu?.kind === 'submenu' && subPosition && createPortal(<div className="app-menu-popup" ref={child} role="menu" aria-label={`${submenu.label}选项`} style={subPosition} onKeyDown={e => popupKey(e, items(submenu.entries), true)}>{render(submenu.entries, true)}</div>, document.body)}
  </>;
}
