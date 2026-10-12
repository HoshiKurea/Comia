import type { Id, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { getDocument, documentStore } from '../state/documentStore';
import { runtimeStore } from '../state/runtimeStore';
import { pushNotice } from '../state/sessionStore';
import { markRecoverySaved } from './recovery';
import { clearActiveFileHandle, installLoadedProject } from './fileSave';
import { activateDirectoryCandidate, loadDirectory, loadDirectoryCandidate, saveDirectory, type DirectoryCandidate, type DirectorySaveReceipt } from './directorySave';
import { announceDirectoryGeneration, onDirectoryGeneration, withProjectSaveLock } from './saveCoordinator';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { retainResources } from './blobRepository';
import { DirectoryWriteQueue } from './directoryWriteQueue';

type PickerWindow = Window & { showDirectoryPicker?: (options?: { mode?: 'readwrite' }) => Promise<FileSystemDirectoryHandle> };
export type DirectoryBinding = { handle: FileSystemDirectoryHandle; generation: Id; projectId: Id } | null;
let active: DirectoryBinding = null;
let pendingRecovery: { handle: FileSystemDirectoryHandle; pointerFingerprint: string | null } | null = null;
interface SaveTarget { chosen: Promise<FileSystemDirectoryHandle>; generation: Id | null; projectId: Id; epoch: number; session: number }
const writes = new DirectoryWriteQueue<Result<DirectorySaveReceipt>>();
let normalTarget: SaveTarget | null = null;
let session = 0, requestOrder = 0, attachedOrder = 0;
export function getDirectoryBinding(): DirectoryBinding { return active; }
export function setDirectoryBinding(binding: DirectoryBinding): void { resetDirectorySession(); active = binding; }
onDirectoryGeneration((projectId, generation) => {
  if (active?.projectId === projectId && active.generation !== generation) pushNotice('info', '其他标签页已保存此项目；本页下次保存会核对目录版本');
});

export function directorySupported(): boolean { return window.isSecureContext && typeof (window as PickerWindow).showDirectoryPicker === 'function'; }
export function resetDirectorySession(): void { active = null; pendingRecovery = null; normalTarget = null; session++; }
function picker(): Promise<FileSystemDirectoryHandle> {
  if (!directorySupported()) throw new Error('此浏览器请使用单文件保存');
  return (window as PickerWindow).showDirectoryPicker!({ mode: 'readwrite' });
}
export function chooseDirectory(): Promise<FileSystemDirectoryHandle> { return picker(); }
function failure(error: unknown): Result<never> {
  if (error instanceof DOMException && error.name === 'AbortError' && error.message === '保存锁已失效') return fail(problem('directory/lock-lost', '目录保存锁已失效，请重试；当前编辑仍保留'));
  if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return fail(problem('directory/cancelled', '已取消目录选择'));
  return fail(problem('directory/picker', `目录操作失败：${error instanceof Error ? error.message : String(error)}`));
}

export function saveToDirectory(asCopy = false): Promise<Result<DirectorySaveReceipt>> {
  const edit = finishActiveTextEdit(); if (!edit.ok) return Promise.resolve(edit);
  const snapshot = getDocument(), order = ++requestOrder;
  let target = !asCopy && normalTarget?.projectId === snapshot.project.id && normalTarget.epoch === snapshot.epoch && normalTarget.session === session ? normalTarget : null;
  // Freeze the binding before awaiting the picker. A pending first normal save shares its picker.
  try {
    if (!target) {
      const existing = !asCopy && active?.projectId === snapshot.project.id ? active : null;
      target = { chosen: existing ? Promise.resolve(existing.handle) : picker(), generation: existing?.generation ?? null, projectId: snapshot.project.id, epoch: snapshot.epoch, session };
      if (!asCopy) normalTarget = target;
    }
  }
  catch (error) { return Promise.resolve(failure(error)); }
  const binding = target, frozen = structuredClone(snapshot.project), stateId = snapshot.history.stateId;
  const blobs = new Map(runtimeStore.getState().blobs), release = retainResources(frozen, blobs, new Map());
  const task = (async (): Promise<Result<DirectorySaveReceipt>> => {
    let handle: FileSystemDirectoryHandle;
    try { handle = await binding.chosen; }
    catch (error) { if (normalTarget === binding) normalTarget = null; return failure(error); }
    const result = await writes.enqueue(handle, binding, async () => {
      const saved = await withProjectSaveLock(binding.projectId, (signal) => saveDirectory(handle, { project: frozen, stateId, blobs }, binding.generation, signal));
      if (saved.ok) binding.generation = saved.value.generation;
      return saved;
    });
    if (result.ok) {
      const current = getDocument();
      announceDirectoryGeneration(binding.projectId, result.value.generation);
      if (current.project.id === binding.projectId && current.epoch === binding.epoch && session === binding.session) {
        if (order >= attachedOrder) { attachedOrder = order; active = { handle, generation: result.value.generation, projectId: binding.projectId }; normalTarget = binding; }
        if (current.history.stateId === result.value.stateId) {
          documentStore.setState({ savedStateId: result.value.stateId });
          void markRecoverySaved(binding.projectId, result.value.stateId);
        }
      }
    }
    return result;
  })().catch(failure).finally(release);
  return task;
}

export function reloadActiveDirectory(): Promise<Result<{ kind: 'loaded'; project: Project } | { kind: 'recoverable'; candidates: DirectoryCandidate[] }>> {
  return active ? openChosenDirectory(active.handle) : Promise.resolve(fail(problem('directory/no-active', '尚未打开项目目录')));
}

export function openDirectoryFromPicker(): Promise<Result<{ kind: 'loaded'; project: Project } | { kind: 'recoverable'; candidates: DirectoryCandidate[] }>> {
  let chosen: Promise<FileSystemDirectoryHandle>;
  try { chosen = picker(); } catch (error) { return Promise.resolve(failure(error)); }
  return chosen.then(openChosenDirectory).catch(failure);
}

export function openChosenDirectory(handle: FileSystemDirectoryHandle): Promise<Result<{ kind: 'loaded'; project: Project } | { kind: 'recoverable'; candidates: DirectoryCandidate[] }>> {
  return (async () => {
    const origin = getDocument();
    const opened = await loadDirectory(handle);
    if (!opened.ok) return opened;
    if (opened.value.kind === 'recoverable') { pendingRecovery = { handle, pointerFingerprint: opened.value.pointerFingerprint }; return ok({ kind: 'recoverable' as const, candidates: opened.value.candidates }); }
    const installed = await installLoadedProject(opened.value.project, opened.value.blobs, origin);
    if (!installed.ok) return installed;
    active = { handle, generation: opened.value.generation, projectId: opened.value.project.id };
    pendingRecovery = null;
    clearActiveFileHandle();
    return ok({ kind: 'loaded' as const, project: opened.value.project });
  })().catch(failure);
}

export async function recoverDirectoryCandidate(generation: Id): Promise<Result<Project>> {
  const origin = getDocument();
  if (!pendingRecovery) return fail(problem('directory/recovery', '没有待恢复目录'));
  const { handle, pointerFingerprint } = pendingRecovery;
  const opened = await loadDirectoryCandidate(handle, generation);
  if (!opened.ok) return opened;
  if (opened.value.kind !== 'loaded') return fail(problem('directory/recovery', '所选版本无法读取'));
  const activated = await withProjectSaveLock(opened.value.project.id, (signal) => activateDirectoryCandidate(handle, generation, pointerFingerprint, signal)).catch(failure);
  if (!activated.ok) return activated;
  const installed = await installLoadedProject(opened.value.project, opened.value.blobs, origin);
  if (!installed.ok) return installed;
  active = { handle, generation, projectId: opened.value.project.id };
  announceDirectoryGeneration(opened.value.project.id, generation);
  pendingRecovery = null;
  clearActiveFileHandle();
  return ok(opened.value.project);
}
export function cancelDirectoryRecovery(): void { pendingRecovery = null; }
