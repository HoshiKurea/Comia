// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { serviceWorkerSource } from '../../scripts/service-worker-source.mjs';

const origin = 'http://localhost', paths = ['/', '/index.html', '/assets/new.js'];
class FakeCache {
  entries = new Map<string, Response>();
  quota = false;
  async put(path: string | Request, response: Response) { this.entries.set(new URL(typeof path === 'string' ? path : path.url, origin).pathname, response.clone()); }
  async match(path: string | Request) { return this.entries.get(new URL(typeof path === 'string' ? path : path.url, origin).pathname)?.clone(); }
  async keys() { return [...this.entries.keys()].map((path) => new Request(`${origin}${path}`)); }
  async delete(path: string | Request) { return this.entries.delete(new URL(typeof path === 'string' ? path : path.url, origin).pathname); }
  async addAll(files: string[]) { if (this.quota) throw new DOMException('full', 'QuotaExceededError'); for (const path of files) await this.put(path, new Response(path)); }
}
async function harness(digests?: Record<string, string>) {
  const cached = new Map<string, FakeCache>(), clients: { id: string; postMessage: ReturnType<typeof vi.fn> }[] = [{ id: 'old-tab', postMessage: vi.fn() }, { id: 'new-tab', postMessage: vi.fn() }];
  const caches = { open: async (name: string) => { if (!cached.has(name)) cached.set(name, new FakeCache()); return cached.get(name)!; }, keys: async () => [...cached.keys()], delete: async (name: string) => cached.delete(name) };
  const listeners: Record<string, (event: any) => void> = {}, self = { location: { origin }, clients: { matchAll: async () => clients, claim: vi.fn(async () => undefined) }, skipWaiting: vi.fn(async () => undefined), addEventListener: (name: string, callback: (event: any) => void) => { listeners[name] = callback; } }, fetch = vi.fn(async () => new Response('network'));
  runInNewContext(serviceWorkerSource('new', paths, digests), { self, caches, Response, URL, crypto: webcrypto, Uint8Array, fetch });
  const event = async (name: string, values: Record<string, unknown> = {}): Promise<Response | null> => { let wait: Promise<unknown> = Promise.resolve(); const output: { response?: Promise<Response> } = {}; listeners[name]({ ...values, waitUntil: (work: Promise<unknown>) => { wait = work; }, respondWith: (work: Promise<Response>) => { output.response = work; } }); await wait; return output.response ? await output.response : null; };
  const message = (type: string, source = clients[0], extra: Record<string, unknown> = {}) => event('message', { data: { type, ...extra }, source, ports: [{ postMessage: vi.fn() }] });
  return { cached, caches, clients, self, fetch, event, message };
}
describe('offline shell lifecycle, integrity and client ownership', () => {
  it('failed quota install removes only its incomplete version and preserves the previous complete shell', async () => {
    const h = await harness(), old = await h.caches.open('comia-shell-old'); await old.put('/index.html', new Response('old')); (await h.caches.open('comia-shell-new')).quota = true;
    await expect(h.event('install')).rejects.toThrow('full'); expect(h.cached.has('comia-shell-new')).toBe(false); expect(await (await old.match('/index.html'))!.text()).toBe('old');
  });
  it('a missing asset served as HTML cannot masquerade as a successful hash-verified install', async () => {
    const h = await harness({ '/assets/new.js': '0'.repeat(64) }); await expect(h.event('install')).rejects.toThrow('integrity'); expect(h.cached.has('comia-shell-new')).toBe(false);
  });
  it('activation retains unidentified clients and a fully prepared waiting update', async () => {
    const h = await harness(), old = await h.caches.open('comia-shell-old'), waiting = await h.caches.open('comia-shell-waiting');
    await old.put('/__comia_shell_lifecycle__', new Response('active')); await waiting.put('/__comia_shell_lifecycle__', new Response('waiting')); await h.event('install'); await h.event('activate');
    expect(h.cached.has('comia-shell-old')).toBe(true); expect(h.cached.has('comia-shell-waiting')).toBe(true); expect(await (await old.match('/__comia_shell_lifecycle__'))!.text()).toBe('retired');
  });
  it('keeps an old lazy chunk and its index until the last pinned old client closes', async () => {
    const h = await harness(), old = await h.caches.open('comia-shell-old'); await old.put('/assets/old.js', new Response('old code')); await old.put('/index.html', new Response('old index')); await old.put('/__comia_shell_lifecycle__', new Response('active'));
    await h.event('install'); await h.event('activate'); await h.message('COMIA_PIN', h.clients[0], { script: '/assets/old.js' }); await h.message('COMIA_PIN', h.clients[1], { script: '/assets/new.js' });
    expect(h.cached.has('comia-shell-old')).toBe(true);
    const chunk = await h.event('fetch', { request: { url: `${origin}/assets/old.js`, method: 'GET', mode: 'cors' }, clientId: 'old-tab' }); expect(await chunk!.text()).toBe('old code');
    const navigation = await h.event('fetch', { request: { url: `${origin}/unknown-route`, method: 'GET', mode: 'navigate' }, clientId: '', replacesClientId: 'old-tab', resultingClientId: 'reloaded-old' }); expect(await navigation!.text()).toBe('old index');
    h.clients.splice(0, 1); await h.message('COMIA_CLEANUP', h.clients[0]); expect(h.cached.has('comia-shell-old')).toBe(false); expect(h.cached.has('comia-shell-new')).toBe(true);
  });
  it('changes only the requesting client navigation to the newest index after explicit activation', async () => {
    const h = await harness(), old = await h.caches.open('comia-shell-old'); await old.put('/index.html', new Response('old index')); await old.put('/assets/old.js', new Response('old code')); await h.event('install');
    await h.message('COMIA_PIN', h.clients[0], { script: '/assets/old.js' }); await h.message('COMIA_PIN', h.clients[1], { script: '/assets/old.js' }); await h.message('COMIA_ACTIVATE'); expect(h.self.skipWaiting).toHaveBeenCalledOnce(); await h.message('COMIA_USE_LATEST', h.clients[0]);
    await h.message('COMIA_PIN', h.clients[0], { script: '/assets/old.js' }); // A late controllerchange handshake cannot undo the user's restart.
    const page = await h.event('fetch', { request: { url: origin, method: 'GET', mode: 'navigate' }, replacesClientId: 'old-tab', resultingClientId: 'latest-tab' }); expect(await page!.text()).toBe('/index.html'); expect(h.cached.has('comia-shell-old')).toBe(true);
  });
  it('refuses activation if one previously cached static file disappears', async () => {
    const h = await harness(); await h.event('install'); await (await h.caches.open('comia-shell-new')).delete('/assets/new.js'); await h.message('COMIA_ACTIVATE'); expect(h.self.skipWaiting).not.toHaveBeenCalled();
  });
  it('refuses to switch a pinned old client if the latest cache is damaged after activation', async () => {
    const h = await harness(), old = await h.caches.open('comia-shell-old'); await old.put('/assets/old.js', new Response('old code')); await old.put('/index.html', new Response('old index')); await h.event('install'); await h.message('COMIA_PIN', h.clients[0], { script: '/assets/old.js' });
    await (await h.caches.open('comia-shell-new')).delete('/assets/new.js'); await h.message('COMIA_USE_LATEST');
    const page = await h.event('fetch', { request: { url: origin, method: 'GET', mode: 'navigate' }, replacesClientId: 'old-tab', resultingClientId: 'safe-old' }); expect(await page!.text()).toBe('old index');
  });
  it('cleanup cannot delete an in-progress installation whose cache has not yet written its lifecycle marker', async () => {
    const h = await harness(); await h.event('install'); await h.event('activate'); await h.caches.open('comia-shell-installing');
    await h.message('COMIA_PIN', h.clients[0], { script: '/assets/new.js' }); await h.message('COMIA_PIN', h.clients[1], { script: '/assets/new.js' }); await h.message('COMIA_CLEANUP'); expect(h.cached.has('comia-shell-installing')).toBe(true);
  });
  it('never intercepts or adds user file, Blob, cross-origin or non-GET requests to caches', async () => {
    const h = await harness(); await h.event('install'); const size = h.cached.get('comia-shell-new')!.entries.size;
    for (const request of [{ url: `${origin}/user-project.Comia.json`, method: 'GET', mode: 'cors' }, { url: 'blob:http://localhost/secret', method: 'GET', mode: 'cors' }, { url: 'https://elsewhere.test/assets/remote.js', method: 'GET', mode: 'cors' }, { url: `${origin}/assets/new.js`, method: 'POST', mode: 'cors' }]) expect(await h.event('fetch', { request })).toBeNull();
    expect(h.cached.get('comia-shell-new')!.entries.size).toBe(size); expect(h.fetch).not.toHaveBeenCalled();
  });
});
