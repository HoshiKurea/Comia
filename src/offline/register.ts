import { createStore } from 'zustand/vanilla';
import type { Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { pushNotice } from '../state/sessionStore';

export const offlineStore = createStore<{ waiting: boolean; ready: boolean; restarting: boolean }>(() => ({ waiting: false, ready: false, restarting: false }));
let registration: ServiceWorkerRegistration | null = null, installed = false;
const scriptURL = () => document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src ?? '';
function send(worker: ServiceWorker, type: string): Promise<{ ready?: boolean; version?: string; clientVersion?: string }> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel(), timer = setTimeout(() => { channel.port1.close(); reject(new Error('离线版本未响应，请稍后重试')); }, 10_000);
    channel.port1.onmessage = (event) => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
    worker.postMessage({ type }, [channel.port2]);
  });
}
function identify(): void { navigator.serviceWorker.controller?.postMessage({ type: 'COMIA_PIN', script: scriptURL() }); }
async function reportReady(): Promise<void> {
  const worker = navigator.serviceWorker.controller; if (!worker) return;
  try { const status = await send(worker, 'COMIA_STATUS'); offlineStore.setState({ ready: status.ready === true, waiting: Boolean(registration?.waiting || status.clientVersion && status.clientVersion !== status.version) }); if (status.ready) pushNotice('info', '本机离线入口已就绪'); else pushNotice('error', '离线缓存缺少文件，请在线重新安装；当前编辑仍可使用'); }
  catch { offlineStore.setState({ ready: false }); }
}
export async function registerOfflineShell(): Promise<void> {
  if (installed || !import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  installed = true;
  navigator.serviceWorker.addEventListener('controllerchange', () => { identify(); void reportReady(); });
  navigator.serviceWorker.addEventListener('message', (event) => { if (event.data?.type === 'COMIA_IDENTIFY') identify(); });
  try {
    registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    const waiting = () => offlineStore.setState({ waiting: Boolean(registration?.waiting && navigator.serviceWorker.controller) });
    const watch = (worker: ServiceWorker | null) => worker?.addEventListener('statechange', () => { waiting(); if (worker.state === 'redundant') pushNotice('error', '本次离线安装未完成；在线或本地服务器模式仍可使用'); });
    registration.addEventListener('updatefound', () => watch(registration!.installing)); watch(registration.installing); waiting(); identify();
    if (navigator.serviceWorker.controller) await reportReady();
  } catch { installed = false; pushNotice('error', '本次离线安装未完成；在线或本地服务器模式仍可使用'); }
}

/** Call only after the user finishes saving or explicitly chooses to discard. */
export async function restartWithOfflineUpdate(): Promise<Result<void>> {
  const worker = registration?.waiting ?? (offlineStore.getState().waiting ? navigator.serviceWorker.controller : null); if (!worker) return fail(problem('offline/update-missing', '新版本还未准备好，请稍后重试'));
  try {
    if (!(await send(worker, 'COMIA_STATUS')).ready) return fail(problem('offline/incomplete', '新版本缓存不完整，当前页面保持不变'));
    if (navigator.serviceWorker.controller !== worker) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', changed); reject(new Error('新版本激活超时，当前作品保持不变')); }, 10_000);
      const changed = () => { if (navigator.serviceWorker.controller !== worker) return; clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', changed); resolve(); };
      navigator.serviceWorker.addEventListener('controllerchange', changed); worker.postMessage({ type: 'COMIA_ACTIVATE' });
    });
    const active = navigator.serviceWorker.controller; if (!active || !(await send(active, 'COMIA_USE_LATEST')).ready) throw Error('无法切换版本缓存，当前页面保持不变');
    offlineStore.setState({ restarting: true }); window.location.reload(); return ok(undefined);
  } catch (error) { offlineStore.setState({ restarting: false }); return fail(problem('offline/restart', (error as Error).message)); }
}
