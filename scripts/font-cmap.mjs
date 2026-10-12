/** Only the bundled OpenType Unicode cmap formats 4/12 are supported; never parses user fonts. */
export function unicodeGlyphIndex(bytes, codePoint) {
  const check = (offset, length, end = bytes.length) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > end) throw new Error('OpenType cmap越界');
  };
  check(0, 12);
  const count = bytes.readUInt16BE(4); check(12, count * 16);
  let cmap;
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16;
    if (bytes.toString('ascii', record, record + 4) === 'cmap') {
      const offset = bytes.readUInt32BE(record + 8), length = bytes.readUInt32BE(record + 12);
      check(offset, length); cmap = bytes.subarray(offset, offset + length); break;
    }
  }
  if (!cmap) throw new Error('OpenType缺少cmap');
  const within = (offset, length, end = cmap.length) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > end) throw new Error('Unicode cmap子表越界');
  };
  within(0, 4);
  const tables = cmap.readUInt16BE(2); within(4, tables * 8);
  const candidates = [];
  for (let i = 0; i < tables; i++) {
    const record = 4 + i * 8, platform = cmap.readUInt16BE(record), encoding = cmap.readUInt16BE(record + 2);
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const offset = cmap.readUInt32BE(record + 4); within(offset, 2);
    const format = cmap.readUInt16BE(offset);
    if (format === 4 || format === 12) candidates.push({ offset, format });
  }
  candidates.sort((a, b) => b.format - a.format);
  const selected = candidates[0]; if (!selected) throw new Error('字体没有受支持的Unicode cmap');
  const { offset, format } = selected;
  if (format === 12) {
    within(offset, 16); const length = cmap.readUInt32BE(offset + 4), groups = cmap.readUInt32BE(offset + 12);
    within(offset, length); const end = offset + length; within(offset + 16, groups * 12, end);
    for (let i = 0; i < groups; i++) {
      const p = offset + 16 + i * 12, first = cmap.readUInt32BE(p), last = cmap.readUInt32BE(p + 4);
      if (first <= codePoint && codePoint <= last) return cmap.readUInt32BE(p + 8) + codePoint - first;
    }
    return 0;
  }
  within(offset, 14); const length = cmap.readUInt16BE(offset + 2), twice = cmap.readUInt16BE(offset + 6);
  if (!twice || twice % 2) throw new Error('无效cmap段数量');
  within(offset, length); const end = offset + length, segments = twice / 2;
  const ends = offset + 14, starts = ends + twice + 2, deltas = starts + twice, ranges = deltas + twice;
  within(ranges, twice, end);
  if (codePoint > 0xffff) return 0;
  for (let i = 0; i < segments; i++) {
    const first = cmap.readUInt16BE(starts + i * 2), last = cmap.readUInt16BE(ends + i * 2);
    if (codePoint > last) continue;
    if (codePoint < first) return 0;
    const delta = cmap.readInt16BE(deltas + i * 2), range = cmap.readUInt16BE(ranges + i * 2);
    if (!range) return (codePoint + delta) & 0xffff;
    const address = ranges + i * 2 + range + (codePoint - first) * 2; within(address, 2, end);
    const glyph = cmap.readUInt16BE(address); return glyph ? (glyph + delta) & 0xffff : 0;
  }
  return 0;
}
