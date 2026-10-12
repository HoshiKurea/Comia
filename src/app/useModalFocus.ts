import { useEffect, useRef, type RefObject } from 'react';

const stack: HTMLElement[] = [];
let pointerOrigin: { node: HTMLElement } | null = null;
/** Shared stack for dialogs and drawers, including dialogs opened from a drawer. */
export function useModalFocus(root: RefObject<HTMLElement>, enabled: boolean, onCancel: () => void): void {
  const cancel = useRef(onCancel); cancel.current = onCancel;
  const origin = useRef<HTMLElement | null>(null);
  useEffect(() => {
    // WebKit does not focus buttons on a mouse click. Capture the actual opener without
    // moving focus/triggering blur (which would prematurely commit a text draft).
    const remember = (event: PointerEvent) => {
      const node = event.target instanceof Element ? event.target.closest<HTMLElement>('button,[role="button"]') : null;
      if (event.button === 0 && node) pointerOrigin = { node };
    };
    const forgetOnFocus = (event: FocusEvent) => {
      const target = event.target;
      // WebKit's unfocused mouse buttons can cause the parent modal's focus
      // trap to restore its first control. That restoration is not a new opener.
      if (pointerOrigin && target instanceof HTMLElement && target !== document.body && target !== pointerOrigin.node && !stack.some((modal) => modal.contains(target))) pointerOrigin = null;
    };
    const forgetOnKey = () => { pointerOrigin = null; };
    document.addEventListener('pointerdown', remember, true);
    document.addEventListener('focusin', forgetOnFocus, true); document.addEventListener('keydown', forgetOnKey, true);
    return () => { document.removeEventListener('pointerdown', remember, true); document.removeEventListener('focusin', forgetOnFocus, true); document.removeEventListener('keydown', forgetOnKey, true); };
  }, []);
  useEffect(() => {
    if (!enabled || !root.current) { origin.current = null; return; }
    // Native file pickers may stay open for minutes; focus/keyboard changes,
    // rather than a one-second expiry, invalidate the last logical pointer opener.
    const node = root.current, trigger = origin.current ?? (pointerOrigin?.node.isConnected
      ? pointerOrigin.node : document.activeElement as HTMLElement | null);
    // Retain the original opener through StrictMode's effect setup/cleanup replay.
    origin.current = trigger;
    stack.push(node);
    const items = () => [...node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([type=hidden]),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter((item) => item.getClientRects().length > 0);
    const focusFirst = () => (items()[0] ?? node).focus({ preventScroll: true }); focusFirst();
    const key = (event: KeyboardEvent) => {
      if (stack.at(-1) !== node || event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel.current(); return; }
      if (event.key === 'Tab') {
        const candidates = items(), first = candidates[0] ?? node, last = candidates.at(-1) ?? node;
        if (!node.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      }
    };
    const focus = () => { if (stack.at(-1) === node && !node.contains(document.activeElement)) focusFirst(); };
    document.addEventListener('keydown', key, true); document.addEventListener('focusin', focus);
    return () => {
      const index = stack.indexOf(node); if (index !== -1) stack.splice(index, 1);
      document.removeEventListener('keydown', key, true); document.removeEventListener('focusin', focus);
      // Wait until hidden drawer styles take effect. WebKit can discard focus moved
      // during the same commit that hides the previously focused descendant.
      requestAnimationFrame(() => {
        if (trigger?.isConnected && trigger.getClientRects().length && (!stack.length || stack.at(-1)!.contains(trigger))) trigger.focus({ preventScroll: true });
      });
    };
  }, [enabled, root]);
}
