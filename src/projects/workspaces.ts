import { createStore } from 'zustand/vanilla';
import { newId } from '../domain/id';
import { resetCounters, syncCounters } from '../domain/factories';
import { validateProject } from '../domain/validate';
import { fail, ok, problem, type Project, type Result } from '../domain/types';
import { documentStore, getDocument, type DocumentStoreState } from '../state/documentStore';
import { sessionStore, type SessionStoreState } from '../state/sessionStore';
import { runtimeStore } from '../state/runtimeStore';
import { replaceDocument, restoreDocument } from '../history/commandBus';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { getActiveFileHandle, setActiveFileHandle } from '../storage/fileSave';
import { getDirectoryBinding, setDirectoryBinding, type DirectoryBinding } from '../storage/directorySession';
import { flushRecovery, getRecoveryBinding, setRecoveryBinding, type RecoveryBinding } from '../storage/recovery';
import { replaceRuntimeResources, retainWorkspaceResources } from '../storage/blobRepository';

type PageSession = Pick<SessionStoreState, 'activePageId' | 'selection' | 'scopeId' | 'viewportByPage' | 'expanded' | 'filter' | 'selectionAnchorId' | 'geometryConstraint'>;
interface ParkedWorkspace {
  document: DocumentStoreState;
  session: PageSession;
  blobs: Map<string, Blob>;
  images: Map<string, ImageBitmap | HTMLImageElement>;
  file: FileSystemFileHandle | null;
  directory: DirectoryBinding;
  recovery: RecoveryBinding;
  release: () => void;
}
export interface WorkspaceTab { id: string; name: string; dirty: boolean }
interface WorkspaceState { activeId: string; tabs: WorkspaceTab[]; transitioning: boolean }
const initialId = newId();
export const workspaceStore = createStore<WorkspaceState>(() => ({ activeId: initialId, tabs: [{ id: initialId, name: getDocument().project.name, dirty: false }], transitioning: false }));
const parked = new Map<string, ParkedWorkspace>();

export function documentHasWork(doc: DocumentStoreState): boolean {
  const p = doc.project;
  const page = p.pages[p.pageOrder[0]];
  return doc.history.stateId !== p.id || doc.history.past.length > 0 || p.pageOrder.length > 1 ||
    Object.values(p.layers).some(l => l.type !== 'pageBackground' || l.fill !== '#FFFFFFFF' || l.frame !== null || l.watermark !== null || !l.visible || l.locked || l.name !== '页面背景' || l.colorLabel !== null) ||
    Object.keys(p.assets).length > 0 || Object.keys(p.templates).length > 0 || p.name !== '未命名项目' || page?.width !== 2480 || page?.height !== 3508 || page?.dpi !== 300;
}
export function documentDirty(doc = getDocument()): boolean { return documentHasWork(doc) && doc.savedStateId !== doc.history.stateId; }
export function hasUnsavedWorkspaces(): boolean { return documentDirty() || [...parked.values()].some(p => documentDirty(p.document)); }
export function hasUnsavedInactiveWorkspaces(): boolean { return [...parked.values()].some(p => documentDirty(p.document)); }
function refresh(): void {
  const state = workspaceStore.getState(), doc = getDocument();
  workspaceStore.setState({ tabs: state.tabs.map(t => t.id === state.activeId ? { ...t, name: doc.project.name, dirty: documentDirty(doc) } : t) });
}
documentStore.subscribe(refresh);

