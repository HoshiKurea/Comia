import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceWorkerSource } from './service-worker-source.mjs';

const root = new URL('../dist/', import.meta.url);
const rootPath = fileURLToPath(root);
async function files(dir) {
  const output = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await files(path));
    else if (!entry.name.endsWith('.map') && entry.name !== 'sw.js') output.push(path);
  }
  return output;
}
const paths = await files(rootPath);
const hash = createHash('sha256');
const urls = ['/'];
const digests = {};
for (const path of paths.sort()) {
  const url = '/' + relative(rootPath, path).split(sep).join('/');
  urls.push(url);
  const bytes = await readFile(path);
  digests[url] = createHash('sha256').update(bytes).digest('hex');
  hash.update(url); hash.update(bytes);
}
hash.update(await readFile(fileURLToPath(import.meta.url)));
hash.update(await readFile(new URL('./service-worker-source.mjs', import.meta.url)));
const version = hash.digest('hex').slice(0, 16);
digests['/'] = digests['/index.html'];
const worker = serviceWorkerSource(version, urls, digests);
await writeFile(join(rootPath, 'sw.js'), worker, 'utf8');
console.log(`Generated service worker ${version} with ${urls.length} shell URLs`);
