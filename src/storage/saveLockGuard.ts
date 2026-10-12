const guards = new WeakMap<AbortSignal, () => Promise<void>>();

export function registerSaveLockGuard(signal: AbortSignal, guard: () => Promise<void>): () => void {
  guards.set(signal, guard);
  return () => guards.delete(signal);
}

/** Each write phase revalidates the lease, including immediately before close commits staged bytes. */
export async function checkSaveLock(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('保存锁已失效', 'AbortError');
  if (signal) await guards.get(signal)?.();
  if (signal?.aborted) throw new DOMException('保存锁已失效', 'AbortError');
}
