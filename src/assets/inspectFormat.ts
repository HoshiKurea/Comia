import type { Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { LIMITS } from '../domain/limits';

export type ImageKind = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/avif' | 'image/svg+xml';
export type AnimationStatus = 'still' | 'animated' | 'unknown';

function fourCC(bytes: Uint8Array, offset: number): string {
  if (offset < 0 || offset + 4 > bytes.length) return '';
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}
function u32be(bytes: Uint8Array, offset: number): number { return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false); }
function u32le(bytes: Uint8Array, offset: number): number { return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true); }
function u16be(bytes: Uint8Array, offset: number): number { return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, false); }
function u16le(bytes: Uint8Array, offset: number): number { return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true); }

export function detectImageFormat(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, i) => bytes[i] === value)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && fourCC(bytes, 0) === 'RIFF' && fourCC(bytes, 8) === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && (fourCC(bytes, 0) === 'GIF8') && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'image/gif';
  if (bytes.length >= 16 && fourCC(bytes, 4) === 'ftyp') {
    const extended = u32be(bytes, 0) === 1;
    const end = extended && bytes.length >= 24 ? Number(new DataView(bytes.buffer, bytes.byteOffset + 8, 8).getBigUint64(0, false)) : u32be(bytes, 0);
    const start = extended ? 16 : 8;
    if (Number.isSafeInteger(end) && end >= start + 8 && end <= bytes.length)
      for (let at = start; at + 4 <= end; at += at === start ? 8 : 4) if (fourCC(bytes, at) === 'avif' || fourCC(bytes, at) === 'avis') return 'image/avif';
  }
  const start = new TextDecoder().decode(bytes.slice(0, 256)).trimStart();
  if (start.startsWith('<svg') || start.startsWith('<?xml')) return 'image/svg+xml';
  return null;
}

/** 按RIFF chunk长度前进，不搜索任意字节串，损坏长度直接拒绝。 */
export function inspectWebpAnimation(bytes: Uint8Array): Result<AnimationStatus> {
  if (bytes.length < 12 || fourCC(bytes, 0) !== 'RIFF' || fourCC(bytes, 8) !== 'WEBP') return fail(problem('image/webp-header', 'WebP容器头无效'));
  const end = u32le(bytes, 4) + 8;
  if (end !== bytes.length) return fail(problem('image/webp-length', 'WebP容器长度无效'));
  let animationFlag = false, animationChunk = false;
  for (let at = 12; at < end;) {
    if (at + 8 > end) return fail(problem('image/webp-chunk', 'WebP块头越界'));
    const name = fourCC(bytes, at), size = u32le(bytes, at + 4);
    const payload = at + 8, next = payload + size + (size & 1);
    if (next > end || next <= at) return fail(problem('image/webp-chunk', 'WebP块长度越界'));
    if (name === 'VP8X') {
      if (size < 10) return fail(problem('image/webp-vp8x', 'WebP VP8X块不完整'));
      animationFlag ||= (bytes[payload] & 0x02) !== 0;
    }
    if (name === 'ANIM' || name === 'ANMF') animationChunk = true;
    at = next;
  }
  return ok(animationFlag || animationChunk ? 'animated' : 'still');
}

/** avis品牌明确为序列；avif+moov需让ImageDecoder检查选定track，避免误当静态。 */
export function inspectAvifAnimation(bytes: Uint8Array): Result<AnimationStatus> {
  if (bytes.length < 16 || fourCC(bytes, 4) !== 'ftyp') return fail(problem('image/avif-header', 'AVIF容器头无效'));
  let at = 0, avis = false, avif = false, hasMoov = false, sawFtyp = false;
  while (at < bytes.length) {
    if (at + 8 > bytes.length) return fail(problem('image/avif-box', 'AVIF box头越界'));
    let size = u32be(bytes, at);
    const name = fourCC(bytes, at + 4);
    let header = 8;
    if (size === 1) {
      if (at + 16 > bytes.length) return fail(problem('image/avif-box', 'AVIF扩展box头越界'));
      const big = new DataView(bytes.buffer, bytes.byteOffset + at + 8, 8).getBigUint64(0, false);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) return fail(problem('image/avif-box', 'AVIF box长度过大'));
      size = Number(big); header = 16;
    } else if (size === 0) size = bytes.length - at;
    if (size < header || at + size > bytes.length) return fail(problem('image/avif-box', 'AVIF box长度越界'));
    if (name === 'ftyp') {
      if (at !== 0 || size < 16) return fail(problem('image/avif-ftyp', 'AVIF ftyp位置或长度无效'));
      sawFtyp = true;
      for (let brandAt = at + header; brandAt + 4 <= at + size; brandAt += brandAt === at + header ? 8 : 4) {
        const brand = fourCC(bytes, brandAt);
        avis ||= brand === 'avis'; avif ||= brand === 'avif';
      }
    }
    if (name === 'moov') hasMoov = true;
    at += size;
  }
  if (!sawFtyp || (!avif && !avis)) return fail(problem('image/avif-brand', 'AVIF品牌无效'));
  return ok(avis ? 'animated' : hasMoov ? 'unknown' : 'still');
}

