/**
 * M01-T03：文档 Store。文档只能由 M02 命令总线写入。
 * 选择、缩放、主题不进文档历史（在 sessionStore）。
 */
import { createStore } from 'zustand/vanilla';
import type { Id, Project } from '../domain/types';
import type { HistoryState } from '../history/types';
import { createProject } from '../domain/factories';

export interface DocumentStoreState {
  project: Project;
  history: HistoryState;
  /** 最近一次通过保存/导出确认的 stateId；null 表示从未保存 */
  savedStateId: Id | null;
  /** 会话期间被替换抛弃的旧项目（用于异步守卫比较） */
  epoch: number;
}

export const documentStore = createStore<DocumentStoreState>(() => {
  const project = createProject({ comic: true });
  return {
    project,
    history: { past: [], future: [], stateId: project.id },
    savedStateId: null,
    epoch: 1,
  };
});

export function getDocument(): DocumentStoreState {
  return documentStore.getState();
}

export function getProject(): Project {
  return documentStore.getState().project;
}
