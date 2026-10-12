import { describe, expect, it } from 'vitest';
import { detectImageFormat, inspectAvifAnimation, inspectWebpAnimation, preflightDimensions } from '../../src/assets/inspectFormat';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function fourCC(bytes: Uint8Array, at: number, value: string): void { for (let i = 0; i < 4; i++) bytes[at + i] = value.charCodeAt(i); }
function webp(animated: boolean): Uint8Array {
  const bytes = new Uint8Array(30);
  fourCC(bytes, 0, 'RIFF'); fourCC(bytes, 8, 'WEBP'); fourCC(bytes, 12, 'VP8X');
  new DataView(bytes.buffer).setUint32(4, 22, true);
  new DataView(bytes.buffer).setUint32(16, 10, true);
  bytes[20] = animated ? 0x02 : 0;
  return bytes;
}
function avif(brand: 'avif' | 'avis', moov = false): Uint8Array {
  const bytes = new Uint8Array(moov ? 32 : 24);
  new DataView(bytes.buffer).setUint32(0, 24, false);
  fourCC(bytes, 4, 'ftyp'); fourCC(bytes, 8, brand); fourCC(bytes, 16, brand); fourCC(bytes, 20, 'mif1');
  if (moov) { new DataView(bytes.buffer).setUint32(24, 8, false); fourCC(bytes, 28, 'moov'); }
  return bytes;
}

describe('container inspection before image decode', () => {
  it('uses complete signatures and not the file extension', () => {
    expect(detectImageFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(detectImageFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBeNull();
    expect(detectImageFormat(webp(false))).toBe('image/webp');
    expect(detectImageFormat(avif('avis'))).toBe('image/avif');
  });

  it('finds WebP animation from a parsed VP8X flag and rejects overflowing chunks', () => {
    expect(inspectWebpAnimation(webp(false))).toEqual({ ok: true, value: 'still' });
    expect(inspectWebpAnimation(webp(true))).toEqual({ ok: true, value: 'animated' });
    const invalid = webp(true);
    new DataView(invalid.buffer).setUint32(16, 100, true);
    expect(inspectWebpAnimation(invalid).ok).toBe(false);
    const hiddenString = webp(false);
    fourCC(hiddenString, 22, 'ANIM');
    expect(inspectWebpAnimation(hiddenString)).toEqual({ ok: true, value: 'still' });
  });

  it('recognizes avis sequence brand and flags ambiguous avif movie tracks', () => {
    expect(inspectAvifAnimation(avif('avif'))).toEqual({ ok: true, value: 'still' });
    expect(inspectAvifAnimation(avif('avis'))).toEqual({ ok: true, value: 'animated' });
    expect(inspectAvifAnimation(avif('avif', true))).toEqual({ ok: true, value: 'unknown' });
    const invalid = avif('avis');
    new DataView(invalid.buffer).setUint32(0, 2 ** 31, false);
    expect(inspectAvifAnimation(invalid).ok).toBe(false);
  });

  it('rejects a declared decompression bomb before asking the browser to decode it', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    fourCC(png, 12, 'IHDR');
    new DataView(png.buffer).setUint32(16, 10000, false);
    new DataView(png.buffer).setUint32(20, 10000, false);
    expect(preflightDimensions(png, 'image/png').ok).toBe(false);
    new DataView(png.buffer).setUint32(16, 100, false);
    new DataView(png.buffer).setUint32(20, 200, false);
    expect(preflightDimensions(png, 'image/png')).toEqual({ ok: true, value: { width: 100, height: 200 } });
  });

  it('reads actual AVIF item dimensions and rejects an oversized ispe before decode', () => {
    const bytes = new Uint8Array(readFileSync(resolve('tests/fixtures/formats/red.avif')));
    expect(preflightDimensions(bytes, 'image/avif')).toEqual({ ok: true, value: { width: 16, height: 16 } });
    const marker = [0x69, 0x73, 0x70, 0x65];
    const at = bytes.findIndex((_, index) => marker.every((part, i) => bytes[index + i] === part));
    expect(at).toBeGreaterThan(0);
    new DataView(bytes.buffer).setUint32(at + 8, 100000, false);
    new DataView(bytes.buffer).setUint32(at + 12, 100000, false);
    expect(preflightDimensions(bytes, 'image/avif').ok).toBe(false);
  });
});