/** 常见格式在浏览器解码前读出声明尺寸；未知AVIF item尺寸留给解码后的二次检查。 */
export function preflightDimensions(bytes: Uint8Array, kind: ImageKind): Result<{ width: number; height: number } | null> {
  let dimensions: { width: number; height: number } | null = null;
  if (kind === 'image/png') {
    if (bytes.length < 24 || fourCC(bytes, 12) !== 'IHDR') return fail(problem('image/png-header', 'PNG头部缺少IHDR'));
    dimensions = { width: u32be(bytes, 16), height: u32be(bytes, 20) };
  } else if (kind === 'image/gif') {
    if (bytes.length < 10) return fail(problem('image/gif-header', 'GIF头部不完整'));
    dimensions = { width: u16le(bytes, 6), height: u16le(bytes, 8) };
  } else if (kind === 'image/jpeg') {
    let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at] !== 0xff) return fail(problem('image/jpeg-marker', 'JPEG标记无效'));
      while (at < bytes.length && bytes[at] === 0xff) at++;
      const marker = bytes[at++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (at + 2 > bytes.length) return fail(problem('image/jpeg-segment', 'JPEG段头越界'));
      const length = u16be(bytes, at);
      if (length < 2 || at + length > bytes.length) return fail(problem('image/jpeg-segment', 'JPEG段长度越界'));
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 7) return fail(problem('image/jpeg-sof', 'JPEG帧头不完整'));
        dimensions = { width: u16be(bytes, at + 5), height: u16be(bytes, at + 3) };
        break;
      }
      at += length;
    }
  } else if (kind === 'image/avif') {
    const avif = preflightAvifDimensions(bytes);
    if (!avif.ok) return avif;
    dimensions = avif.value;
  } else if (kind === 'image/webp') {
    const end = u32le(bytes, 4) + 8;
    for (let at = 12; at + 8 <= end && at + 8 <= bytes.length;) {
      const name = fourCC(bytes, at), length = u32le(bytes, at + 4), payload = at + 8;
      if (payload + length > bytes.length) break;
      if (name === 'VP8X' && length >= 10) dimensions = { width: bytes[payload + 4] + (bytes[payload + 5] << 8) + (bytes[payload + 6] << 16) + 1, height: bytes[payload + 7] + (bytes[payload + 8] << 8) + (bytes[payload + 9] << 16) + 1 };
      if (name === 'VP8 ' && length >= 10 && bytes[payload + 3] === 0x9d && bytes[payload + 4] === 0x01 && bytes[payload + 5] === 0x2a) dimensions = { width: u16le(bytes, payload + 6) & 0x3fff, height: u16le(bytes, payload + 8) & 0x3fff };
      if (name === 'VP8L' && length >= 5 && bytes[payload] === 0x2f) dimensions = { width: 1 + bytes[payload + 1] + ((bytes[payload + 2] & 0x3f) << 8), height: 1 + (bytes[payload + 2] >> 6) + (bytes[payload + 3] << 2) + ((bytes[payload + 4] & 0x0f) << 10) };
      if (dimensions) break;
      at = payload + length + (length & 1);
    }
  }
  if (dimensions && (dimensions.width < 1 || dimensions.height < 1 || dimensions.width * dimensions.height > LIMITS.maxAssetPixels)) return fail(problem('image/preflight-pixels', '图片声明尺寸无效或超过40MP，未开始解码'));
  return ok(dimensions);
}

/** Inspect item properties and sequence track headers without touching compressed AV1 data. */
function preflightAvifDimensions(bytes: Uint8Array): Result<{ width: number; height: number } | null> {
  let found: { width: number; height: number } | null = null;
  const walk = (start: number, end: number, depth: number): Result<void> => {
    if (depth > 6) return fail(problem('image/avif-depth', 'AVIF box嵌套过深'));
    for (let at = start; at < end;) {
      if (at + 8 > end) return fail(problem('image/avif-box', 'AVIF box头越界'));
      let size = u32be(bytes, at), header = 8;
      const name = fourCC(bytes, at + 4);
      if (size === 1) {
        if (at + 16 > end) return fail(problem('image/avif-box', 'AVIF扩展box头越界'));
        const big = new DataView(bytes.buffer, bytes.byteOffset + at + 8, 8).getBigUint64(0, false);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) return fail(problem('image/avif-box', 'AVIF box长度过大'));
        size = Number(big); header = 16;
      } else if (size === 0) size = end - at;
      if (size < header || at + size > end) return fail(problem('image/avif-box', 'AVIF box长度越界'));
      const payload = at + header;
      let candidate: { width: number; height: number } | null = null;
      if (name === 'ispe') {
        if (payload + 12 > at + size) return fail(problem('image/avif-ispe', 'AVIF尺寸属性不完整'));
        candidate = { width: u32be(bytes, payload + 4), height: u32be(bytes, payload + 8) };
      } else if (name === 'tkhd') {
        if (payload + 4 > at + size) return fail(problem('image/avif-tkhd', 'AVIF轨道头不完整'));
        const offset = bytes[payload] === 1 ? 88 : 76;
        if (payload + offset + 8 > at + size) return fail(problem('image/avif-tkhd', 'AVIF轨道尺寸不完整'));
        candidate = { width: Math.ceil(u32be(bytes, payload + offset) / 65536), height: Math.ceil(u32be(bytes, payload + offset + 4) / 65536) };
      }
      if (candidate) {
        if (candidate.width < 1 || candidate.height < 1 || candidate.width * candidate.height > LIMITS.maxAssetPixels)
          return fail(problem('image/preflight-pixels', 'AVIF声明尺寸无效或超过40MP，未开始解码'));
        found ??= candidate;
      }
      if (name === 'meta' || name === 'iprp' || name === 'ipco' || name === 'moov' || name === 'trak') {
        const childStart = payload + (name === 'meta' ? 4 : 0);
        if (childStart > at + size) return fail(problem('image/avif-box', 'AVIF容器头不完整'));
        const nested = walk(childStart, at + size, depth + 1);
        if (!nested.ok) return nested;
      }
      at += size;
    }
    return ok(undefined);
  };
  const scanned = walk(0, bytes.length, 0);
  return scanned.ok ? ok(found) : scanned;
}
