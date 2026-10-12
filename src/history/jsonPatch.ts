/**
 * RFC 6902 JSON Patch 子集（add/replace/remove）+ RFC 6901 指针。
 * 技术修正记录：规格建议的 fast-json-patch 的 compare 对数组多重增删生成的
 * 索引序列在按序应用时不保证自洽（M02-T01 要求 diff 正确排序数组增删），
 * 故 Sol 自实现 diff/apply；数组等长时逐元素 replace，异长时整段 replace，
 * forward=diff(before,after) 与 inverse=diff(after,before) 对称，保证
 * apply(inverse, apply(forward, before)) 深等于 before。
 *
 * 安全：拒绝任何包含 __proto__/constructor/prototype 段的路径；
 * 读取使用 own-property 检查。
 */
import type { JsonValue, Patch } from './types';

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export class PatchError extends Error {
  constructor(
    message: string,
    public readonly path: string,
  ) {
    super(message);
  }
}

/** RFC 6901：~→~0、/→~1 */
export function escapeToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function unescapeToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

export function parsePointer(path: string): string[] {
  if (path === '') return [];
  if (!path.startsWith('/')) throw new PatchError(`指针必须以 / 开头或为空：${path}`, path);
  return path
    .slice(1)
    .split('/')
    .map(unescapeToken)
    .map((t) => {
      if (UNSAFE_KEYS.has(t)) throw new PatchError(`路径包含禁止的键 "${t}"`, path);
      return t;
    });
}

function own(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function deepEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!own(b as Record<string, unknown>, k)) return false;
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

export function jsonDeepEqual(a: JsonValue, b: JsonValue): boolean {
  return deepEqual(a, b);
}

function toArrayIndex(token: string, len: number, path: string): number {
  if (token === '-') return len;
  if (!/^(0|[1-9][0-9]*)$/.test(token)) {
    throw new PatchError(`数组下标非法：${token}`, path);
  }
  const i = parseInt(token, 10);
  if (i > len) throw new PatchError(`数组下标越界：${i}/${len}`, path);
  return i;
}

/** 将 patch 应用到 doc（原地修改）。任何失败抛 PatchError，调用方丢弃 draft。 */
export function applyPatches(doc: JsonValue, patches: Patch[]): void {
  for (const patch of patches) {
    applyOne(doc, patch);
  }
}

function applyOne(doc: JsonValue, patch: Patch): void {
  const tokens = parsePointer(patch.path);
  if (tokens.length === 0) {
    if (patch.op === 'replace') {
      throw new PatchError('不允许整体替换根文档', patch.path);
    }
    throw new PatchError('根路径只支持 replace 语义之外的操作被拒绝', patch.path);
  }
  let parent: JsonValue = doc;
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    if (Array.isArray(parent)) {
      parent = parent[toArrayIndex(t, parent.length, patch.path)];
    } else if (parent !== null && typeof parent === 'object') {
      if (!own(parent as Record<string, unknown>, t)) {
        throw new PatchError(`路径不存在：${patch.path}`, patch.path);
      }
      parent = parent[t];
    } else {
      throw new PatchError(`路径穿过非容器：${patch.path}`, patch.path);
    }
  }
  const last = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    const idx = toArrayIndex(last, parent.length, patch.path);
    switch (patch.op) {
      case 'add':
        parent.splice(idx, 0, patch.value);
        break;
      case 'replace':
        parent[idx] = patch.value;
        break;
      case 'remove':
        if (idx >= parent.length) throw new PatchError(`remove 下标越界 ${idx}`, patch.path);
        parent.splice(idx, 1);
        break;
    }
  } else if (parent !== null && typeof parent === 'object') {
    const obj = parent as Record<string, JsonValue>;
    switch (patch.op) {
      case 'add':
      case 'replace':
        obj[last] = patch.value;
        break;
      case 'remove':
        if (!own(obj, last)) throw new PatchError(`remove 目标不存在：${patch.path}`, patch.path);
        delete obj[last];
        break;
    }
  } else {
    throw new PatchError(`路径父级不是容器：${patch.path}`, patch.path);
  }
}

/** forward=diff(before,after)。数组等长逐元素 replace；异长整段 replace。 */
export function diff(a: JsonValue, b: JsonValue, path = ''): Patch[] {
  if (deepEqual(a, b)) return [];
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length === b.length) {
      const patches: Patch[] = [];
      for (let i = 0; i < a.length; i++) {
        if (!deepEqual(a[i], b[i])) {
          patches.push({ op: 'replace', path: `${path}/${i}`, value: b[i] });
        }
      }
      return patches;
    }
    return [{ op: 'replace', path, value: b }];
  }
  if (
    a !== null && b !== null &&
    typeof a === 'object' && typeof b === 'object' &&
    !Array.isArray(a) && !Array.isArray(b)
  ) {
    const oa = a as Record<string, JsonValue>;
    const ob = b as Record<string, JsonValue>;
    const patches: Patch[] = [];
    for (const k of Object.keys(oa)) {
      if (!own(ob, k)) {
        patches.push({ op: 'remove', path: `${path}/${escapeToken(k)}` });
      } else {
        patches.push(...diff(oa[k], ob[k], `${path}/${escapeToken(k)}`));
      }
    }
    for (const k of Object.keys(ob)) {
      if (!own(oa, k)) {
        patches.push({ op: 'add', path: `${path}/${escapeToken(k)}`, value: ob[k] });
      }
    }
    return patches;
  }
  return [{ op: 'replace', path, value: b }];
}
