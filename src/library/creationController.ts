import type { Id, Point, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { createObjectDraft, type CreateKind, type ObjectDraft } from '../app/actions';
import { resetCounters, syncCounters } from '../domain/factories';
import { getProject } from '../state/documentStore';
import { registerGestureCanceller } from '../interaction/activeGesture';

export interface CreationDrag {
  kind: CreateKind;
  pageId: Id;
  pointerId: number;
  client: Point;
  draft: ObjectDraft;
  altKey?:boolean;
}

let active: CreationDrag | null = null;
let unregisterCancel: (() => void) | null = null;
let dropHandler: ((drag: CreationDrag, client: Point) => Result<Id | null>) | null = null;
const listeners = new Set<() => void>();
function emit(): void { for (const listener of listeners) listener(); }
function recoverNames(): void { resetCounters(); syncCounters(getProject()); }

export function currentCreation(): CreationDrag | null { return active; }
export function subscribeCreation(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export function registerCreationDrop(handler: (drag: CreationDrag, client: Point) => Result<Id | null>): () => void {
  dropHandler = handler;
  return () => { if (dropHandler === handler) dropHandler = null; };
}

export function beginCreation(kind: CreateKind, pageId: Id, pointerId: number, client: Point): Result<void> {
  if (active) return fail(problem('creation/active', '已有组件正在拖动'));
  const draft = createObjectDraft(kind, pageId);
  if (!draft.ok) return draft;
  active = { kind, pageId, pointerId, client, draft: draft.value };
  unregisterCancel = registerGestureCanceller(() => cancelCreation());
  emit();
  return ok(undefined);
}

export function updateCreation(pointerId: number, client: Point, altKey=false): void {
  if (!active || active.pointerId !== pointerId) return;
  active.client = client;
  active.altKey=altKey;
  emit();
}

export function cancelCreation(pointerId?: number): void {
  if (!active || pointerId !== undefined && active.pointerId !== pointerId) return;
  active = null;
  unregisterCancel?.(); unregisterCancel = null;
  recoverNames();
  emit();
}

export function dropCreation(pointerId: number, client: Point): Result<Id | null> {
  if (!active || active.pointerId !== pointerId) return fail(problem('creation/inactive', '没有可放置的组件'));
  const drag = active;
  active = null;
  unregisterCancel?.(); unregisterCancel = null;
  emit();
  const result = dropHandler ? dropHandler(drag, client) : fail(problem('creation/canvas', '画布尚未准备好'));
  if (!result.ok || result.value === null) recoverNames();
  return result;
}
