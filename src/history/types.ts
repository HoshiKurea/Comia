/**
 * M02 历史/事务类型契约（01-foundation.md M02 数据结构）。
 */
import type { Id, Project } from '../domain/types';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type Patch =
  | { op: 'add'; path: string; value: JsonValue }
  | { op: 'replace'; path: string; value: JsonValue }
  | { op: 'remove'; path: string };

export interface HistoryEntry {
  id: Id;
  label: string;
  forward: Patch[];
  inverse: Patch[];
  beforeStateId: Id;
  afterStateId: Id;
  pageId: Id;
  afterPageId?: Id;
  beforeSelection: Id[];
  afterSelection: Id[];
  assetRefs: Id[];
  resourceHashes?: string[];
}

export interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  stateId: Id;
}

export interface MutationContext {
  pageId: Id;
  selection: Id[];
}

export interface AsyncToken {
  projectId: Id;
  epoch: number;
  pageId: Id;
  targetId: Id | null;
}

export interface TransactionSpec {
  label: string;
  context: MutationContext;
  mutate: (draft: Project) => void;
  afterSelection?: Id[];
  afterPageId?: Id;
  /** Explicit creation intent; only newly allocated panels may receive default names. Never serialized. */
  defaultNamedPanelIds?: readonly Id[];
  /** Replace a numbered leaf with a batch; insert its numbers instead of appending. */
  panelReplacement?: { sourceId: Id; newIds: readonly Id[] };
}
