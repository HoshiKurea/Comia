export function serviceWorkerSource(version, files, digests = {}) {
  return `const CACHE = 'comia-shell-${version}';
const FILES = ${JSON.stringify(files)};
const DIGESTS = ${JSON.stringify(digests)};
const PREFIX = 'comia-shell-', META = 'comia-client-pins-v1';
const MANIFEST = '/__comia_shell_manifest__';
const LIFECYCLE = '/__comia_shell_lifecycle__';
const STATIC = new Set(FILES);
const pinURL = id => '/__comia_client__/' + encodeURIComponent(id);
async function pin(id, name, latest = false) { if (id) await (await caches.open(META)).put(pinURL(id), new Response(JSON.stringify({ cache: name, latest }))); }
async function pinned(id) { if (!id) return null; const response = await (await caches.open(META)).match(pinURL(id)); if (!response) return null; try { return (await response.json()).cache; } catch { return null; } }
async function cleanup() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const meta = await caches.open(META), live = new Set(clients.map(client => client.id)), keep = new Set([CACHE]);
  let unidentified = false;
  for (const client of clients) { const name = await pinned(client.id); if (name) keep.add(name); else unidentified = true; }
  for (const request of await meta.keys()) { const id = decodeURIComponent(new URL(request.url).pathname.split('/').pop()); if (!live.has(id)) await meta.delete(request); }
  // Unknown/legacy clients may still use an old lazy chunk. Never guess that an
  // unacknowledged client has upgraded; its caches live until it closes.
  if (!unidentified) for (const name of await caches.keys()) if (name.startsWith(PREFIX) && !keep.has(name)) {
    const state = await (await caches.open(name)).match(LIFECYCLE);
    if (state && await state.text() === 'retired') await caches.delete(name);
  }
}
async function identify(client, script) {
  if (!client || typeof script !== 'string') return;
  const existing = await (await caches.open(META)).match(pinURL(client.id));
  if (existing && (await existing.json()).latest) return;
  const url = new URL(script, self.location.origin); if (url.origin !== self.location.origin || !url.pathname.startsWith('/assets/')) return;
  const names = await caches.keys(); const ordered = [CACHE, ...names.filter(name => name.startsWith(PREFIX) && name !== CACHE)];
  for (const name of ordered) if (await (await caches.open(name)).match(url.pathname)) { await pin(client.id, name); return; }
}
async function ready() { const cache = await caches.open(CACHE); for (const url of FILES) if (!await cache.match(url)) return false; return true; }
self.addEventListener('install', event => {
  event.waitUntil((async () => { try {
    const cache = await caches.open(CACHE); await cache.put(LIFECYCLE, new Response('waiting')); await cache.addAll(FILES);
    for (const [url, expected] of Object.entries(DIGESTS)) {
      const response = await cache.match(url); if (!response) throw Error('missing shell file');
      const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
      if (actual !== expected) throw Error('shell integrity failed: ' + url);
    }
    await cache.put(MANIFEST, new Response(JSON.stringify(FILES))); await cache.put(LIFECYCLE, new Response('waiting'));
  } catch (error) { await caches.delete(CACHE); throw error; } })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try { for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== CACHE) { const cache = await caches.open(name), state = await cache.match(LIFECYCLE); if (state ? await state.text() === 'active' : await cache.match('/index.html')) await cache.put(LIFECYCLE, new Response('retired')); } await (await caches.open(CACHE)).put(LIFECYCLE, new Response('active')); } catch { /* preserve caches if metadata quota fails */ }
    await self.clients.claim(); for (const client of await self.clients.matchAll({ type: 'window' })) client.postMessage({ type: 'COMIA_IDENTIFY' });
    try { await cleanup(); } catch { /* never delete without a complete ownership scan */ }
  })());
});
let messages = Promise.resolve();
self.addEventListener('message', event => {
  const data = event.data || {}, client = event.source;
  messages = messages.catch(() => {}).then(async () => {
    if (data.type === 'COMIA_PIN') { await identify(client, data.script); await cleanup(); }
    else if (data.type === 'COMIA_STATUS') event.ports[0]?.postMessage({ ready: await ready(), version: CACHE, clientVersion: await pinned(client?.id) });
    else if (data.type === 'COMIA_ACTIVATE' && await ready()) await self.skipWaiting();
    else if (data.type === 'COMIA_USE_LATEST' && client?.id) { if (!await ready()) { event.ports[0]?.postMessage({ ready: false }); return; } await pin(client.id, CACHE, true); event.ports[0]?.postMessage({ ready: true }); await cleanup(); }
    else if (data.type === 'COMIA_CLEANUP') { await cleanup(); event.ports[0]?.postMessage({ ready: true }); }
  }); event.waitUntil(messages);
});
async function staticResponse(path, preferred) {
  const names = await caches.keys(), ordered = [preferred || CACHE, ...names.filter(name => name.startsWith(PREFIX) && name !== (preferred || CACHE))];
  for (const name of ordered) {
    const cache = await caches.open(name), manifest = await cache.match(MANIFEST);
    // Legacy caches are read-only fallbacks for hashed assets, never a new cache
    // destination for arbitrary user data.
    const allowed = manifest ? (await manifest.json()).includes(path) : path.startsWith('/assets/') || STATIC.has(path);
    if (allowed) { const hit = await cache.match(path); if (hit) return hit; }
  }
  return null;
}
self.addEventListener('fetch', event => {
  const request = event.request; if (request.method !== 'GET') return;
  const url = new URL(request.url); if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      // A reload's replaced client can have an empty clientId per the SW spec.
      const old = event.clientId || event.replacesClientId, name = await pinned(old) || CACHE;
      try { await pin(event.resultingClientId, name); } catch { /* offline shell remains usable if pin metadata is full */ }
      return await (await caches.open(name)).match('/index.html') || fetch(request);
    })()); return;
  }
  if (!STATIC.has(url.pathname) && !url.pathname.startsWith('/assets/')) return;
  event.respondWith((async () => await staticResponse(url.pathname, await pinned(event.clientId)) || fetch(request))());
});
`;
}
