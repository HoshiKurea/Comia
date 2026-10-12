import type { Point, Rect } from '../domain/types';
import type { CaretStop, TextLayout } from './types';

/** Distance to a caret segment, not to its corner; unequal measured cells remain unequal. */
export function hitCaret(layout: TextLayout, point: Point, vertical: boolean): number {
  let best = layout.caretStops[0], distance = Infinity;
  for (const stop of layout.caretStops) {
    const dx = vertical ? Math.max(0, Math.abs(point.x - stop.x) - stop.extent / 2) : point.x - stop.x;
    const dy = vertical ? point.y - stop.y : Math.max(0, stop.y - point.y, point.y - stop.y - stop.extent);
    const next = dx * dx + dy * dy;
    if (next < distance) { best = stop; distance = next; }
  }
  return best?.indexUTF16 ?? 0;
}
export function caretAt(layout: TextLayout, indexUTF16: number): CaretStop {
  // Same UTF16 at a soft wrap belongs to the beginning of the next run.
  const exact = layout.caretStops.filter((stop) => stop.indexUTF16 === indexUTF16).at(-1);
  if (exact) return exact;
  return layout.caretStops.reduce((best, stop) => Math.abs(stop.indexUTF16 - indexUTF16) < Math.abs(best.indexUTF16 - indexUTF16) ? stop : best);
}
export function selectionRects(layout: TextLayout, start: number, end: number, vertical = false): Rect[] {
  return layout.runs.flatMap((run, index) => {
    const rects = run.cells.filter((cell) => cell.startUTF16 < end && cell.endUTF16 > start).map((cell) => cell.box);
    const next = layout.runs[index + 1];
    if (next && next.startUTF16 > run.endUTF16 && start <= run.endUTF16 && end > run.endUTF16) {
      const stop = layout.caretStops.filter((item) => item.runIndex === index).at(-1)!;
      rects.push(vertical ? { x: stop.x - stop.extent / 2, y: stop.y, width: stop.extent, height: Math.max(4, stop.extent / 4) } : { x: stop.x, y: stop.y, width: Math.max(4, stop.extent / 4), height: stop.extent });
    }
    return rects;
  });
}
