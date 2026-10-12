import { describe, expect, it } from 'vitest';
import type { TextContent } from '../../src/domain/types';
import { graphemes, layoutHorizontal, layoutVertical } from '../../src/text/layout';
import { DEFAULT_FONT_FAMILY } from '../../src/domain/factories';
import { resolveVerticalGlyph, VERTICAL_PUNCTUATION } from '../../src/text/verticalGlyphs';

const base: TextContent = { content: '', direction: 'horizontal', font: { family: 'sans-serif', size: 10, color: '#000000FF', bold: false, italic: false }, align: 'start', lineHeight: 1, letterSpacing: 0 };
const measure = { measureText(value: string) { return { width: graphemes(value).length * 10, actualBoundingBoxAscent: 8 } as TextMetrics; } };

describe('shared text layout', () => {
  it('segments an emoji sequence as one grapheme with correct UTF-16 indices', () => {
    const parts = graphemes('👩‍🚀a');
    expect(parts.map((part) => part.glyph)).toEqual(['👩‍🚀', 'a']);
    expect(parts.map((part) => [part.start, part.end])).toEqual([[0, 5], [5, 6]]);
  });

  it('wraps by measured width, preserves empty lines and reports overflow', () => {
    const text = { ...base, content: '你好ABC\n\n尾 ' };
    const result = layoutHorizontal(text, { x: 0, y: 0, width: 20, height: 30 }, measure);
    expect(result.runs.map((run) => run.text)).toEqual(['你好', 'AB', 'C', '', '尾 ']);
    expect(result.overflow).toBe(true);
    expect(result.runs[4].cells.at(-1)?.glyph).toBe(' ');
  });

  it('keeps shaped full-line measurement when spacing is zero and per-glyph spacing otherwise', () => {
    const kerning = { measureText(value: string) { return { width: value === 'AV' ? 15 : value.length * 10, actualBoundingBoxAscent: 8 } as TextMetrics; } };
    const box = { x: 0, y: 0, width: 16, height: 30 };
    expect(layoutHorizontal({ ...base, content: 'AV' }, box, kerning).runs).toHaveLength(1);
    expect(layoutHorizontal({ ...base, content: 'AV', letterSpacing: 1 }, box, kerning).runs).toHaveLength(2);
  });

  it('lays vertical columns right-to-left and maps punctuation', () => {
    const text = { ...base, content: '中文（A\n好', direction: 'vertical' as const };
    const result = layoutVertical(text, { x: 0, y: 0, width: 40, height: 20 });
    expect(result.runs).toHaveLength(3);
    expect(result.runs[0].cells[0].box.x).toBeGreaterThan(result.runs[1].cells[0].box.x);
    expect(result.runs[1].cells[0].glyph).toBe('︵');
    expect(result.runs[1].cells[1].rotation).toBe(Math.PI / 2);
    expect(layoutVertical(text, { x: 0, y: 0, width: 40, height: 0 }).overflow).toBe(true);
  });

  it('uses verified bundled glyphs for every mapped punctuation, keeping surrounding local-family glyphs and UTF16 indices', () => {
    const originals = Object.keys(VERTICAL_PUNCTUATION).join('');
    const text = { ...base, content: originals + 'A👩‍🚀中', direction: 'vertical' as const };
    const result = layoutVertical(text, { x: 0, y: 0, width: 40, height: 300 });
    const cells = result.runs.flatMap((run) => run.cells);
    expect(cells.slice(0, originals.length).map((cell) => cell.glyph)).toEqual(Object.values(VERTICAL_PUNCTUATION));
    expect(cells.slice(0, originals.length).every((cell) => cell.fontFamily === DEFAULT_FONT_FAMILY && cell.rotation === 0)).toBe(true);
    expect(cells.slice(originals.length).map((cell) => [cell.glyph, cell.fontFamily, cell.rotation])).toEqual([['A', undefined, Math.PI / 2], ['👩‍🚀', undefined, 0], ['中', undefined, 0]]);
    expect(cells.at(-2)).toMatchObject({ startUTF16: originals.length + 1, endUTF16: originals.length + 6 });
    expect(result.glyphFallbacks).toHaveLength(originals.length);
    expect(text.font.family).toBe('sans-serif');
  });

  it('rotates the original symbol when a verified fallback lacks that mapped glyph, without changing caret geometry', () => {
    const text = { ...base, content: '（（A', direction: 'vertical' as const };
    const box = { x: 5, y: 7, width: 40, height: 30 };
    const normal = layoutVertical(text, box);
    const missing = layoutVertical(text, box, (glyph) => resolveVerticalGlyph(glyph, 'serif', () => false));
    expect(missing.runs[0].cells.map((cell) => [cell.glyph, cell.rotation])).toEqual([['（', Math.PI / 2], ['（', Math.PI / 2], ['A', Math.PI / 2]]);
    expect(missing.glyphFallbacks).toEqual([{ original: '（', displayed: '（', reason: 'rotated' }]);
    expect(missing.caretStops).toEqual(normal.caretStops);
    expect(missing.runs[0].cells.map((cell) => cell.box)).toEqual(normal.runs[0].cells.map((cell) => cell.box));
  });

  it('does not claim a substitution for the verified application font or produce glyph warnings in horizontal or empty text', () => {
    expect(resolveVerticalGlyph('（', DEFAULT_FONT_FAMILY).fallback).toBeUndefined();
    expect(layoutHorizontal({ ...base, content: '（A' }, { x: 0, y: 0, width: 40, height: 30 }, measure).glyphFallbacks).toEqual([]);
    expect(layoutVertical({ ...base, content: '（' }, { x: 0, y: 0, width: 40, height: 0 }).glyphFallbacks).toEqual([]);
  });
});
