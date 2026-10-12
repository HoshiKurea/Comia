import { assetReferences } from '../assets/references';
import { migrateProject } from './migrateProject';
import type { Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { LIMITS, LIMIT_ASSET_TOTAL_BYTES } from '../domain/limits';
import { validateProject } from '../domain/validate';
import { detectImageFormat } from '../assets/inspectFormat';

interface EmbeddedBlob { hash: string; mime: string; bytes: number; base64: string }
interface ComiaEnvelope { format: 'Comia'; version: 1; project: Project; blobs: EmbeddedBlob[] }
const HASH = /^[0-9a-f]{64}$/;

function toBase64(bytes: Uint8Array): string {
  const result: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32766) {
    const slice = bytes.subarray(offset, Math.min(bytes.length, offset + 32766));
    let binary = '';
    for (const byte of slice) binary += String.fromCharCode(byte);
    result.push(btoa(binary));
  }
  // Every chunk is divisible by 3 except the last, so joining preserves one base64 stream.
  return result.join('');
}

function fromBase64(base64: string, expectedBytes: number): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) return null;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  if (base64.length / 4 * 3 - padding !== expectedBytes) return null;
  const result = new Uint8Array(expectedBytes);
  let cursor = 0;
  for (let offset = 0; offset < base64.length; offset += 65536) {
    const chunk = base64.slice(offset, offset + 65536);
    const decoded = atob(chunk);
    for (let i = 0; i < decoded.length; i++) result[cursor++] = decoded.charCodeAt(i);
  }
  return cursor === expectedBytes ? result : null;
}

async function sha256(blob: Blob): Promise<string> {
  const data = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function requiredHashes(project: Project): Set<string> {
  const used = new Set<string>();
  for (const id of assetReferences(project)) {
    const meta = project.assets[id];
    if (meta) { used.add(meta.originalHash); used.add(meta.renderHash); }
  }
  return used;
}

export function assetMimeMap(project: Project): Result<Map<string, string>> {
  const mimes = new Map<string, string>();
  for (const id of assetReferences(project)) {
    const asset = project.assets[id];
    if (!asset) continue;
    for (const [hash, mime] of [[asset.originalHash, asset.originalMime], [asset.renderHash, asset.renderMime]]) {
      const previous = mimes.get(hash);
      if (previous && previous !== mime) return fail(problem('storage/mime-conflict', `素材 ${hash} 的类型声明互相冲突`));
      mimes.set(hash, mime);
    }
  }
  return ok(mimes);
}

export function prepareProjectForStorage(project: Project): Result<Project> {
  const checked = validateProject(project);
  if (!checked.ok) return checked;
  const snapshot = structuredClone(checked.value);
  const usedAssets = new Set(assetReferences(snapshot));
  for (const assetId of Object.keys(snapshot.assets)) if (!usedAssets.has(assetId)) delete snapshot.assets[assetId];
  return ok(snapshot);
}

export async function encodeProject(project: Project, blobs: Map<string, Blob>, signal?: AbortSignal): Promise<Result<Blob>> {
  const prepared = prepareProjectForStorage(project);
  if (!prepared.ok) return prepared;
  const snapshot = prepared.value;
  const expectedMimes = assetMimeMap(snapshot);
  if (!expectedMimes.ok) return expectedMimes;
  const embedded: EmbeddedBlob[] = [];
  let total = 0;
  for (const hash of requiredHashes(snapshot)) {
    if (signal?.aborted) return fail(problem('storage/cancelled', '保存已取消'));
    const blob = blobs.get(hash);
    if (!blob) return fail(problem('storage/missing-blob', `素材 ${hash} 缺失，未生成文件`));
    const mime = expectedMimes.value.get(hash)!;
    if (blob.type && blob.type !== mime) return fail(problem('storage/mime', `素材 ${hash} 类型与项目记录不符`));
    total += blob.size;
    if (total > LIMIT_ASSET_TOTAL_BYTES) return fail(problem('storage/too-large', '素材总量超出512MiB'));
    if (await sha256(blob) !== hash) return fail(problem('storage/hash', `素材 ${hash} 校验失败`));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (detectImageFormat(bytes) !== mime) return fail(problem('storage/mime', `素材 ${hash} 内容类型与项目记录不符`));
    embedded.push({ hash, mime, bytes: blob.size, base64: toBase64(bytes) });
  }
  const data: ComiaEnvelope = { format: 'Comia', version: 1, project: snapshot, blobs: embedded };
  const file = new Blob([JSON.stringify(data)], { type: 'application/json' });
  if (file.size > LIMITS.maxProjectBytes) return fail(problem('storage/file-too-large', '项目文件超过256MiB'));
  return ok(file);
}

export async function decodeProject(file: File, signal?: AbortSignal): Promise<Result<{ project: Project; blobs: Map<string, Blob> }>> {
  if (file.size > LIMITS.maxProjectBytes) return fail(problem('storage/file-too-large', '项目文件超过256MiB'));
  let parsed: unknown;
  try { parsed = JSON.parse(await file.text()); }
  catch { return fail(problem('storage/json', '文件不是有效JSON')); }
  if (signal?.aborted) return fail(problem('storage/cancelled', '打开项目已取消'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail(problem('storage/format', '文件格式无效'));
  const env = parsed as Partial<ComiaEnvelope>;
  if (env.format !== 'Comia' || env.version !== 1 || !Array.isArray(env.blobs)) return fail(problem('storage/version', '不支持的Comia文件格式或版本；当前支持版本1'));
  const checked = migrateProject(env.project);
  if (!checked.ok) return checked;
  const expectedMimes = assetMimeMap(checked.value);
  if (!expectedMimes.ok) return expectedMimes;
  const result = new Map<string, Blob>();
  let total = 0;
  for (const item of env.blobs) {
    if (signal?.aborted) return fail(problem('storage/cancelled', '打开项目已取消'));
    if (!item || !HASH.test(item.hash) || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || typeof item.base64 !== 'string' || typeof item.mime !== 'string') return fail(problem('storage/blob-meta', '素材元数据无效'));
    if (item.mime !== expectedMimes.value.get(item.hash)) return fail(problem('storage/mime', `素材 ${item.hash} 类型与项目记录不符`));
    total += item.bytes;
    if (total > LIMIT_ASSET_TOTAL_BYTES) return fail(problem('storage/too-large', '素材总量超出512MiB'));
    const bytes = fromBase64(item.base64, item.bytes);
    if (!bytes) return fail(problem('storage/base64', `素材 ${item.hash} 编码损坏`));
    if (detectImageFormat(bytes) !== item.mime) return fail(problem('storage/mime', `素材 ${item.hash} 内容类型与项目记录不符`));
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: item.mime });
    if (await sha256(blob) !== item.hash) return fail(problem('storage/hash', `素材 ${item.hash} 校验失败`));
    if (result.has(item.hash)) return fail(problem('storage/duplicate-hash', '素材哈希重复'));
    result.set(item.hash, blob);
  }
  for (const hash of requiredHashes(checked.value)) if (!result.has(hash)) return fail(problem('storage/missing-blob', `素材 ${hash} 缺失`));
  return ok({ project: checked.value, blobs: result });
}
