import GraphemeSplitter from 'grapheme-splitter';
import {runtimeStore} from '../state/runtimeStore';
import type { Rect, TextContent } from '../domain/types';
import type { CaretStop, GlyphCell, TextLayout, TextRun } from './types';
import { actualFont } from './fonts';
import { resolveVerticalGlyph, type VerticalGlyph } from './verticalGlyphs';

export interface Measurer { measureText(text: string): TextMetrics }
interface Grapheme { glyph: string; start: number; end: number }
const splitter = new GraphemeSplitter();

export function graphemes(value: string, offset = 0): Grapheme[] {
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh', { granularity: 'grapheme' }) : null;
  if (segmenter) return Array.from(segmenter.segment(value), (item) => ({ glyph: item.segment, start: offset + item.index, end: offset + item.index + item.segment.length }));
  const out: Grapheme[] = [];
  let position = offset;
  for (const glyph of splitter.splitGraphemes(value)) { out.push({ glyph, start: position, end: position + glyph.length }); position += glyph.length; }
  return out;
}

function emptyLayout(box: Rect, overflow: boolean, text: TextContent): TextLayout {
  const vertical = text.direction === 'vertical';
  const x = vertical ? box.x + box.width - text.font.size / 2 : box.x + (text.align === 'center' ? box.width / 2 : text.align === 'end' ? box.width : 0);
  const y = vertical ? box.y + (text.align === 'center' ? box.height / 2 : text.align === 'end' ? box.height : 0) : box.y;
  return { runs: [], glyphFallbacks: [], overflow, usedBounds: { x: box.x, y: box.y, width: 0, height: 0 }, caretStops: [{ x, y, indexUTF16: 0, runIndex: 0, extent: text.font.size * (vertical ? 1 : text.lineHeight) }] };
}

function widthOf(glyphs: Grapheme[], spacing: number, measure: Measurer): number {
  if (!glyphs.length) return 0;
  if (spacing === 0) return measure.measureText(glyphs.map((part) => part.glyph).join('')).width;
  return glyphs.reduce((sum, part) => sum + measure.measureText(part.glyph).width, 0) + (glyphs.length - 1) * spacing;
}

