import { migrateProject } from '../../src/storage/migrateProject';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject, toLegacy } from '../helpers/contentProject';
import { activateDirectoryCandidate, loadDirectory, loadDirectoryCandidate, saveDirectory, type DirectorySnapshot } from '../../src/storage/directorySave';

const browserBlob = globalThis.Blob;
const browserFile = globalThis.File;
beforeAll(() => {
  Object.defineProperty(globalThis, 'Blob', { configurable: true, value: NodeBlob });
  Object.defineProperty(globalThis, 'File', { configurable: true, value: NodeFile });
});
afterAll(() => {
  Object.defineProperty(globalThis, 'Blob', { configurable: true, value: browserBlob });
  Object.defineProperty(globalThis, 'File', { configurable: true, value: browserFile });
});

type FailureStage = 'blob' | 'manifest' | 'current' | null;
class MemoryDirectory {
  readonly kind = 'directory';
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Map<string, MemoryDirectory>();
  failure: FailureStage = null;
  afterWrite: ((stage: FailureStage) => void) | null = null;
  aborted = 0;
  nativeCreatePlaceholder = false;
  constructor(readonly name = '') {}
  private root(): MemoryDirectory { return this.name ? this.parent!.root() : this; }
  parent: MemoryDirectory | null = null;
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDirectory> {
    let child = this.dirs.get(name);
    if (!child && options?.create) { child = new MemoryDirectory(name); child.parent = this; this.dirs.set(name, child); }
    if (!child) throw new DOMException('missing', 'NotFoundError');
    return child;
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name) && !options?.create) throw new DOMException('missing', 'NotFoundError');
    if (!this.files.has(name) && options?.create && this.root().nativeCreatePlaceholder) this.files.set(name, new Uint8Array());
    return {
      kind: 'file', name,
      getFile: async () => new File([new Uint8Array(this.files.get(name) ?? new Uint8Array()).buffer as ArrayBuffer], name, { lastModified: 0 }),
      createWritable: async () => {
        let bytes = new Uint8Array();
        return {
          write: async (data: Blob) => {
            bytes = new Uint8Array(await data.arrayBuffer());
            this.root().afterWrite?.(this.name === 'blobs' ? 'blob' : this.name === 'manifests' ? 'manifest' : name === 'current.json' ? 'current' : null);
          },
          close: async () => {
            const stage = this.name === 'blobs' ? 'blob' : this.name === 'manifests' ? 'manifest' : name === 'current.json' ? 'current' : null;
            if (this.root().failure === stage && stage) throw new Error(`simulated ${stage} failure`);
            this.files.set(name, bytes);
          },
          abort: async () => { this.root().aborted++; },
        };
      },
    };
  }
  async *entries(): AsyncIterable<[string, { kind: string }]> {
    for (const name of this.files.keys()) yield [name, { kind: 'file' }];
    for (const name of this.dirs.keys()) yield [name, { kind: 'directory' }];
  }
}

