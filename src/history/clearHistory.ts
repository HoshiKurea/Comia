/**
 * M02-T03：清空历史。必须先由 UI 确认；取消对话框不得改栈。
 * 确认只清 past/future，不改画面、当前 stateId 和文件保存标记。
 * 活动手势或文字编辑期间先要求结束当前编辑。
 */
import type { Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { getDocument } from '../state/documentStore';
import { documentStore } from '../state/documentStore';
import { runtimeStore } from '../state/runtimeStore';
import { sessionStore } from '../state/sessionStore';

export function clearHistory(confirm: boolean): Result<void> {
  if (!confirm) {
    // 取消：不改任何状态
    return ok(undefined);
  }
  const doc = getDocument();
  if (runtimeStore.getState().gestureActive || sessionStore.getState().textEditingId) {
    return fail(problem('history/editing', '请先结束当前手势或文字编辑，再清空历史'));
  }
  documentStore.setState({
    ...doc,
    history: { past: [], future: [], stateId: doc.history.stateId },
  });
  // 通知素材管理重新计算引用（仍被文档/保存/导出持有的不释放）
  return ok(undefined);
}
