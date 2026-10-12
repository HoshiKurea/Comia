/** Retain unchanged JSON subtrees after validating a private transaction draft.
 * Only the draft is modified; history snapshots and the published document stay immutable.
 */
export function shareUnchanged<T>(before: T, after: T): T {
  if (Object.is(before, after)) return before;
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object') return after;
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after)) return after;
    let same = before.length === after.length;
    for (let index = 0; index < after.length; index++) {
      after[index] = shareUnchanged(before[index], after[index]);
      same &&= Object.is(before[index], after[index]);
    }
    return same ? before : after;
  }
  const old = before as Record<string, unknown>, next = after as Record<string, unknown>;
  const keys = Object.keys(next);
  let same = keys.length === Object.keys(old).length;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(old, key)) { same = false; continue; }
    next[key] = shareUnchanged(old[key], next[key]);
    same &&= Object.is(old[key], next[key]);
  }
  return same ? before : after;
}
