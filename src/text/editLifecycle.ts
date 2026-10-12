import { ok, type Result } from '../domain/types';

// The command bus depends on this boundary, never on a React component/controller.
let finish: ((mode: 'commit' | 'cancel') => Result<void>) | null = null;
export function registerTextEditBoundary(handler: NonNullable<typeof finish>): () => void {
  finish = handler;
  return () => { if (finish === handler) finish = null; };
}
export function finishActiveTextEdit(mode: 'commit' | 'cancel' = 'commit'): Result<void> {
  return finish?.(mode) ?? ok(undefined);
}