function capture(): ParkedWorkspace {
  const s = sessionStore.getState(), r = runtimeStore.getState();
  const blobs = new Map(r.blobs), images = new Map(r.images);
  return { document: getDocument(), session: { activePageId: s.activePageId || getDocument().project.pageOrder[0], selection: s.selection, scopeId: s.scopeId, viewportByPage: s.viewportByPage, expanded: s.expanded, filter: s.filter, selectionAnchorId: s.selectionAnchorId, geometryConstraint: s.geometryConstraint },
    blobs, images, file: getActiveFileHandle(), directory: getDirectoryBinding(), recovery: getRecoveryBinding(), release: retainWorkspaceResources(blobs, images) };
}
function sameDocument(origin: DocumentStoreState): boolean { const current = getDocument(); return current.epoch === origin.epoch && current.project.id === origin.project.id && current.history.stateId === origin.history.stateId; }
async function prepare(): Promise<Result<void>> {
  if (runtimeStore.getState().gestureActive || runtimeStore.getState().previewProject || sessionStore.getState().toolMode === 'crop') return fail(problem('workspace/preview', '请先完成或取消当前预览或手势'));
  const edit = finishActiveTextEdit(); if (!edit.ok) return edit;
  const origin = getDocument();
  await flushRecovery(); // Failure is reported by recovery; both workspaces still remain in memory.
  return sameDocument(origin) ? ok(undefined) : fail(problem('workspace/stale', '切换期间作品已改变，请重试；当前编辑仍保留'));
}
async function transition<T>(task: () => Promise<Result<T>>): Promise<Result<T>> {
  if (workspaceStore.getState().transitioning) return fail(problem('workspace/busy', '正在切换项目，请等待完成'));
  workspaceStore.setState({ transitioning: true });
  try { return await task(); } finally { workspaceStore.setState({ transitioning: false }); refresh(); }
}
function adopt(outgoing: ParkedWorkspace): void {
  const state = workspaceStore.getState(), id = newId();
  parked.set(state.activeId, outgoing);
  workspaceStore.setState({ activeId: id, tabs: [...state.tabs.map(t => t.id === state.activeId ? { ...t, name: outgoing.document.project.name, dirty: documentDirty(outgoing.document) } : t), { id, name: getDocument().project.name, dirty: documentDirty() }] });
  setRecoveryBinding({ owner: id, source: getRecoveryBinding().source });
  resetCounters(); syncCounters(getDocument().project);
}
export function createWorkspace(project: Project): Promise<Result<void>> {
  return transition(async () => {
    const valid = validateProject(project); if (!valid.ok) return valid;
    const ready = await prepare(); if (!ready.ok) return ready;
    const outgoing = capture(), result = replaceDocument(project);
    if (!result.ok) { outgoing.release(); return result; }
    setActiveFileHandle(null); setDirectoryBinding(null); replaceRuntimeResources(new Map(), new Map());
    sessionStore.setState({ filter: { name: '', color: null }, selectionAnchorId: null, notices: [] });
    adopt(outgoing); return ok(undefined);
  });
}
/** The loader installs only after complete validation; a failed read never creates an empty tab. */
export function openWorkspace<T>(load: () => Promise<Result<T>>): Promise<Result<T>> {
  return transition(async () => {
    const ready = await prepare(); if (!ready.ok) return ready;
    const outgoing = capture();
    try {
      const result = await load();
      if (result.ok && getDocument().epoch !== outgoing.document.epoch) {
        sessionStore.setState({ filter: { name: '', color: null }, selectionAnchorId: null, notices: [] });
        adopt(outgoing);
      } else outgoing.release();
      return result;
    } catch (error) { outgoing.release(); return fail(problem('workspace/open', `打开项目失败：${(error as Error).message}`)); }
  });
}
export function switchWorkspace(id: string): Promise<Result<void>> {
  if (id === workspaceStore.getState().activeId) return Promise.resolve(ok(undefined));
  return transition(async () => {
    const target = parked.get(id); if (!target) return fail(problem('workspace/missing', '项目标签已关闭'));
    const ready = await prepare(); if (!ready.ok) return ready;
    const outgoing = capture(), oldId = workspaceStore.getState().activeId;
    const restored = restoreDocument(target.document);
    if (!restored.ok) { outgoing.release(); return restored; }
    parked.set(oldId, outgoing); parked.delete(id);
    setActiveFileHandle(target.file); setDirectoryBinding(target.directory); setRecoveryBinding(target.recovery);
    replaceRuntimeResources(target.blobs, target.images); target.release();
    sessionStore.setState({ ...target.session, notices: [], toolMode: 'select', cropTarget: null, textEditingId: null, spacePan: false });
    workspaceStore.setState(s => ({ activeId: id, tabs: s.tabs.map(t => t.id === oldId ? { ...t, name: outgoing.document.project.name, dirty: documentDirty(outgoing.document) } : t) }));
    resetCounters(); syncCounters(getDocument().project); return ok(undefined);
  });
}
/** Caller must obtain save/discard consent before closing a dirty workspace. */
export async function closeActiveWorkspace(fallback: Project): Promise<Result<void>> {
  const state = workspaceStore.getState(), oldId = state.activeId;
  if (state.transitioning) return fail(problem('workspace/busy', '正在切换项目'));
  const next = state.tabs[state.tabs.findIndex(t => t.id === oldId) + 1] ?? state.tabs[state.tabs.findIndex(t => t.id === oldId) - 1];
  const result = next ? await switchWorkspace(next.id) : await createWorkspace(fallback);
  if (!result.ok) return result;
  parked.get(oldId)?.release(); parked.delete(oldId);
  workspaceStore.setState(s => ({ tabs: s.tabs.filter(t => t.id !== oldId) }));
  return ok(undefined);
}
