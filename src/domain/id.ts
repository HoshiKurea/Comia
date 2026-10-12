import type { Id } from './types';

/**
 * 新 ID 永不复用（M01-T02）。
 * 规范环境用 crypto.randomUUID；测试/旧运行时退化为时间戳+计数器+随机，
 * 保持 UUID v4 同样的 36 字符格式，满足 ID 校验模式。
 */
let fallbackCounter = 0;

function pad(len: number, s: string): string {
  return s.padStart(len, '0').slice(-len);
}

export function newId(): Id {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  fallbackCounter = (fallbackCounter + 1) % 0xffff;
  const t = Date.now();
  const r = Math.floor(Math.random() * 0xffffffff);
  return [
    pad(8, (t & 0xffffffff).toString(16)),
    pad(4, (t >>> 16).toString(16)),
    '4' + pad(3, fallbackCounter.toString(16)),
    pad(4, (((r >>> 16) & 0x3fff) | 0x8000).toString(16)),
    pad(12, r.toString(16)),
  ]
    .join('-')
    .toLowerCase();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** 应用保留的安全 ASCII 格式（内建模板等）：字母开头，字母数字-_，≤64 */
const SAFE_ASCII_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export function isUuid(s: unknown): s is Id {
  return typeof s === 'string' && UUID_RE.test(s);
}

/** 导入 ID 限制为 UUID 或应用保留的安全 ASCII 格式（M02-T01） */
export function isSafeId(s: unknown): s is Id {
  return typeof s === 'string' && (UUID_RE.test(s) || SAFE_ASCII_RE.test(s));
}

/** Deterministic migration identity; this digest is not a security hash.
 * Collision resolution remains the caller's responsibility across all ID domains. */
export function migrationId(name: string): Id {
  const bytes = new TextEncoder().encode(name), words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let lane = 0; lane < words.length; lane++) {
    let hash = words[lane];
    for (const byte of bytes) hash = Math.imul(hash ^ (byte + lane * 17), 0x01000193) >>> 0;
    hash ^= hash >>> 16; hash = Math.imul(hash, 0x85ebca6b); hash ^= hash >>> 13;
    words[lane] = (hash ^ (hash >>> 16)) >>> 0;
  }
  const hex = words.map(word => word.toString(16).padStart(8, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20)}`;
}
