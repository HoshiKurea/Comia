import type { Id, LabelColor, Project } from '../domain/types';
import { effectiveLayerFlags } from '../state/effectiveFlags';
export interface LayerRow { id: Id; depth: number; ancestorIds: Id[]; effectiveVisible: boolean; effectiveLocked: boolean; match: boolean; contextOnly: boolean }
export function buildRows(project: Project, pageId: Id, expanded: Id[], filter: { name: string; color: LabelColor }): LayerRow[] {
  const name = filter.name.trim().toLocaleLowerCase(), filtering = Boolean(name || filter.color), open = new Set(expanded), included = new Map<Id, boolean>(), matches = new Map<Id, boolean>();
  const scan = (id: Id): boolean => {
    const layer = project.layers[id]; if (!layer) return false;
    const match = (!name || layer.name.toLocaleLowerCase().includes(name)) && (!filter.color || layer.colorLabel === filter.color);
    matches.set(id, match); let descendant = false;
    if ('children' in layer) for (const child of layer.children) descendant = scan(child) || descendant;
    included.set(id, match || descendant); return match || descendant;
  };
  const roots = project.pages[pageId]?.roots ?? []; roots.forEach(scan);
  const rows: LayerRow[] = [];
  const visit = (id: Id, ancestorIds: Id[]) => {
    const layer = project.layers[id]; if (!layer || (filtering && !included.get(id))) return;
    const flags = effectiveLayerFlags(project, id), match = matches.get(id) ?? false;
    rows.push({ id, depth: ancestorIds.length, ancestorIds, effectiveVisible: flags.visible, effectiveLocked: flags.locked, match, contextOnly: filtering && !match });
    if ('children' in layer && (filtering || open.has(id))) for (const child of [...layer.children].reverse()) visit(child, [...ancestorIds, id]);
  };
  for (const root of [...roots].reverse()) visit(root, []);
  return rows;
}
/** Range uses the complete current expanded/filter list, even when most rows are virtualized. */
export function rangeSelection(rows: LayerRow[], anchor: Id | null, target: Id): Id[] {
  const first = rows.findIndex((row) => row.id === anchor), last = rows.findIndex((row) => row.id === target);
  if (last < 0) return []; if (first < 0) return [target];
  return rows.slice(Math.min(first, last), Math.max(first, last) + 1).map((row) => row.id);
}
