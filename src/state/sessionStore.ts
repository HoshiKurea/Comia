/**
 * M01-T03：会话 Store。选择、缩放、主题、工具模式等不进文档历史。
 * Zustand 订阅按 id 和必要标量取值；禁止每个对象订阅整个 Project。
 */
import { createStore } from 'zustand/vanilla';
import type { Id, LabelColor, Viewport } from '../domain/types';
import type { ToolMode } from '../interaction/types';
import { documentStore } from './documentStore';
import type {AreaSelectionOptions} from '../interaction/regionSelection';

export interface NoticeContext {
  epoch?: number;
  objectName?: string;
  action?: { label: string; run: () => void | Promise<void> };
}
export interface Notice extends NoticeContext {
  id: number; kind: 'error' | 'info'; message: string;
  epoch: number; targetId: Id | null;
}

export interface SessionStoreState {
  activePageId: Id;
  selection: Id[];
  scopeId: Id | null;
  viewportByPage: Record<Id, Viewport>;
  expanded: Id[];
  filter: { name: string; color: LabelColor };
  theme: 'light' | 'dark' | 'system';
  snap16: boolean;
  showPanelNumbers: boolean;
  spacePan: boolean;
  geometryConstraint: 'freeConvex' | 'parallelogram' | 'rectangle';
  toolMode: ToolMode;
  areaSelectionOptions: AreaSelectionOptions;
  panelCutGap: number;
  /** 裁剪会话目标 */
  cropTarget: { pageId: Id; panelId: Id; imageId: Id } | null;
  /** 文字编辑会话目标 */
  textEditingId: Id | null;
  /** 命名当前选区锚点（图层面板 Shift 连续选） */
  selectionAnchorId: Id | null;
  /** 状态提示（错误/拒绝原因 toast） */
  notices: Notice[];
}

export const sessionStore = createStore<SessionStoreState>(() => ({
  activePageId: '',
  selection: [],
  scopeId: null,
  viewportByPage: {},
  expanded: [],
  filter: { name: '', color: null },
  theme: 'system',
  snap16: false,
  showPanelNumbers: true,
  spacePan: false,
  geometryConstraint: 'freeConvex',
  toolMode: 'select',
  areaSelectionOptions: {combination:'replace',match:'intersects',target:'scope'},
  panelCutGap:16,
  cropTarget: null,
  textEditingId: null,
  selectionAnchorId: null,
  notices: [],
}));

let noticeSeq = 0;

export function dismissNotice(id: number): void {
  sessionStore.setState((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
}

export function pushNotice(kind: 'error' | 'info', message: string, context: NoticeContext = {}): void {
  noticeSeq += 1;
  const doc = documentStore.getState(), targetId = sessionStore.getState().selection[0] ?? null;
  if (context.epoch !== undefined && context.epoch !== doc.epoch) return;
  const notice: Notice = { id: noticeSeq, kind, message, epoch: doc.epoch, targetId,
    objectName: kind === 'error' ? doc.project.layers[targetId ?? '']?.name ?? doc.project.name : undefined, ...context };
  sessionStore.setState((s) => ({ notices: [...s.notices.slice(-4), notice] }));
  // Errors remain actionable until dismissed; an expiry must not remove keyboard focus.
  if (kind === 'info') setTimeout(() => dismissNotice(notice.id), 6000);
}

export function setSelection(ids: Id[], anchorId: Id | null = null): void {
  sessionStore.setState({ selection: ids, selectionAnchorId: anchorId });
}

export function setViewport(pageId: Id, vp: Viewport): void {
  sessionStore.setState((s) => ({ viewportByPage: { ...s.viewportByPage, [pageId]: vp } }));
}

export function getViewport(pageId: Id): Viewport | undefined {
  return sessionStore.getState().viewportByPage[pageId];
}
