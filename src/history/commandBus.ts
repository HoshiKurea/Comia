import { invalidateTransformHints } from '../appearance/transforms';
import { assetReferences } from '../assets/references';
import { preserveUnlinkedMasks } from '../images/maskGeometry';
import { numberCreatedPanels } from '../panels/numbering';
import { completeExtensionProject, stripExtensionDefaults } from '../domain/extensionDefaults';
import { migrateProject } from '../storage/migrateProject';
/**
 * M02-T01/T02/T04：原子执行文档事务、跨页撤销重做、项目替换（epoch 作废）。
 * 只允许同步 pure mutate；最终一次性发布 document + history + 清洗后选区。
 * 异常丢弃 draft，不能先发布半个树。
 */
import type { Id, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { newId } from '../domain/id';
import { validateProject } from '../domain/validate';
import { documentStore, getDocument, type DocumentStoreState } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { invalidateDocumentCaches, runtimeStore } from '../state/runtimeStore';
import { historyResourceHashes } from '../storage/blobRepository';
import type { HistoryEntry, TransactionSpec } from './types';
import { applyPatches, diff } from './jsonPatch';
import { shareUnchanged } from './structuralSharing';
import type { JsonValue } from './types';
import { LIMITS } from '../domain/limits';
import { cancelActiveGesture } from '../interaction/activeGesture';
import { repairDialogueGroups } from '../bubbles/ownership';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { clearMangaGeometryCache } from '../bubbles/composeBubble';
import { clearDialogueCache } from '../bubbles/dialogueGeometry';
import { clearOverlapRasterCache } from '../bubbles/overlapRaster';
import { clearBubbleInkCache } from '../bubbles/inkPaint';
import { clearTailGeometryCache } from '../bubbles/tailGeometry';
import { prepareHistoryTravel,historyTravelGuard,type HistoryJumpToken } from './historyTravel';
function releaseMangaCaches():void{clearBubbleInkCache();clearOverlapRasterCache();clearMangaGeometryCache();clearDialogueCache();clearTailGeometryCache();}

type BusEvent =
  | { type: 'historyTrim'; entries: HistoryEntry[] }
  | { type: 'historyClear' }
  | { type: 'documentReplaced'; project: Project }
  | { type: 'documentChanged'; label: string; pageId: Id };

const listeners = new Set<(e: BusEvent) => void>();

export function onBusEvent(cb: (e: BusEvent) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit(e: BusEvent): void {
  for (const cb of listeners) cb(e);
}

/** 收集 after 中所有 image 图层引用的 assetId */
function collectAssetRefs(project: Project): Id[] {
  return assetReferences(project);
}

function sanitizeSelection(project: Project, ids: Id[]): Id[] {
  return ids.filter((id) => id in project.layers);
}

/**
 * 原子执行一个文档事务。无差异返回 ok(null)，不消耗历史。
 * 一次用户动作产生一个历史条目（pointermove 不调用 execute）。
 */
export function execute(spec: TransactionSpec): Result<HistoryEntry | null> {
  const edit = finishActiveTextEdit(); if (!edit.ok) return edit;
  cancelActiveGesture();
  const doc = getDocument();
  const { project: before, history } = doc;

  // commit 校验目标页仍存在
  if (!before.pages[spec.context.pageId]) {
    return fail(problem('tx/page-missing', `目标页面 ${spec.context.pageId} 不存在，事务已取消`));
  }

  const beforeStateId = history.stateId;
  let draft: Project;
  try {
    draft = structuredClone(before) as unknown as Project;
    // A live format5..8 workspace may survive HMR; insert numbering still uses
    // its existing source number while upgrading metadata in the SAME history entry.
    if ((spec.panelReplacement || spec.defaultNamedPanelIds?.length) && before.schemaVersion >= 5 && draft.schemaVersion < 9) {
      const upgraded = migrateProject(draft); if (!upgraded.ok) return upgraded; draft = upgraded.value;
    }
    spec.mutate(draft);
    invalidateTransformHints(draft);
    if (draft.schemaVersion >= 9) completeExtensionProject(draft); else stripExtensionDefaults(draft, before);
    repairDialogueGroups(draft,before);
    const numbered = numberCreatedPanels(before, draft, spec.defaultNamedPanelIds, spec.panelReplacement);
    if (!numbered.ok) return numbered;
    preserveUnlinkedMasks(before, draft);
    // Removing the last image owner removes metadata in the same transaction; inverse restores it for undo.
    const beforeAssets = collectAssetRefs(before), afterAssets = new Set(collectAssetRefs(draft));
    for (const id of beforeAssets) if (!afterAssets.has(id)) delete draft.assets[id];
  } catch (e) {
    // 异常丢弃 draft，原文档不变
    return fail(problem('tx/mutate-threw', `事务 "${spec.label}" 执行异常已回滚：${(e as Error).message}`));
  }

  const v = validateProject(draft);
  if (!v.ok) {
    return fail(...v.problems);
  }

  const forward = diff(before as unknown as JsonValue, draft as unknown as JsonValue);
  if (forward.length === 0) {
    // 输入与原值相同：不消耗历史
    return ok(null);
  }
  const inverse = diff(draft as unknown as JsonValue, before as unknown as JsonValue);

  // 应用 patch 到 clone 后再次 validate，再发布
  const replay = structuredClone(before) as unknown as Project;
  try {
    applyPatches(replay as unknown as JsonValue, forward);
  } catch (e) {
    return fail(problem('tx/patch-apply-failed', `patch 应用失败：${(e as Error).message}`));
  }
  const rv = validateProject(replay);
  if (!rv.ok) {
    return fail(...rv.problems.map((p) => ({ ...p, code: `tx/replay-${p.code}` })));
  }

  const afterStateId = newId();
  const assetRefs = [...new Set([...collectAssetRefs(before), ...collectAssetRefs(draft)])];
  const entry: HistoryEntry = {
    id: newId(),
    label: spec.label,
    forward,
    inverse,
    beforeStateId,
    afterStateId,
    pageId: spec.context.pageId,
    afterPageId: spec.afterPageId,
    beforeSelection: [...spec.context.selection],
    afterSelection: sanitizeSelection(draft, spec.afterSelection ?? spec.context.selection),
    assetRefs,
    resourceHashes: historyResourceHashes(before, draft, assetRefs),
  };

  const past = [...history.past, entry].slice(-LIMITS.maxHistory);
  const dropped = history.past.length + 1 > LIMITS.maxHistory ? history.past.slice(0, history.past.length + 1 - LIMITS.maxHistory) : [];

  // 一次性发布
  documentStore.setState({
    project: shareUnchanged(before, draft),
    history: { past, future: [], stateId: afterStateId },
    savedStateId: doc.savedStateId,
    epoch: doc.epoch,
  });
  invalidateDocumentCaches();

  const selection = entry.afterSelection;
  sessionStore.setState((session) => ({ selection, selectionAnchorId: spec.afterSelection ? selection[0] ?? null : session.selectionAnchorId && draft.layers[session.selectionAnchorId] ? session.selectionAnchorId : selection[0] ?? null }));
  emit({ type: 'documentChanged', label: spec.label, pageId: spec.context.pageId });
  if (dropped.length > 0) emit({ type: 'historyTrim', entries: dropped });

  return ok(entry);
}

/** undo 取 inverse，redo 取 forward；全项目统一栈。 */
export function undo(): Result<void> {
  const edit = finishActiveTextEdit(); if (!edit.ok) return edit;
  cancelActiveGesture();
  const doc = getDocument();
  const { past, future, stateId } = doc.history;
  if (past.length === 0) {
    return fail(problem('history/empty-undo', '没有可撤销的操作'));
  }
  const entry = past[past.length - 1];
  if (stateId !== entry.afterStateId) {
    return fail(problem('history/state-mismatch', '内部状态不一致：当前 stateId 与栈顶不符'));
  }
  const draft = structuredClone(doc.project) as unknown as Project;
  try {
    applyPatches(draft as unknown as JsonValue, entry.inverse);
  } catch (e) {
    return fail(problem('history/undo-failed', `撤销失败：${(e as Error).message}`));
  }
  const v = validateProject(draft);
  if (!v.ok) {
    return fail(...v.problems);
  }

  // 自动切到该条目目标页；若已不存在选 pageOrder 第一项
  const targetPage = draft.pages[entry.pageId] ? entry.pageId : draft.pageOrder[0];
  const selection = sanitizeSelection(draft, entry.beforeSelection);

  documentStore.setState({
    project: shareUnchanged(doc.project, draft),
    history: {
      past: past.slice(0, -1),
      future: [entry, ...future],
      stateId: entry.beforeStateId,
    },
    savedStateId: doc.savedStateId,
    epoch: doc.epoch,
  });
  invalidateDocumentCaches();
  sessionStore.setState(() => ({
    activePageId: targetPage,
    selection,
    cropTarget: null,
    toolMode: 'select',
  }));
  emit({ type: 'documentChanged', label: `undo:${entry.label}`, pageId: targetPage });
  return ok(undefined);
}

export function redo(): Result<void> {
  const edit = finishActiveTextEdit(); if (!edit.ok) return edit;
  cancelActiveGesture();
  const doc = getDocument();
  const { past, future, stateId } = doc.history;
  if (future.length === 0) {
    return fail(problem('history/empty-redo', '没有可重做的操作'));
  }
  const entry = future[0];
  if (stateId !== entry.beforeStateId) {
    return fail(problem('history/state-mismatch', '内部状态不一致：当前 stateId 与重做栈不符'));
  }
  const draft = structuredClone(doc.project) as unknown as Project;
  try {
    applyPatches(draft as unknown as JsonValue, entry.forward);
  } catch (e) {
    return fail(problem('history/redo-failed', `重做失败：${(e as Error).message}`));
  }
  const v = validateProject(draft);
  if (!v.ok) {
    return fail(...v.problems);
  }

  const targetPage = draft.pages[entry.afterPageId ?? entry.pageId] ? (entry.afterPageId ?? entry.pageId) : draft.pageOrder[0];
  const selection = sanitizeSelection(draft, entry.afterSelection);

  documentStore.setState({
    project: shareUnchanged(doc.project, draft),
    history: {
      past: [...past, entry],
      future: future.slice(1),
      stateId: entry.afterStateId,
    },
    savedStateId: doc.savedStateId,
    epoch: doc.epoch,
  });
  invalidateDocumentCaches();
  sessionStore.setState(() => ({
    activePageId: targetPage,
    selection,
    cropTarget: null,
    toolMode: 'select',
  }));
  emit({ type: 'documentChanged', label: `redo:${entry.label}`, pageId: targetPage });
  return ok(undefined);
}

/** 当前是否相对最近保存有未保存更改 */
export function travelToHistoryState(targetStateId:string,token:HistoryJumpToken):Result<void> {
  const r=runtimeStore.getState(),s=sessionStore.getState(),reason=historyTravelGuard();
  if(reason || r.gestureActive || r.previewProject || s.textEditingId || s.toolMode==='crop')return fail(problem('history/edit-active',reason ?? '请先完成或取消当前编辑，再恢复历史'));
  const doc=getDocument(),result=prepareHistoryTravel(doc,targetStateId,token);if(!result.ok)return result;if(!result.value.changed)return ok(undefined);
  const v=result.value;
  documentStore.setState({project:shareUnchanged(doc.project,v.project),history:v.history,savedStateId:doc.savedStateId,epoch:doc.epoch});
  invalidateDocumentCaches();releaseMangaCaches();
  sessionStore.setState({activePageId:v.pageId,selection:v.selection,selectionAnchorId:v.selection[0] ?? null,scopeId:null,cropTarget:null,toolMode:'select'});
  emit({type:'documentChanged',label:'恢复历史状态',pageId:v.pageId});return ok(undefined);
}

/** 当前是否相对最近保存有未保存更改 */
export function isDirty(): boolean {
  const doc = getDocument();
  return doc.savedStateId !== null && doc.history.stateId !== doc.savedStateId;
}

/** 从未保存过文件时也视为脏（保存标记语义见 M13） */
export function needsSavePrompt(): boolean {
  const doc = getDocument();
  return doc.savedStateId === null || doc.history.stateId !== doc.savedStateId;
}

export function clearHistory(confirm: boolean): Result<void> {
  if (!confirm) return ok(undefined);
  if (runtimeStore.getState().gestureActive || sessionStore.getState().textEditingId || sessionStore.getState().toolMode === 'crop') return fail(problem('history/edit-active', '请先完成或取消当前编辑，再清空历史'));
  const doc = getDocument(); documentStore.setState({ history: { ...doc.history, past: [], future: [] } }); emit({ type: 'historyClear' }); return ok(undefined);
}

/**
 * 项目整体替换（打开文件/导入）：增 epoch 作废全部异步任务，
 * 重置历史与会话指向第一页。
 */
export function replaceDocument(project: Project): Result<void> {
  cancelActiveGesture();
  const v = validateProject(project);
  if (!v.ok) return fail(...v.problems);
  finishActiveTextEdit('cancel');
  const doc = getDocument();
  documentStore.setState({
    project,
    history: { past: [], future: [], stateId: project.id },
    savedStateId: null,
    epoch: doc.epoch + 1,
  });
  invalidateDocumentCaches();
  const firstPage = project.pageOrder[0];
  sessionStore.setState({
    activePageId: firstPage,
    selection: [],
    scopeId: null,
    viewportByPage: {},
    expanded: [],
    cropTarget: null,
    textEditingId: null,
    toolMode: 'select',
  });
  emit({ type: 'documentReplaced', project });
  releaseMangaCaches();
  return ok(undefined);
}

/** Activate an existing workspace without turning activation into a content edit. */
export function restoreDocument(snapshot: DocumentStoreState): Result<void> {
  const valid = validateProject(snapshot.project); if (!valid.ok) return valid;
  cancelActiveGesture(); finishActiveTextEdit('cancel');
  const epoch = getDocument().epoch + 1;
  documentStore.setState({ project: snapshot.project, history: snapshot.history, savedStateId: snapshot.savedStateId, epoch });
  invalidateDocumentCaches();
  emit({ type: 'documentReplaced', project: snapshot.project });
  releaseMangaCaches();
  return ok(undefined);
}
