import type { Point } from '../domain/types';
type PointerInput = { point: Point; phase: 'down' | 'move' | 'up' | 'cancel'; pointerId: number; shift?: boolean };
let receiver: ((input: PointerInput) => void) | null = null;
export function registerTextPointer(next: NonNullable<typeof receiver>): () => void { receiver = next; return () => { if (receiver === next) receiver = null; }; }
export function textPointer(input: PointerInput): void { receiver?.(input); }
