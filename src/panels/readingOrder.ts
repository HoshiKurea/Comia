import type { Id, Rect, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';

export interface ReadingEntry { id: Id; bounds: Rect; paintIndex: number }
/** Rows have a fixed anchor; unlike a tolerant sort comparator this is transitive. */
export function sortPanelReadingOrder(entries: readonly ReadingEntry[], direction: 'rtl' | 'ltr' = 'rtl'): Result<Id[]> {
  if (new Set(entries.map(e => e.id)).size !== entries.length) return fail(problem('panel/reading-ids', '阅读排序不能包含重复分镜'));
  if (entries.some(({ bounds: b }) => ![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width <= 0 || b.height <= 0)) return fail(problem('panel/reading-bounds', '分镜阅读排序需要有效非零范围'));
  const compareId = (a: ReadingEntry, b: ReadingEntry) => a.paintIndex - b.paintIndex || a.id.localeCompare(b.id, 'en');
  const horizontal = (a: ReadingEntry, b: ReadingEntry) => direction === 'rtl'
    ? b.bounds.x + b.bounds.width - a.bounds.x - a.bounds.width : a.bounds.x - b.bounds.x;
  let remaining = [...entries].sort((a, b) => a.bounds.y - b.bounds.y || horizontal(a, b) || compareId(a, b));
  const result: Id[] = [];
  while (remaining.length) {
    const anchor = remaining[0];
    const row = remaining.filter(e => Math.abs(e.bounds.y - anchor.bounds.y) <= .25 * Math.min(e.bounds.height, anchor.bounds.height));
    row.sort((a, b) => horizontal(a, b) || a.bounds.y - b.bounds.y || compareId(a, b));
    result.push(...row.map(e => e.id));
    const taken = new Set(row.map(e => e.id)); remaining = remaining.filter(e => !taken.has(e.id));
  }
  return ok(result);
}
