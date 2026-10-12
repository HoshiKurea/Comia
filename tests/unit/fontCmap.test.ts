import { describe, expect, it } from 'vitest';
import { unicodeGlyphIndex } from '../../scripts/font-cmap.mjs';

function font(subtable: Buffer): Buffer {
  const buffer = Buffer.alloc(40 + subtable.length);
  buffer.write('OTTO'); buffer.writeUInt16BE(1, 4); buffer.write('cmap', 12);
  buffer.writeUInt32BE(28, 20); buffer.writeUInt32BE(12 + subtable.length, 24);
  buffer.writeUInt16BE(1, 30); buffer.writeUInt16BE(3, 32);
  buffer.writeUInt16BE(subtable.readUInt16BE(0) === 12 ? 10 : 1, 34); buffer.writeUInt32BE(12, 36);
  subtable.copy(buffer, 40); return buffer;
}
describe('bundled Unicode cmap build guard', () => {
  it('applies format4 relative range offsets and signed delta, leaving a zero glyph missing', () => {
    const table = Buffer.alloc(34); table.writeUInt16BE(4); table.writeUInt16BE(34, 2); table.writeUInt16BE(4, 6);
    table.writeUInt16BE(0xfe35, 14); table.writeUInt16BE(0xffff, 16);
    table.writeUInt16BE(0xfe35, 20); table.writeUInt16BE(0xffff, 22);
    table.writeInt16BE(-1, 24); table.writeInt16BE(1, 26); table.writeUInt16BE(4, 28); table.writeUInt16BE(32, 32);
    expect(unicodeGlyphIndex(font(table), 0xfe35)).toBe(31);
    expect(unicodeGlyphIndex(font(table), 0xfe34)).toBe(0);
    expect(unicodeGlyphIndex(font(table), 0xffff)).toBe(0);
    table.writeUInt16BE(0, 32); expect(unicodeGlyphIndex(font(table), 0xfe35)).toBe(0);
    table.writeUInt16BE(0, 28); table.writeInt16BE(490, 24); expect(unicodeGlyphIndex(font(table), 0xfe35)).toBe(31);
  });
  it('maps a supplementary format12 range, rejecting absent characters', () => {
    const table = Buffer.alloc(28); table.writeUInt16BE(12); table.writeUInt32BE(28, 4); table.writeUInt32BE(1, 12);
    table.writeUInt32BE(0x1f600, 16); table.writeUInt32BE(0x1f603, 20); table.writeUInt32BE(41, 24);
    expect(unicodeGlyphIndex(font(table), 0x1f602)).toBe(43);
    expect(unicodeGlyphIndex(font(table), 0x1f604)).toBe(0);
  });
  it('fails closed on truncated or out-of-bounds tables instead of certifying coverage', () => {
    expect(() => unicodeGlyphIndex(Buffer.alloc(10), 0xfe35)).toThrow('越界');
    const table = Buffer.alloc(28); table.writeUInt16BE(12); table.writeUInt32BE(1000, 4); table.writeUInt32BE(1, 12);
    expect(() => unicodeGlyphIndex(font(table), 0xfe35)).toThrow('越界');
    table.writeUInt32BE(28, 4); table.writeUInt32BE(1000, 12);
    expect(() => unicodeGlyphIndex(font(table), 0xfe35)).toThrow('越界');
  });
});
