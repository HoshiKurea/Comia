const cancellers = new Set<() => void>();

/** One editor canvas owns the active pointer preview; it never enters document history. */
export function registerGestureCanceller(fn: () => void): () => void {
  cancellers.add(fn);
  return () => { cancellers.delete(fn); };
}

export function cancelActiveGesture(): void { for (const cancel of [...cancellers]) cancel(); }
