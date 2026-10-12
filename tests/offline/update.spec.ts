import { menuCommand } from '../e2e/menuHelpers';
import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { serviceWorkerSource } from '../../scripts/service-worker-source.mjs';

async function versionServer() {
  const assets = new Map<string, Buffer>();
  async function load(directory: string, prefix = '') { for (const entry of await readdir(directory, { withFileTypes: true })) { if (entry.isDirectory()) await load(join(directory, entry.name), `${prefix}/${entry.name}`); else if (!entry.name.endsWith('.map') && entry.name !== 'sw.js') assets.set(`${prefix}/${entry.name}`, await readFile(join(directory, entry.name))); } }
  await load('dist'); const original = assets.get('/index.html')!.toString(), entry = original.match(/src="([^"]+\.js)"/)![1]; let version = 1, broken = false;
  const build = () => { const files = new Map(assets); files.set('/index.html', Buffer.from(original.replace(entry, `/assets/test-v${version}.js`))); files.set('/', files.get('/index.html')!); files.set(`/assets/test-v${version}.js`, Buffer.concat([assets.get(entry)!, Buffer.from(`\n// test build ${version}\n`)])); return files; };
  const server = createServer((request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname, files = build(); response.setHeader('Cache-Control', 'no-store');
    if (path === '/sw.js') { const hashes = Object.fromEntries([...files].map(([url, bytes]) => [url, createHash('sha256').update(bytes).digest('hex')])); const paths = [...files.keys(), ...(broken ? ['/missing-static-file.js'] : [])]; response.setHeader('Content-Type', 'application/javascript'); response.end(serviceWorkerSource(`test-${version}`, paths, hashes)); return; }
    const data = files.get(path); if (!data) { response.writeHead(404); response.end('missing'); return; }
    response.setHeader('Content-Type', path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.otf') ? 'font/otf' : path.endsWith('.json') ? 'application/json' : 'text/html'); response.end(data);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${address.port}`, upgrade: (fail = false) => { version++; broken = fail; } };
}
async function boot(page: Page, url: string) {
  await page.goto(url); await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 20_000 }).toBe(true);
  await expect(page.getByText('本机离线入口已就绪')).toBeVisible({ timeout: 20_000 });
}
async function update(page: Page) { await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); }); }
const mainScript = (page: Page) => page.locator('script[type=module][src]').getAttribute('src');
let server: Server | null = null;
test.afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server!.close(() => resolve())); server = null; } });
test.setTimeout(90_000);

test('a prepared update leaves native text untouched and cancellation retains the existing version and content', async ({ page }) => {
  const host = await versionServer(); server = host.server; await boot(page, host.url);
  await page.locator('.library-item').filter({ hasText: '文字' }).click(); await page.getByRole('button', { name: '编辑文字', exact: true }).click(); await page.getByLabel('编辑文字内容').fill('未保存的更新草稿😀');
  host.upgrade(); await update(page); await expect(page.getByRole('button', { name: '重启使用新版本', exact: true })).toBeVisible();
  await expect(page.getByLabel('编辑文字内容')).toHaveValue('未保存的更新草稿😀'); expect(await mainScript(page)).toBe('/assets/test-v1.js');
  await page.getByRole('button', { name: '重启使用新版本', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click(); expect(await mainScript(page)).toBe('/assets/test-v1.js');
  await page.getByRole('button', { name: '编辑文字', exact: true }).click(); await expect(page.getByLabel('编辑文字内容')).toHaveValue('未保存的更新草稿😀');
});

test('restart upgrades one tab; an old peer still exports offline and its cache disappears only after it closes', async ({ page, context }) => {
  const host = await versionServer(); server = host.server; await boot(page, host.url); const peer = await context.newPage(); await boot(peer, host.url); await peer.locator('.library-item').filter({ hasText: '矩形分镜' }).click();
  host.upgrade(); await update(page); await expect(page.getByRole('button', { name: '重启使用新版本', exact: true })).toBeVisible(); await page.getByRole('button', { name: '重启使用新版本', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '放弃更改并重启', exact: true }).click(); await expect.poll(() => mainScript(page)).toBe('/assets/test-v2.js');
  expect(await mainScript(peer)).toBe('/assets/test-v1.js'); expect(await page.evaluate(() => caches.keys())).toContain('comia-shell-test-1'); await expect(peer.getByRole('button', { name: '重启使用新版本', exact: true })).toBeVisible();
  await context.setOffline(true); await peer.locator('.library-item').filter({ hasText: '梯形分镜' }).click(); await expect(peer.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(2);
  const download = peer.waitForEvent('download'); await (await menuCommand(peer, 'PNG')).click(); expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await peer.close(); await page.evaluate(async () => { const channel = new MessageChannel(); const done = new Promise((resolve) => { channel.port1.onmessage = resolve; }); navigator.serviceWorker.controller!.postMessage({ type: 'COMIA_CLEANUP' }, [channel.port2]); await done; channel.port1.close(); });
  await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain('comia-shell-test-1');
  const keys = await page.evaluate(async () => { const cache = await caches.open('comia-shell-test-2'); return (await cache.keys()).map((request) => request.url); }); expect(keys.every((url) => !url.includes('blob:') && !url.includes('.Comia.json'))).toBe(true);
});

test('a failed project write during restart preserves the current version and allows cancellation', async ({ page }) => {
  const host = await versionServer(); server = host.server; await boot(page, host.url); await page.locator('.library-item').filter({ hasText: '矩形分镜' }).click(); host.upgrade(); await update(page);
  await expect(page.getByRole('button', { name: '重启使用新版本', exact: true })).toBeVisible(); await page.evaluate(() => Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => ({ createWritable: async () => ({ write: async () => { throw new DOMException('disk full', 'QuotaExceededError'); }, abort: async () => undefined, close: async () => undefined }) }) }));
  await page.getByRole('button', { name: '重启使用新版本', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: '保存后重启', exact: true }).click(); await expect(page.getByText('写入文件失败：disk full')).toBeVisible(); expect(await mainScript(page)).toBe('/assets/test-v1.js'); await expect(page.locator('.layer-row:not([data-layer-type="pageBackground"])')).toHaveCount(1); await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
});

test('an update with a missing static file preserves the installed shell and cannot offer a ready restart', async ({ page }) => {
  const host = await versionServer(); server = host.server; await boot(page, host.url); host.upgrade(true); await update(page);
  await expect(page.getByText('本次离线安装未完成；在线或本地服务器模式仍可使用')).toBeVisible({ timeout: 20_000 }); await expect(page.getByRole('button', { name: '重启使用新版本', exact: true })).toHaveCount(0); expect(await mainScript(page)).toBe('/assets/test-v1.js'); expect(await page.evaluate(() => caches.keys())).toContain('comia-shell-test-1');
});
