import type { Id, Project } from '../domain/types';
import type { ImageResources } from '../render/drawScene';
import { compileScene } from '../render/compileScene';
import { drawPlan } from '../render/drawPlan';
import { onBusEvent } from '../history/commandBus';
import { awaitFonts } from '../text/fonts';
import { retainResources } from '../storage/blobRepository';
import { getDocument } from '../state/documentStore';

export interface ThumbnailJob { pageId: Id; stateId: Id; widthCSS: number; requestId: number }
type Pending = { job: ThumbnailJob; project: Project; images: ImageResources; release: () => void; controller: AbortController };
type Thumbnail = { stateId: Id; url: string };
export interface ThumbnailState { status: 'idle' | 'pending' | 'ready' | 'error'; url: string | null; message: string }

const latest = new Map<Id, number>();
const pending = new Map<Id, Pending>();
const timers = new Map<Id, ReturnType<typeof setTimeout>>();
const timerOwners = new Map<Id, () => void>();
const cache = new Map<Id, Thumbnail>();
const dirty = new Set<Id>();
const listeners = new Map<Id, Set<(url: string | null) => void>>();
const states = new Map<Id, ThumbnailState>();
const stateListeners = new Map<Id, Set<(state: ThumbnailState) => void>>();
let running = false;
let activeTask: Pending | null = null;

onBusEvent((event) => {
  if (event.type === 'documentChanged') {
    for (const id of latest.keys()) if (!getDocument().project.pages[id]) invalidatePage(id);
    if (getDocument().project.pages[event.pageId]) { cancelWork(event.pageId); dirty.add(event.pageId); }
  }
  else if (event.type === 'documentReplaced') for (const id of new Set([...latest.keys(), ...cache.keys(), ...pending.keys(), ...timers.keys()])) invalidatePage(id);
});

function touch(pageId: Id): Thumbnail | undefined { const value = cache.get(pageId); if (value) { cache.delete(pageId); cache.set(pageId, value); } return value; }
export function hasCurrentThumbnail(pageId: Id): boolean { return !!touch(pageId) && !dirty.has(pageId); }

function publish(pageId: Id, url: string | null): void {
  for (const listener of listeners.get(pageId) ?? []) listener(url);
}
function publishState(pageId: Id, state: ThumbnailState): void {
  states.set(pageId, state); for (const listener of stateListeners.get(pageId) ?? []) listener(state);
}

function put(pageId: Id, stateId: Id, url: string): void {
  const old = cache.get(pageId);
  if (old) URL.revokeObjectURL(old.url);
  cache.delete(pageId);
  cache.set(pageId, { stateId, url });
  dirty.delete(pageId);
  while (cache.size > 50) {
    const oldest = cache.keys().next().value as Id;
    URL.revokeObjectURL(cache.get(oldest)!.url);
    cache.delete(oldest);
    publish(oldest, null);
    publishState(oldest, { status: 'idle', url: null, message: '' });
  }
  publish(pageId, url);
  publishState(pageId, { status: 'ready', url, message: '' });
}

