import type { BubbleContour, BubbleStyle, BubbleTailLayer, DialogueSpec, HandDrawnStyle, Id, Layer, Point, Project, Result, TextEffects } from './types';
import { fail, ok, problem } from './types';
import { MANGA } from './limits';
import { isUuid } from './id';
import { parseStrokeBand } from './extensionValidation';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const range = (v: unknown, lo: number, hi: number): v is number => finite(v) && v >= lo && v <= hi;
const rgba = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{8}$/i.test(v);
const point = (v: unknown): v is Point => record(v) && finite(v.x) && finite(v.y);
const seed = (v: unknown): v is number => range(v, 0, 0xffffffff) && Number.isInteger(v);

export function parseBubbleStyle(v: unknown, path: string): Result<BubbleStyle> {
  if (!record(v) || !rgba(v.fill) || !rgba(v.borderColor) || !range(v.borderWidth, 0, 256) || !range(v.radius, 0, 4096)) return fail(problem('bubble/style', '填充/边色须为RGBA，边宽0～256、圆角0～4096', path));
  const bands: Pick<BubbleStyle, 'innerStroke' | 'outerStroke'> = {};
  for (const key of ['innerStroke','outerStroke'] as const) if (v[key] !== undefined) { const parsed = parseStrokeBand(v[key], `${path}.${key}`); if (!parsed.ok) return parsed; bands[key] = parsed.value; }
  return ok({ fill: v.fill, borderColor: v.borderColor, borderWidth: v.borderWidth, radius: v.radius, ...bands });
}
export function parseHandDrawn(v: unknown, path: string): Result<HandDrawnStyle | null> {
  if (v === null) return ok(null);
  if (!record(v) || !['soft', 'rough', 'custom'].includes(String(v.preset)) || !seed(v.seed) || !range(v.wobble, 0, .03) || !range(v.irregularity, 0, .12) || !range(v.pressure, 0, .65)) return fail(problem('bubble/hand-drawn', '手绘参数须为合法预设/uint32种子及范围内的抖动、不规则度、笔压', path));
  return ok({ preset: v.preset as HandDrawnStyle['preset'], seed: v.seed, wobble: v.wobble, irregularity: v.irregularity, pressure: v.pressure });
}
export function parseBubbleContour(v: unknown, path: string): Result<BubbleContour | null> {
  if (v === null) return ok(null);
  if (!record(v) || !range(v.tension, 0, .5) || !Array.isArray(v.nodes) || v.nodes.length < MANGA.contourNodes.min || v.nodes.length > MANGA.contourNodes.max || !v.nodes.every(p => point(p) && range(p.x, -.05, 1.05) && range(p.y, -.05, 1.05))) return fail(problem('bubble/contour', '轮廓需要8～32有限节点、归一坐标-0.05～1.05及平滑参数0～0.5', path));
  return ok({ nodes: v.nodes.map(p => ({ x: p.x, y: p.y })), tension: v.tension });
}
export function parseTextEffects(v: unknown, path: string): Result<TextEffects> {
  if (!record(v) || !rgba(v.outlineColor) || !range(v.outlineWidth, 0, 64) || !range(v.shearDeg, -60, 60) || !['none', 'arc', 'wave', 'impact'].includes(String(v.deformation)) || !range(v.amount, -.45, .45) || !range(v.cycles, 1, 3) || !Number.isInteger(v.cycles) || !['layout', 'legacy-sfx-v5'].includes(String(v.recipe))) return fail(problem('text/effects', '声效描边、倾斜或变形参数非法', path));
  if (v.recipe === 'legacy-sfx-v5' && (v.deformation !== 'none' || v.shearDeg !== 0 || v.amount !== 0)) return fail(problem('text/legacy-effects', '旧声效绘制不能同时带新变形，请切换layout', path));
  return ok({ outlineColor: v.outlineColor, outlineWidth: v.outlineWidth, shearDeg: v.shearDeg, deformation: v.deformation as TextEffects['deformation'], amount: v.amount, cycles: v.cycles, recipe: v.recipe as TextEffects['recipe'] });
}
export function parseDialogue(v: unknown, path: string): Result<DialogueSpec> {
  if (!record(v) || !['connector', 'fused', 'overlap'].includes(String(v.mode)) || !range(v.seamRadius, 0, 24) || !range(v.overlapOpacity, 0, 1) || !range(v.fusionPressure, 0, .65) || !seed(v.seed) || !Array.isArray(v.links) || v.links.length > MANGA.maxDialogueMembers - 1) return fail(problem('dialogue/spec', '对白组模式、接缝、透明度、笔压、种子或边数非法', path));
  const style = parseBubbleStyle(v.fusionStyle, `${path}.fusionStyle`); if (!style.ok) return style;
  const links: DialogueSpec['links'] = [];
  for (let i = 0; i < v.links.length; i++) {
    const edge = v.links[i];
    if (!record(edge) || !isUuid(edge.from) || !isUuid(edge.to) || edge.from === edge.to || !range(edge.width, 4, 128) || !range(edge.bend, -1, 1)) return fail(problem('dialogue/link', '连接需要两个不同成员、宽4～128及弯曲-1～1', `${path}.links.${i}`));
    links.push({ from: edge.from, to: edge.to, width: edge.width, bend: edge.bend });
  }
  return ok({ mode: v.mode as DialogueSpec['mode'], seamRadius: v.seamRadius, overlapOpacity: v.overlapOpacity, fusionPressure: v.fusionPressure, seed: v.seed, fusionStyle: style.value, links });
}
/** Common/base fields are validated by parseLayer before this leaf parser. */
export function parseTailFields(v: Record<string, unknown>, path: string): Result<Pick<BubbleTailLayer, 'appearance' | 'attachment' | 'tip' | 'route' | 'beads' | 'zigzag' | 'style' | 'stroke' | 'legacySplice'>> {
  if (!['triangle', 'line', 'curved', 'thought', 'jagged', 'flat'].includes(String(v.appearance)) || !point(v.tip) || !range(v.beads, 3, 9) || !Number.isInteger(v.beads) || !range(v.zigzag, 2, 8) || !Number.isInteger(v.zigzag) || typeof v.legacySplice !== 'boolean' || 'children' in v || !record(v.attachment) || !record(v.route)) return fail(problem('tail/fields', '尾巴形态、点、路由或数量非法，尾巴不能有子层', path));
  let attachment: BubbleTailLayer['attachment'];
  if (v.attachment.mode === 'bubble') {
    if (!range(v.attachment.attachU, 0, 1) || v.attachment.attachU === 1 || !range(v.attachment.baseWidth, 4, 128) || v.style !== null) return fail(problem('tail/attachment', '绑定尾需要弧比例[0,1)、宽4～128且继承主体样式', `${path}.attachment`));
    attachment = { mode: 'bubble', attachU: v.attachment.attachU, baseWidth: v.attachment.baseWidth };
  } else if (v.attachment.mode === 'free') {
    if (!point(v.attachment.baseA) || !point(v.attachment.baseB) || !range(Math.hypot(v.attachment.baseB.x - v.attachment.baseA.x, v.attachment.baseB.y - v.attachment.baseA.y), 4, 128)) return fail(problem('tail/base', '自由尾底座须为间隔4～128的两个有限点', `${path}.attachment`));
    attachment = { mode: 'free', baseA: { ...v.attachment.baseA }, baseB: { ...v.attachment.baseB } };
  } else return fail(problem('tail/attachment', '尾巴归属模式非法', `${path}.attachment`));
  let route: BubbleTailLayer['route'];
  if (v.route.kind === 'straight') route = { kind: 'straight' };
  else if (v.route.kind === 'polyline' && Array.isArray(v.route.knots) && v.route.knots.length <= 6 && v.route.knots.every(point)) route = { kind: 'polyline', knots: v.route.knots.map(p => ({ ...p })) };
  else if (v.route.kind === 'spline' && point(v.route.c1) && point(v.route.c2)) route = { kind: 'spline', c1: { ...v.route.c1 }, c2: { ...v.route.c2 } };
  else return fail(problem('tail/route', '直线/0～6折点/双控制点样条路由非法', `${path}.route`));
  const style = v.style === null ? ok(null) : parseBubbleStyle(v.style, `${path}.style`); if (!style.ok) return style;
  if (attachment.mode === 'free' && !style.value) return fail(problem('tail/style', '自由尾需要自己的样式', `${path}.style`));
  let stroke: BubbleTailLayer['stroke'] = attachment.mode === 'bubble' ? null : { pressure: 0, seed: 42 };
  if(v.stroke !== undefined){
    if(attachment.mode === 'bubble' ? v.stroke !== null : !record(v.stroke) || !range(v.stroke.pressure,0,.65) || !seed(v.stroke.seed))return fail(problem('tail/stroke','自由尾笔压0～0.65/uint32种子，绑定尾须继承主体',`${path}.stroke`));
    if(record(v.stroke))stroke={pressure:v.stroke.pressure as number,seed:v.stroke.seed as number};
  }
  if (v.legacySplice && (attachment.mode !== 'bubble' || route.kind !== 'straight' || !['triangle', 'line'].includes(String(v.appearance)))) return fail(problem('tail/legacy', '旧接缝仅用于绑定的直线三角/线尾', path));
  return ok({ appearance: v.appearance as BubbleTailLayer['appearance'], attachment, tip: { ...v.tip }, route, beads: v.beads, zigzag: v.zigzag, style: style.value, stroke, legacySplice: v.legacySplice });
}