// Reuse EXACT native prefix widths while typing, never summing kerning approximations.
// A font generation invalidates loaded/fallback metrics. Only 16 last-row entries,
// O(N) strings/widths rather than retaining all O(N²) prefix strings.
const prefixCache=new Map<string,{value:string;widths:number[];ends:number[];measure:Measurer}>();
function prefixWidthAt(parts:Grapheme[],measure:Measurer):(i:number)=>number{
 const c=measure as Measurer&Partial<CanvasRenderingContext2D>;
 const native=typeof c.font==='string'&&!!c.canvas&&typeof document!=='undefined';
 const key=native?JSON.stringify([runtimeStore.getState().fontGeneration,c.font,c.direction,c.fontKerning,c.fontStretch,c.fontVariantCaps,c.textRendering,c.letterSpacing,c.wordSpacing]):null;
 const value=parts.map(p=>p.glyph).join(''),old=key?prefixCache.get(key):undefined,widths:number[]=[],ends:number[]=[];let end=0,common=0;
 if(old)while(common<value.length&&common<old.value.length&&value[common]===old.value[common])common++;
 for(let i=0;i<parts.length;i++){end+=parts[i].glyph.length;ends.push(end);if(old&&end<=common&&old.ends[i]===end&&old.widths[i]!==undefined)widths[i]=old.widths[i];}
 let frozen=measure;
 if(native){frozen=old?.measure??document.createElement('canvas').getContext('2d')!;const ctx=frozen as CanvasRenderingContext2D;ctx.font=c.font!;for(const field of ['direction','fontKerning','fontStretch','fontVariantCaps','textRendering','letterSpacing','wordSpacing'] as const){if(c[field]!==undefined)(ctx as unknown as Record<string,unknown>)[field]=c[field];}if(ctx.canvas.style)ctx.canvas.style.fontSynthesis='weight style';}
 const entry={value,widths,ends,measure:frozen};if(key){prefixCache.delete(key);prefixCache.set(key,entry);while(prefixCache.size>16)prefixCache.delete(prefixCache.keys().next().value!);}
 // Geometry stays exact but long overflowing rows do not measure N full prefixes
 // before painting one full shaped line. Carets/selection measure on first use.
 return i=>i<0?0:(widths[i]??=(entry.measure.measureText(value.slice(0,ends[i])).width));
}
export function layoutHorizontal(text: TextContent, box: Rect, measure: Measurer, options: { wordWrap?: boolean;noWrap?:boolean } = {}): TextLayout {
  if (box.width <= 0 || box.height <= 0) return emptyLayout(box, Boolean(text.content), text);
  if (!text.content) return emptyLayout(box, false, text);
  const size = text.font.size, line = size * text.lineHeight, spacing = text.letterSpacing;
  const ascent = measure.measureText('国').actualBoundingBoxAscent || size * 0.8;
  const runs: TextRun[] = [];
  const caretStops: CaretStop[] = [];
  let offset = 0, overflow = false, rowIndex = 0, widest = 0;
  for (const paragraph of text.content.replace(/\r\n?/g, '\n').split('\n')) {
    const parts = graphemes(paragraph, offset);
    const rows: Grapheme[][] = [];
    if (!parts.length) rows.push([]);
    let current: Grapheme[] = [];
    if(parts.length&&(options.noWrap||widthOf(parts,spacing,measure)<=box.width))current=parts;
    else for (const part of parts) {
      if (current.length && widthOf([...current, part], spacing, measure) > box.width) {
        if (options.wordWrap && /^[ \t]$/.test(part.glyph)) { rows.push([...current, part]); current = []; continue; }
        let split = -1;
        if (options.wordWrap) for (let i = current.length - 1; i >= 0; i--) if (/^[ \t]$/.test(current[i].glyph)) { split = i; break; }
        if (split >= 0) { rows.push(current.slice(0, split + 1)); current = current.slice(split + 1); }
        if (current.length && widthOf([...current, part], spacing, measure) > box.width) { rows.push(current); current = []; }
        current.push(part);
      } else current.push(part);
    }
    if (current.length) rows.push(current);
    for (const row of rows) {
      const value = row.map((part) => part.glyph).join('');
      let first = 0, last = row.length;
      if (options.wordWrap) { while (first < last && /^[ \t]$/.test(row[first].glyph)) first++; while (last > first && /^[ \t]$/.test(row[last - 1].glyph)) last--; }
      const paintRow = row.slice(first, last), paintText = paintRow.map(p => p.glyph).join('');
      const rowWidth = widthOf(paintRow, spacing, measure);
      widest = Math.max(widest, rowWidth);
      if (rowWidth > box.width || (rowIndex + 1) * line > box.height + 1e-9) overflow = true;
      const alignX = text.align === 'start' ? 0 : text.align === 'center' ? (box.width - rowWidth) / 2 : box.width - rowWidth;
      const x = box.x + alignX, y = box.y + rowIndex * line;
      const cells: GlyphCell[] = [];
      const widthAt=spacing===0?prefixWidthAt(paintRow,measure):()=>0;
      let advancing = 0;
      const startUTF16 = row[0]?.start ?? offset, endUTF16 = row.at(-1)?.end ?? offset;
      caretStops.push({ x, y, indexUTF16: startUTF16, runIndex: rowIndex, extent: line });
      for (const [index, part] of row.entries()) {
        let left: number, right: number;
        if (index < first || index >= last) { left = right = index < first ? 0 : rowWidth; }
        else if (spacing === 0) {
          left=right=0;
        } else {
          left = advancing;
          right = left + measure.measureText(part.glyph).width;
          advancing = right + (index < last - 1 ? spacing : 0);
        }
        const measured=spacing===0&&index>=first&&index<last,j=index-first;
        cells.push({ startUTF16: part.start, endUTF16: part.end, glyph: part.glyph, get box(){const l=measured?widthAt(j-1):left,r=measured?widthAt(j):right;return{x:x+l,y,width:r-l,height:line};}, rotation: 0 });
        caretStops.push({ get x(){return x+(measured?widthAt(j):right);}, y, indexUTF16: part.end, runIndex: rowIndex, extent: line });
      }
      runs.push({ text: value, ...(options.wordWrap ? { paintText } : {}), startUTF16, endUTF16, origin: { x, y }, baseline: y + (line - size) / 2 + ascent, rotation: 0, cells });
      rowIndex++;
    }
    offset += paragraph.length + 1;
  }
  return { runs, glyphFallbacks: [], overflow, usedBounds: { x: box.x, y: box.y, width: widest, height: rowIndex * line }, caretStops };
}