function asHandle(directory: MemoryDirectory): FileSystemDirectoryHandle { return directory as unknown as FileSystemDirectoryHandle; }
function emptySnapshot(name = '作品'): DirectorySnapshot { const project = createProject(); project.name = name; return { project, stateId: crypto.randomUUID(), blobs: new Map() }; }
it('loads and resaves a legacy directory as schema seven while keeping its image bytes and existing generation intact', async () => {
  const dir = new MemoryDirectory(), snapshot = await imageSnapshot(); snapshot.project = toLegacy(snapshot.project, 1);
  const first = await saveDirectory(asHandle(dir), snapshot, null); expect(first.ok).toBe(true); if (!first.ok) return;
  const originalManifest = [...dir.dirs.get('manifests')!.files.values()][0].slice();
  const loaded = await loadDirectory(asHandle(dir)); expect(loaded.ok && loaded.value.kind).toBe('loaded');
  if (!loaded.ok || loaded.value.kind !== 'loaded') throw Error('legacy directory not loaded');
  expect(loaded.value.project.schemaVersion).toBe(9); expect(toLegacy(loaded.value.project, 1)).toEqual(snapshot.project);
  for (const [hash, blob] of snapshot.blobs) expect(new Uint8Array(await loaded.value.blobs.get(hash)!.arrayBuffer())).toEqual(new Uint8Array(await blob.arrayBuffer()));
  expect([...dir.dirs.get('manifests')!.files.values()][0]).toEqual(originalManifest); expect(snapshot.project.schemaVersion).toBe(1);
  const second = await saveDirectory(asHandle(dir), { ...snapshot, project: loaded.value.project }, first.value.generation); expect(second.ok).toBe(true);
  const reopened = await loadDirectory(asHandle(dir)); if (!reopened.ok || reopened.value.kind !== 'loaded') throw Error('resave failed');
  expect(reopened.value.project).toEqual(loaded.value.project);
});
it('native-style immediately created empty pointer permits the first save and missing-pointer recovery without treating prior corrupt pointers as absent', async () => {
  const dir = new MemoryDirectory(); dir.nativeCreatePlaceholder = true;
  const snapshot = emptySnapshot(), first = await saveDirectory(asHandle(dir), snapshot, null);
  expect(first.ok).toBe(true); if (!first.ok) return;
  const loaded = await loadDirectory(asHandle(dir)); expect(loaded.ok && loaded.value.kind).toBe('loaded');
  dir.files.delete('current.json');
  const options = await loadDirectory(asHandle(dir)); expect(options.ok && options.value.kind).toBe('recoverable');
  if (!options.ok || options.value.kind !== 'recoverable') throw Error('Expected actual missing-pointer candidate');
  expect(options.value.pointerFingerprint).toBeNull();
  expect((await activateDirectoryCandidate(asHandle(dir), first.value.generation, null)).ok).toBe(true);
  const recovered = await loadDirectory(asHandle(dir)); expect(recovered.ok && recovered.value.kind).toBe('loaded');
  if (!recovered.ok || recovered.value.kind !== 'loaded') throw Error('Missing pointer was not restored');
  expect(recovered.value.project).toEqual((migrateProject(snapshot.project) as { ok: true; value: typeof snapshot.project }).value);
  dir.files.set('current.json', new Uint8Array());
  const refused = await saveDirectory(asHandle(dir), emptySnapshot('不得覆盖'), null);
  expect(refused.ok).toBe(false); if (refused.ok) throw Error('A pre-existing empty pointer is corruption');
  expect(refused.problems[0].code).toBe('directory/current-corrupt'); expect(dir.files.get('current.json')).toHaveLength(0);
});
it('a newly created pointer placeholder cannot hide a concurrent nonempty pointer before close', async () => {
  const dir = new MemoryDirectory(); dir.nativeCreatePlaceholder = true;
  const concurrent = new TextEncoder().encode(JSON.stringify({ generation: crypto.randomUUID(), manifestHash: '1'.repeat(64) }));
  dir.afterWrite = (stage) => { if (stage === 'current') dir.files.set('current.json', concurrent); };
  const result = await saveDirectory(asHandle(dir), emptySnapshot(), null);
  expect(result.ok).toBe(false); if (result.ok) throw Error('Concurrent pointer must reject this save');
  expect(result.problems[0].code).toBe('directory/conflict'); expect(dir.files.get('current.json')).toEqual(concurrent); expect(dir.aborted).toBe(1);
});
async function imageSnapshot(): Promise<DirectorySnapshot> {
  const snapshot = emptySnapshot('含图作品'), pageId = snapshot.project.pageOrder[0];
  const bytes = readFileSync(resolve('tests/fixtures/formats/red.png'));
  const blob = new Blob([bytes], { type: 'image/png' });
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (b) => b.toString(16).padStart(2, '0')).join('');
  const image = createLayer('image', pageId);
  if (image.type !== 'image') throw new Error('image factory failed');
  image.width = image.height = 16; image.assetId = crypto.randomUUID();
  snapshot.project.layers[image.id] = image; snapshot.project.pages[pageId].roots.push(image.id);
  snapshot.project.assets[image.assetId] = { id: image.assetId, name: 'red.png', originalMime: 'image/png', originalHash: hash, renderHash: hash, renderMime: 'image/png', width: 16, height: 16, originalBytes: blob.size, renderBytes: blob.size, framePolicy: 'still', normalizedOrientation: true };
  snapshot.blobs.set(hash, blob);
  return snapshot;
}