export function validateDialogueGroup(project: Pick<Project, 'layers'>, id: Id): Result<void> {
  const group = project.layers[id]; if (group?.type !== 'group' || !group.dialogue) return fail(problem('dialogue/target', '目标不是对白组', `layers.${id}`));
  const children = group.children, spec = group.dialogue;
  if (children.length < 2 || children.length > MANGA.maxDialogueMembers || new Set(children).size !== children.length || children.some(cid => project.layers[cid]?.type !== 'bubble' || project.layers[cid].parentId !== id || project.layers[cid].pageId !== group.pageId)) return fail(problem('dialogue/members', '对白组需要同页的2～16个独立气泡直接成员', `layers.${id}.children`));
  const parents = new Map(children.map(cid => [cid, cid]));
  const root = (node: Id): Id => { let p = node; while (parents.get(p) !== p) p = parents.get(p)!; return p; };
  for (const link of spec.links) {
    if (!parents.has(link.from) || !parents.has(link.to)) return fail(problem('dialogue/reference', '连接引用不属于当前组的成员', `layers.${id}.dialogue.links`));
    const a = root(link.from), b = root(link.to); if (a === b) return fail(problem('dialogue/cycle', '连接不能重复或形成环', `layers.${id}.dialogue.links`)); parents.set(a, b);
  }
  if (spec.mode !== 'overlap' && spec.links.length !== children.length - 1) return fail(problem('dialogue/disconnected', '连接/融合对白需要连接全部成员的树', `layers.${id}.dialogue.links`));
  return ok(undefined);
}
export function boundTailOwnerProblem(layers: Record<Id, Layer>, tail: BubbleTailLayer): Result<void> {
  const owner = tail.parentId ? layers[tail.parentId] : undefined;
  if (tail.attachment.mode === 'bubble') {
    if (owner?.type !== 'bubble' || tail.matrix.some((v, i) => Math.abs(v - [1, 0, 0, 1, 0, 0][i]) > 1e-9)) return fail(problem('tail/owner', '绑定尾必须是气泡子层并使用单位矩阵', `layers.${tail.id}`));
  } else if (owner && (owner.type !== 'group' || !!owner.dialogue)) return fail(problem('tail/owner', '自由尾只能位于页面或普通编组', `layers.${tail.id}`));
  return ok(undefined);
}