async function render(task: Pending): Promise<string> {
  const { job, project, images, controller } = task, signal = controller.signal;
  const page = project.pages[job.pageId];
  if (!page) throw new Error('页面已删除');
  const fonts = await awaitFonts(project, signal, [job.pageId]);
  if (!fonts.ok) throw new Error(fonts.problems[0].message);
  if (signal.aborted) throw new DOMException('缩略图已取消', 'AbortError');
  const scale = Math.min(job.widthCSS / page.width, 320 / page.height);
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const canvas = document.createElement('canvas');
  try {
    canvas.width = Math.max(1, Math.ceil(page.width * scale * dpr));
    canvas.height = Math.max(1, Math.ceil(page.height * scale * dpr));
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('缩略图画布不可用');
    const plan = compileScene(project, job.pageId, fonts.value);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0); drawPlan(ctx, plan, images);
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      let finished = false;
      const finish = (callback: () => void) => { if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort); callback(); };
      const abort = () => finish(() => reject(new DOMException('缩略图已取消', 'AbortError')));
      const timer = setTimeout(() => finish(() => reject(new Error('缩略图编码超时，请重试'))), 10_000);
      signal.addEventListener('abort', abort, { once: true });
      try { canvas.toBlob((blob) => finish(() => resolve(blob)), 'image/png'); } catch (error) { finish(() => reject(error)); }
      if (signal.aborted) abort();
    });
    if (!blob) throw new Error('缩略图编码失败');
    if (signal.aborted) throw new DOMException('缩略图已取消', 'AbortError');
    return URL.createObjectURL(blob);
  } finally { canvas.width = 0; canvas.height = 0; }
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (pending.size) {
      const [pageId, task] = pending.entries().next().value as [Id, Pending];
      pending.delete(pageId);
      activeTask = task;
      try {
        const url = await render(task);
        if (!task.controller.signal.aborted && latest.get(pageId) === task.job.requestId) put(pageId, task.job.stateId, url);
        else URL.revokeObjectURL(url);
      } catch (error) {
        if (latest.get(pageId) === task.job.requestId && !task.controller.signal.aborted) {
          dirty.add(pageId); publish(pageId, null); publishState(pageId, { status: 'error', url: null, message: error instanceof Error ? error.message : '缩略图生成失败，请重试' });
        }
      } finally { activeTask = null; task.release(); }
    }
  } finally { running = false; }
}
export function subscribeThumbnailState(pageId: Id, callback: (state: ThumbnailState) => void): () => void {
  const set = stateListeners.get(pageId) ?? new Set(); set.add(callback); stateListeners.set(pageId, set);
  touch(pageId); callback(states.get(pageId) ?? { status: 'idle', url: cache.get(pageId)?.url ?? null, message: '' });
  return () => { set.delete(callback); if (!set.size) stateListeners.delete(pageId); };
}

export function subscribeThumbnail(pageId: Id, callback: (url: string | null) => void): () => void {
  const set = listeners.get(pageId) ?? new Set();
  set.add(callback);
  listeners.set(pageId, set);
  callback(cache.get(pageId)?.url ?? null);
  return () => {
    set.delete(callback);
    if (!set.size) listeners.delete(pageId);
  };
}

/** 只调度受影响页；多次提交在300ms内合并，过期异步结果不可覆盖新状态。 */
export function scheduleThumbnail(pageId: Id, stateId: Id, project: Project, images: ImageResources, widthCSS = 160): ThumbnailJob {
  cancelWork(pageId);
  const requestId = (latest.get(pageId) ?? 0) + 1;
  latest.set(pageId, requestId);
  const job = { pageId, stateId, widthCSS, requestId };
  dirty.add(pageId); publishState(pageId, { status: 'pending', url: cache.get(pageId)?.url ?? null, message: '' });
  const release = retainResources(project, new Map(), images); timerOwners.set(pageId, release);
  timers.set(pageId, setTimeout(() => {
    timers.delete(pageId);
    timerOwners.delete(pageId); pending.get(pageId)?.release();
    pending.set(pageId, { job, project: structuredClone(project), images: new Map(images), release, controller: new AbortController() });
    void pump();
  }, 300));
  return job;
}
function cancelWork(pageId: Id): void {
  latest.set(pageId, (latest.get(pageId) ?? 0) + 1);
  const timer = timers.get(pageId);
  if (timer) clearTimeout(timer);
  timers.delete(pageId);
  timerOwners.get(pageId)?.(); timerOwners.delete(pageId); pending.get(pageId)?.release();
  pending.delete(pageId);
  if (activeTask?.job.pageId === pageId) activeTask.controller.abort();
}
export function invalidatePage(pageId: Id): void {
  cancelWork(pageId);
  const old = cache.get(pageId);
  if (old) URL.revokeObjectURL(old.url);
  cache.delete(pageId);
  dirty.delete(pageId);
  publish(pageId, null);
  publishState(pageId, { status: 'idle', url: null, message: '' });
}
