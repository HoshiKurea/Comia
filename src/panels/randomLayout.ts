import type { PanelTemplateNode, Point, Rect, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { metrics, polyBounds } from '../geometry/polygon';
import { validatePanelGeometry } from '../geometry/simplePolygon';
import { panelNode, rectangle } from './presets';
import { splitPolygon } from './lineCut';
export interface RandomLayoutOptions { count: number; margin: number; gapX: number; gapY: number; style: 'regular' | 'dynamic'; maxAngleDeg: number; seed: number }
export function generateRandomLayout(bounds: Rect, options: RandomLayoutOptions, targetPolygon?: Point[], maxDepth = 16): Result<PanelTemplateNode> {
  const { count, margin, gapX, gapY, maxAngleDeg, seed } = options;
  if (![bounds.x, bounds.y, bounds.width, bounds.height, count, margin, gapX, gapY, maxAngleDeg, seed].every(Number.isFinite) || !Number.isInteger(count) || count < 2 || count > 24 || margin < 0 || gapX < 0 || gapY < 0 || gapX > 256 || gapY > 256 || maxAngleDeg < 0 || maxAngleDeg > 25 || !Number.isInteger(seed) || seed < 0 || seed > 4294967295 || !['regular', 'dynamic'].includes(options.style)) return fail(problem('panel/random-options', '格数2～24，间隙0～256，倾斜0～25°，种子须为32位非负整数'));
  const area = { x: bounds.x + margin, y: bounds.y + margin, width: bounds.width - margin * 2, height: bounds.height - margin * 2 };
  if (area.width < 32 || area.height < 32) return fail(problem('panel/random-small', '页边距后的区域太小，无法分格'));
  const root = panelNode(targetPolygon ?? rectangle(area));
  root.randomSeed = seed;
  const valid = validatePanelGeometry({ geometry: root.geometry, geometryMode: 'convex' }); if (!valid.ok) return fail(problem('panel/random-target', '随机分格需要有效的凸形区域'));
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 16) return fail(problem('panel/random-depth', '分格树深度须为1～16'));
  let leaves = [{ node: root, depth: 1 }], attempts = 0, total = 1, state = seed >>> 0;
  const random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
  while (total < count && leaves.length && attempts < 2048) {
    const weights = leaves.map(l => { const m = metrics(l.node.geometry); return m.ok ? Math.abs(m.value.signedArea) : 0; }), sum = weights.reduce((a, b) => a + b, 0);
    let position = random() * sum, index = 0; while (index < leaves.length - 1 && position >= weights[index]) position -= weights[index++];
    const chosen = leaves[index]; let success = false;
    if (chosen.depth < maxDepth) for (let retry = 0; retry < 32 && attempts < 2048; retry++) {
      attempts++; const box = polyBounds(chosen.node.geometry), vertical = box.width / box.height >= 1.3 ? true : box.width / box.height <= 1 / 1.3 ? false : random() < .5;
      const ratio = .3 + .4 * random(), angle = options.style === 'dynamic' ? (2 * random() - 1) * maxAngleDeg * Math.PI / 180 : 0;
      const normal = vertical ? { x: Math.cos(angle), y: Math.sin(angle) } : { x: -Math.sin(angle), y: Math.cos(angle) };
      const projections = chosen.node.geometry.map(p => p.x * normal.x + p.y * normal.y), coordinate = Math.min(...projections) + ratio * (Math.max(...projections) - Math.min(...projections));
      const a = { x: normal.x * coordinate, y: normal.y * coordinate }, b = { x: a.x + normal.y, y: a.y - normal.x };
      const split = splitPolygon(chosen.node.geometry, 'convex', { a, b, gap: vertical ? gapX : gapY }); if (!split.ok) continue;
      chosen.node.children = split.value.map(p => panelNode(p)); chosen.node.style.borderWidth = 0;
      leaves.splice(index, 1, ...chosen.node.children.map(node => ({ node, depth: chosen.depth + 1 }))); total++; success = true; break;
    }
    if (!success) leaves.splice(index, 1);
  }
  return total === count ? ok(root) : fail(problem('panel/random-capacity', `区域只能容纳${total}格，未应用；请减少格数、边距或间隙`));
}
