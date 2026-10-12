import type { Id, Point, Rect, TextContent } from '../domain/types';

export interface GlyphCell {
  startUTF16: number;
  endUTF16: number;
  box: Rect;
  rotation: number;
  glyph: string;
  fontFamily?: string;
}

export interface TextRun {
  startUTF16: number;
  endUTF16: number;
  text: string;
  /** Edge whitespace remains in UTF16/cells, but need not be painted after soft wrap. */
  paintText?: string;
  origin: Point;
  baseline: number;
  rotation: number;
  cells: GlyphCell[];
}

export interface TextLayout {
  runs: TextRun[];
  overflow: boolean;
  usedBounds: Rect;
  frameBox?: Rect;
  safeClipBox?: Rect;
  caretStops: CaretStop[];
  glyphFallbacks: { original: string; displayed: string; reason: 'bundled' | 'rotated' }[];
}

export interface CaretStop extends Point { indexUTF16: number; runIndex: number; extent: number }

export interface TextEditSession {
  layerId: Id;
  original: TextContent;
  draft: TextContent;
  selectionStart: number;
  selectionEnd: number;
  composing: boolean;
}

export interface FontResolution {
  requested: string;
  actual: string;
  fallback: boolean;
}
