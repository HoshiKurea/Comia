import { DEFAULT_FONT_FAMILY } from '../domain/factories';
import punctuation from './verticalPunctuation.json';

export const VERTICAL_PUNCTUATION: Readonly<Record<string, string>> = punctuation;
// Build checks every mapping against both real cmap tables after verifying the font SHA-256.
const bundledGlyphs = new Set(Object.values(punctuation));
export interface VerticalGlyph {
  glyph: string;
  rotation: number;
  fontFamily?: string;
  fallback?: 'bundled' | 'rotated';
}

/** Unknown local font coverage is not reported as missing; choose the verified local face explicitly. */
export function resolveVerticalGlyph(original: string, actualFamily: string,
  containsBundledGlyph: (glyph: string) => boolean = (glyph) => bundledGlyphs.has(glyph)): VerticalGlyph {
  const mapped = VERTICAL_PUNCTUATION[original];
  if (!mapped) return { glyph: original, rotation: /^[\x21-\x7E]$/.test(original) ? Math.PI / 2 : 0 };
  if (!containsBundledGlyph(mapped)) return { glyph: original, rotation: Math.PI / 2, fallback: 'rotated' };
  return { glyph: mapped, rotation: 0, fontFamily: DEFAULT_FONT_FAMILY,
    ...(actualFamily !== DEFAULT_FONT_FAMILY ? { fallback: 'bundled' as const } : {}) };
}

export function mappedVerticalText(content: string): string {
  return [...new Set(Array.from(content, (glyph) => VERTICAL_PUNCTUATION[glyph]).filter(Boolean))].join('');
}

export function verticalFallbackMessage(fallbacks: { original: string; reason: 'bundled' | 'rotated' }[]): string {
  const bundled = fallbacks.filter((item) => item.reason === 'bundled').map((item) => item.original).join('');
  const rotated = fallbacks.filter((item) => item.reason === 'rotated').map((item) => item.original).join('');
  return [bundled ? `竖排标点“${bundled}”使用本地${DEFAULT_FONT_FAMILY}，项目字体保持所选名称` : '',
    rotated ? `竖排标点“${rotated}”缺少映射字形，使用原符号顺时针旋转90°` : ''].filter(Boolean).join('；');
}
