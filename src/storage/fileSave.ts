import type { Id, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { getDocument, documentStore } from '../state/documentStore';
import { replaceDocument } from '../history/commandBus';
import { runtimeStore } from '../state/runtimeStore';
import { decodeProject, encodeProject } from './codec';
import { markRecoverySaved } from './recovery';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { replaceRuntimeResources, retainResources } from './blobRepository';

export interface SaveReceipt { stateId: Id; mode: 'file'; generation: null; completedAt: number; verified: boolean }
let activeFileHandle: FileSystemFileHandle | null = null;
export function clearActiveFileHandle(): void { activeFileHandle = null; }
export function getActiveFileHandle(): FileSystemFileHandle | null { return activeFileHandle; }
export function setActiveFileHandle(handle: FileSystemFileHandle | null): void { activeFileHandle = handle; }

export function triggerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_') || 'Comia';
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function saveFile(signal?: AbortSignal, asCopy = false): Promise<Result<SaveReceipt>> {
  const edit = finishActiveTextEdit(); if (!edit.ok) return edit;
  const snapshot = getDocument(), blobs = new Map(runtimeStore.getState().blobs), release = retainResources(snapshot.project, blobs, new Map());
  try { return await saveSnapshot(snapshot, blobs, signal, asCopy); } finally { release(); }
}
async function saveSnapshot(snapshot: ReturnType<typeof getDocument>, blobs: Map<string, Blob>, signal?: AbortSignal, asCopy = false): Promise<Result<SaveReceipt>> {
  let handle = asCopy ? null : activeFileHandle;
  const picker = (window as Window & { showSaveFilePicker?: (options?: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  // The picker call must run in the synchronous user-gesture call chain, before encoding awaits.
  if (picker && window.isSecureContext && !handle) {
    try {
      handle = await picker({ suggestedName: `${snapshot.project.name}.Comia.json`, types: [{ description: 'Comia 项目', accept: { 'application/json': ['.json'] } }] });
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return fail(problem('storage/cancelled', '已取消保存'));
      return fail(problem('storage/picker', `无法选择保存文件：${(error as Error).message}`));
    }
  }
  const data = await encodeProject(snapshot.project, blobs, signal);
  if (!data.ok) return data;
  if (signal?.aborted) return fail(problem('storage/cancelled', '保存已取消'));
  if (picker && window.isSecureContext) {
    let writable: FileSystemWritableFileStream | null = null;
    try {
      writable = await handle!.createWritable();
      if (signal?.aborted) throw new DOMException('保存已取消', 'AbortError');
      await writable.write(data.value);
      if (signal?.aborted) throw new DOMException('保存已取消', 'AbortError');
      await writable.close();
      if (getDocument().project.id === snapshot.project.id && getDocument().epoch === snapshot.epoch) activeFileHandle = handle;
      if (getDocument().project.id === snapshot.project.id && getDocument().epoch === snapshot.epoch && getDocument().history.stateId === snapshot.history.stateId) {
        documentStore.setState({ savedStateId: snapshot.history.stateId });
        void markRecoverySaved(snapshot.project.id, snapshot.history.stateId);
      }
      return ok({ stateId: snapshot.history.stateId, mode: 'file', generation: null, completedAt: Date.now(), verified: true });
    } catch (error) {
      try { await writable?.abort(); } catch { /* close failure may already have ended the stream */ }
      if ((error as DOMException).name === 'AbortError') return fail(problem('storage/cancelled', '已取消保存'));
      if (activeFileHandle === handle && getDocument().epoch === snapshot.epoch && getDocument().project.id === snapshot.project.id) activeFileHandle = null;
      return fail(problem('storage/write', `写入文件失败：${(error as Error).message}`));
    }
  }
  triggerDownload(data.value, `${snapshot.project.name}.Comia.json`);
  return ok({ stateId: snapshot.history.stateId, mode: 'file', generation: null, completedAt: Date.now(), verified: false });
}

export async function openFile(file: File): Promise<Result<Project>> {
  const origin = getDocument();
  const loaded = await decodeProject(file);
  if (!loaded.ok) return loaded;
  const installed = await installLoadedProject(loaded.value.project, loaded.value.blobs, origin);
  if (installed.ok) activeFileHandle = null;
  return installed;
}

export async function installLoadedProject(project: Project, blobs: Map<string, Blob>, origin = getDocument()): Promise<Result<Project>> {
  const images = new Map<string, ImageBitmap>();
  try {
    for (const meta of Object.values(project.assets)) {
      // Different originals can normalize to identical pixels. Runtime images
      // are owned by display hash; never overwrite and leak a prior decode.
      if (images.has(meta.renderHash)) continue;
      const blob = blobs.get(meta.renderHash);
      if (!blob) { for (const bitmap of images.values()) bitmap.close(); return fail(problem('storage/render-missing', `图片 ${meta.name} 显示数据缺失`)); }
      images.set(meta.renderHash, await createImageBitmap(blob));
    }
  } catch (e) {
    for (const bitmap of images.values()) bitmap.close();
    return fail(problem('storage/image-decode', `项目图片无法解码：${(e as Error).message}`));
  }
  if (getDocument().epoch !== origin.epoch || getDocument().history.stateId !== origin.history.stateId) {
    for (const bitmap of images.values()) bitmap.close();
    return fail(problem('storage/stale', '读取期间作品已改变，请重新打开；当前编辑仍保留'));
  }
  const replaced = replaceDocument(project);
  if (!replaced.ok) { for (const bitmap of images.values()) bitmap.close(); return replaced; }
  replaceRuntimeResources(blobs, images);
  documentStore.setState({ savedStateId: getDocument().history.stateId });
  return ok(project);
}
