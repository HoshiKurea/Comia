/**
 * M02-T04：异步作废令牌。project replacement 增 epoch；
 * 异步导图/字体/缩略图完成时核对项目、页和目标存在性。
 */
import type { Id, Result } from '../domain/types';
import type { AsyncToken } from './types';
import { fail, ok, problem } from '../domain/types';
import { getDocument } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';

export function makeAsyncToken(targetId: Id | null): AsyncToken {
  const doc = getDocument();
  return {
    projectId: doc.project.id,
    epoch: doc.epoch,
    pageId: sessionStore.getState().activePageId,
    targetId,
  };
}

export function isTokenCurrent(token: AsyncToken): boolean {
  const doc = getDocument();
  if (doc.project.id !== token.projectId || doc.epoch !== token.epoch) return false;
  if (!doc.project.pages[token.pageId]) return false;
  if (token.targetId !== null) {
    const exists = token.targetId in doc.project.layers || token.targetId in doc.project.pages;
    if (!exists) return false;
  }
  return true;
}

/** 预览期间阻止与同一目标冲突的属性/层级命令；允许取消后再执行 */
export function guardConflict(targetId: Id | null, gestureActive: boolean): Result<void> {
  if (!gestureActive) return ok(undefined);
  return fail(
    problem(
      'guard/gesture-active',
      targetId ? `目标 ${targetId} 正在手势预览中，请先完成或取消` : '手势进行中，无法执行该命令',
    ),
  );
}