describe('directory generations', () => {
  it('offers complete recovery generations even when the corrupt pointer exceeds the metadata limit', async () => {
    const dir = new MemoryDirectory(), first = await saveDirectory(asHandle(dir), emptySnapshot('可恢复'), null);
    if (!first.ok) throw new Error('initial save');
    dir.files.set('current.json', new Uint8Array(8192));
    const options = await loadDirectory(asHandle(dir));
    expect(options).toMatchObject({ ok: true, value: { kind: 'recoverable' } });
    if (!options.ok || options.value.kind !== 'recoverable') return;
    expect((await activateDirectoryCandidate(asHandle(dir), first.value.generation, options.value.pointerFingerprint)).ok).toBe(true);
    expect(await loadDirectory(asHandle(dir))).toMatchObject({ ok: true, value: { kind: 'loaded', project: { name: '可恢复' } } });
  });
  it('rejects recovery when the directory pointer changes after the recovery choices were shown', async () => {
    const dir = new MemoryDirectory(), first = await saveDirectory(asHandle(dir), emptySnapshot('第一版'), null);
    if (!first.ok) throw new Error('initial save');
    const second = await saveDirectory(asHandle(dir), emptySnapshot('第二版'), first.value.generation);
    if (!second.ok) throw new Error('second save');
    const newPointer = new Uint8Array(dir.files.get('current.json')!);
    dir.files.set('current.json', new TextEncoder().encode('{broken'));
    const options = await loadDirectory(asHandle(dir));
    if (!options.ok || options.value.kind !== 'recoverable') throw new Error('expected recovery');
    dir.files.set('current.json', newPointer);
    const result = await activateDirectoryCandidate(asHandle(dir), first.value.generation, options.value.pointerFingerprint);
    expect(result).toMatchObject({ ok: false, problems: [{ code: 'directory/conflict' }] });
    const loaded = await loadDirectory(asHandle(dir));
    expect(loaded.ok && loaded.value.kind === 'loaded' ? loaded.value.project.name : null).toBe('第二版');
  });

  it('rechecks the directory version after staging current bytes, so a concurrent writer is not overwritten', async () => {
    const dir = new MemoryDirectory(), first = await saveDirectory(asHandle(dir), emptySnapshot('第一版'), null);
    if (!first.ok) throw new Error('initial save');
    const oldPointer = new Uint8Array(dir.files.get('current.json')!);
    const second = await saveDirectory(asHandle(dir), emptySnapshot('其他标签版'), first.value.generation);
    if (!second.ok) throw new Error('second save');
    const concurrent = new Uint8Array(dir.files.get('current.json')!);
    dir.files.set('current.json', oldPointer);
    dir.afterWrite = (stage) => { if (stage === 'current') dir.files.set('current.json', concurrent); };
    const result = await saveDirectory(asHandle(dir), emptySnapshot('过期版'), first.value.generation);
    expect(result).toMatchObject({ ok: false, problems: [{ code: 'directory/conflict' }] });
    expect(dir.aborted).toBe(1); expect(dir.files.get('current.json')).toEqual(concurrent);
  });

  it('reports permission revocation during write and leaves the previous generation readable', async () => {
    const dir = new MemoryDirectory(), first = await saveDirectory(asHandle(dir), emptySnapshot('旧版'), null);
    if (!first.ok) throw new Error('initial save');
    dir.afterWrite = (stage) => { if (stage === 'current') throw new DOMException('permission revoked', 'NotAllowedError'); };
    const result = await saveDirectory(asHandle(dir), emptySnapshot('未提交版'), first.value.generation);
    expect(result).toMatchObject({ ok: false }); expect(dir.aborted).toBe(1);
    const loaded = await loadDirectory(asHandle(dir));
    expect(loaded.ok && loaded.value.kind === 'loaded' ? loaded.value.project.name : null).toBe('旧版');
  });
  it.each(['blob', 'manifest', 'current'] as const)('aborts the open stream if the save lock is lost during %s write, keeping the old pointer', async (stage) => {
    const dir = new MemoryDirectory(), first = await saveDirectory(asHandle(dir), emptySnapshot('旧版'), null);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const oldPointer = new Uint8Array(dir.files.get('current.json')!);
    const controller = new AbortController();
    dir.afterWrite = (writing) => { if (writing === stage) controller.abort(); };
    const changed = stage === 'blob' ? await imageSnapshot() : emptySnapshot('新版');
    expect((await saveDirectory(asHandle(dir), changed, first.value.generation, controller.signal)).ok).toBe(false);
    expect(dir.aborted).toBe(1);
    expect(dir.files.get('current.json')).toEqual(oldPointer);
    const loaded = await loadDirectory(asHandle(dir));
    expect(loaded.ok && loaded.value.kind === 'loaded' ? loaded.value.project.name : null).toBe('旧版');
  });
  it('writes blobs and manifests, verifies readback, and rejects a stale generation', async () => {
    const dir = new MemoryDirectory(), snapshot = await imageSnapshot();
    const first = await saveDirectory(asHandle(dir), snapshot, null);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const opened = await loadDirectory(asHandle(dir));
    expect(opened.ok && opened.value.kind === 'loaded').toBe(true);
    if (!opened.ok || opened.value.kind !== 'loaded') return;
    expect(opened.value.project.name).toBe('含图作品');
    expect(opened.value.blobs.size).toBe(1);
    expect((await saveDirectory(asHandle(dir), emptySnapshot('冲突'), null)).ok).toBe(false);
    const second = await saveDirectory(asHandle(dir), emptySnapshot('新版'), first.value.generation);
    expect(second.ok).toBe(true);
    if (second.ok) {
      const reopened = await loadDirectory(asHandle(dir));
      expect(reopened.ok && reopened.value.kind === 'loaded' ? reopened.value : null).toMatchObject({ kind: 'loaded', generation: second.value.generation, project: { name: '新版' } });
    }
  });

  it.each(['blob', 'manifest', 'current'] as const)('keeps an older complete generation after %s write failure', async (stage) => {
    const dir = new MemoryDirectory(), first = await saveDirectory(asHandle(dir), emptySnapshot('旧版'), null);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    dir.failure = stage;
    const changed = stage === 'blob' ? await imageSnapshot() : emptySnapshot('新版');
    expect((await saveDirectory(asHandle(dir), changed, first.value.generation)).ok).toBe(false);
    dir.failure = null;
    const loaded = await loadDirectory(asHandle(dir));
    expect(loaded.ok && loaded.value.kind === 'loaded').toBe(true);
    if (loaded.ok && loaded.value.kind === 'loaded') expect(loaded.value.project.name).toBe('旧版');
  });

  it('offers valid manifests when current is damaged, and rejects path traversal', async () => {
    const dir = new MemoryDirectory(), first = await saveDirectory(asHandle(dir), emptySnapshot('可恢复'), null);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    dir.files.set('current.json', new TextEncoder().encode('{broken'));
    const opened = await loadDirectory(asHandle(dir));
    expect(opened).toMatchObject({ ok: true, value: { kind: 'recoverable', candidates: [{ generation: first.value.generation }] } });
    const restored = await loadDirectoryCandidate(asHandle(dir), first.value.generation);
    expect(restored).toMatchObject({ ok: true, value: { kind: 'loaded', project: { name: '可恢复' } } });
    const manifestDir = dir.dirs.get('manifests')!;
    const key = `${first.value.generation}.json`;
    const manifest = JSON.parse(new TextDecoder().decode(manifestDir.files.get(key))) as any;
    manifest.blobs = [{ hash: '0'.repeat(64), mime: 'image/png', bytes: 0, path: '../escape.png' }];
    manifestDir.files.set(key, new TextEncoder().encode(JSON.stringify(manifest)));
    expect((await loadDirectoryCandidate(asHandle(dir), first.value.generation)).ok).toBe(false);
  });

  it('does not trust a pointer with a wrong manifest hash or overwrite a colliding blob', async () => {
    const dir = new MemoryDirectory(), snapshot = await imageSnapshot();
    const first = await saveDirectory(asHandle(dir), snapshot, null);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    dir.files.set('current.json', new TextEncoder().encode(JSON.stringify({ generation: first.value.generation, manifestHash: '0'.repeat(64) })));
    const opened = await loadDirectory(asHandle(dir));
    expect(opened).toMatchObject({ ok: true, value: { kind: 'recoverable', candidates: [{ generation: first.value.generation }] } });
    const blobDir = dir.dirs.get('blobs')!;
    const blobName = [...blobDir.files.keys()][0];
    blobDir.files.set(blobName, new Uint8Array([1, 2, 3]));
    expect((await saveDirectory(asHandle(dir), snapshot, first.value.generation)).ok).toBe(false);
  });

  it('rejects a manifest whose blob MIME differs from the project asset declaration', async () => {
    const dir = new MemoryDirectory(), first = await saveDirectory(asHandle(dir), await imageSnapshot(), null);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const manifests = dir.dirs.get('manifests')!, key = `${first.value.generation}.json`;
    const manifest = JSON.parse(new TextDecoder().decode(manifests.files.get(key))) as { blobs: { hash: string; mime: string; path: string }[] };
    manifest.blobs[0].mime = 'image/jpeg';
    manifest.blobs[0].path = `blobs/${manifest.blobs[0].hash}.jpg`;
    manifests.files.set(key, new TextEncoder().encode(JSON.stringify(manifest)));
    const loaded = await loadDirectoryCandidate(asHandle(dir), first.value.generation);
    expect(loaded).toMatchObject({ ok: false, problems: [{ code: 'directory/blob-mime' }] });
  });
});