export function layoutVertical(text: TextContent, box: Rect,
  resolveGlyph: (glyph: string) => VerticalGlyph = (glyph) => resolveVerticalGlyph(glyph, actualFont(text.font.family))): TextLayout {
  if (box.width <= 0 || box.height <= 0) return emptyLayout(box, Boolean(text.content), text);
  if (!text.content) return emptyLayout(box, false, text);
  const size = text.font.size, columnWidth = size * text.lineHeight;
  const capacity = Math.max(1, Math.floor(box.height / size));
  const columns: Grapheme[][] = [];
  const columnOffsets: number[] = [];
  let offset = 0;
  for (const paragraph of text.content.replace(/\r\n?/g, '\n').split('\n')) {
    const parts = graphemes(paragraph, offset);
    if (!parts.length) { columns.push([]); columnOffsets.push(offset); }
    else for (let index = 0; index < parts.length; index += capacity) { columns.push(parts.slice(index, index + capacity)); columnOffsets.push(parts[index].start); }
    offset += paragraph.length + 1;
  }
  const runs: TextRun[] = [], caretStops: CaretStop[] = [];
  const glyphFallbacks: TextLayout['glyphFallbacks'] = [];
  let overflow = false;
  for (const [column, parts] of columns.entries()) {
    const centerX = box.x + box.width - size / 2 - column * columnWidth;
    const usedHeight = parts.length * size;
    const alignY = text.align === 'start' ? 0 : text.align === 'center' ? (box.height - usedHeight) / 2 : box.height - usedHeight;
    const cells: GlyphCell[] = [];
    const startUTF16 = columnOffsets[column], endUTF16 = parts.at(-1)?.end ?? startUTF16;
    caretStops.push({ x: centerX, y: box.y + alignY, indexUTF16: startUTF16, runIndex: column, extent: size });
    for (const [index, part] of parts.entries()) {
      const { glyph, rotation, fontFamily, fallback } = resolveGlyph(part.glyph);
      if (fallback && !glyphFallbacks.some((item) => item.original === part.glyph && item.reason === fallback)) glyphFallbacks.push({ original: part.glyph, displayed: glyph, reason: fallback });
      const cell = { x: centerX - size / 2, y: box.y + alignY + index * size, width: size, height: size };
      cells.push({ startUTF16: part.start, endUTF16: part.end, glyph, box: cell, rotation, ...(fontFamily ? { fontFamily } : {}) });
      caretStops.push({ x: centerX, y: cell.y + size, indexUTF16: part.end, runIndex: column, extent: size });
      if (cell.y + size > box.y + box.height + 1e-9) overflow = true;
    }
    if (centerX - size / 2 < box.x - 1e-9) overflow = true;
    runs.push({ text: parts.map((part) => part.glyph).join(''), startUTF16, endUTF16, origin: { x: centerX, y: box.y + alignY }, baseline: 0, rotation: 0, cells });
  }
  return { runs, glyphFallbacks, overflow, usedBounds: { x: box.x + box.width - columns.length * columnWidth, y: box.y, width: columns.length * columnWidth, height: Math.min(box.height, capacity * size) }, caretStops };
}

export function layoutText(text: TextContent, box: Rect, measure: Measurer): TextLayout {
  return text.direction === 'vertical' ? layoutVertical(text, box) : layoutHorizontal(text, box, measure,{wordWrap:text.wrapMode==='word'});
}
