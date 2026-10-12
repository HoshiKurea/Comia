import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unicodeGlyphIndex } from './font-cmap.mjs';
const root = new URL('../public/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('fonts/manifest.json', root), 'utf8'));
const vertical = JSON.parse(await readFile(new URL('../src/text/verticalPunctuation.json', import.meta.url), 'utf8'));
const allowed = new Set(['fonts/NotoSansCJKsc-Regular.otf', 'fonts/NotoSansCJKsc-Bold.otf', 'licenses/noto-cjk-OFL.txt']);
if (manifest.release !== 'Sans2.004' || manifest.files.length !== allowed.size) throw new Error('字体资源清单无效');
for (const entry of manifest.files) {
  if (!allowed.delete(entry.path)) throw new Error('字体资源路径重复或越界');
  const bytes = await readFile(new URL(entry.path, root));
  if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`${entry.path} 字体资源哈希/长度不符`);
  if (entry.path.endsWith('.otf') && bytes.subarray(0, 4).toString('ascii') !== 'OTTO') throw new Error('字体资源不是OpenType文件');
  if (entry.path.endsWith('.otf')) for (const glyph of Object.values(vertical)) {
    if (!unicodeGlyphIndex(bytes, glyph.codePointAt(0))) throw new Error(`${entry.path}缺少竖排字形U+${glyph.codePointAt(0).toString(16)}`);
  }
}
console.log(`Verified Noto CJK Sans2.004 Regular/Bold, OFL hashes and ${Object.keys(vertical).length} vertical glyphs in both faces`);
