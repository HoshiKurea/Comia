/**
 * M01-T02：模型校验。不得通过 TS `as Project` 跳过运行时验证。
 * 顺序：先限制 JSON 长度和嵌套深度，再结构解析，最后 DFS 检查不变量、
 * 引用、正尺寸、矩阵可逆、凸性与枚举。
 */
import type {
  AssetMeta,
  BubbleLayer,
  DecorationSpec,
  GroupLayer,
  Id,
  ImageLayer,
  Layer,
  Page,
  PanelLayer,
  Point,
  Project,
  Problem,
  RGBA,
  Result,
  TextContent,
  TextLayer,
  UserTemplate,
  PanelTemplateNode,
} from './types';
import { fail, ok, problem } from './types';
import { parsePresentation, parseAppearancePreset } from '../appearance/model';
import { validateAssetLibrary, libraryNameKey } from '../assets/folderModel';
import { PRESET_LIMITS, validateComponentPreset } from '../library/presetModel';
import { SPEED_BRUSH, validBrushOptions } from '../library/speedBrushGeometry';
import { buildBubble } from '../bubbles/geometry';
import {
  DPI,
  LIMITS,
  LIMIT_ASSET_TOTAL_BYTES,
  LIMIT_LAYER_NAME_CODEPOINTS,
  LIMIT_PAGE_NAME_CODEPOINTS,
  LIMIT_TEXT_CODEPOINTS,
  MATRIX_SCALE,
  MATRIX_TRANSLATE_MAX,
  PANEL_STYLE,
  PAGE_AXIS,
  DECORATION,
} from './limits';
import { isSafeId, isUuid } from './id';
import { validateMaskGeometry } from '../images/maskGeometry';
import { determinant } from '../geometry/matrix';
import { parseBubbleEdge, parseBubbleFrame, parseSourceRect, parseStrokeBand } from './extensionValidation';
import { validateBackgroundValues, validateBackgroundBudget } from '../pages/backgroundGeometry';
import { validatePanelGeometry, polygonContained } from '../geometry/simplePolygon';
import { parseBubbleContour, parseDialogue, parseHandDrawn, parseTailFields, parseTextEffects, boundTailOwnerProblem, validateDialogueGroup } from './mangaValidation';
import { mangaLayerCounts, isBoundTail } from './mangaCounts';
import { MANGA } from './limits';
import { buildTailAppearance } from '../bubbles/tailGeometry';
import { prepareDialogue } from '../bubbles/dialogueGeometry';
import { parseDrawingSource } from '../freehand/model';

const MAX_JSON_DEPTH = 64;
const RGBA_RE = /^#[0-9a-fA-F]{8}$/;

// ---------- 基础检查 ----------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasProtoKey(v: unknown, path: string, problems: Problem[]): boolean {
  // 检测任意层级的 __proto__/constructor/prototype 键
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (hasProtoKey(v[i], `${path}[${i}]`, problems)) return true;
    }
    return false;
  }
  if (isRecord(v)) {
    for (const k of Object.keys(v)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
        problems.push(problem('json/unsafe-key', `禁止的属性名 "${k}"`, path));
        return true;
      }
      if (hasProtoKey(v[k], `${path}.${k}`, problems)) return true;
    }
  }
  return false;
}

function measureDepth(v: unknown, depth = 0): number {
  if (depth > MAX_JSON_DEPTH) return depth;
  if (Array.isArray(v)) {
    let max = depth;
    for (const item of v) max = Math.max(max, measureDepth(item, depth + 1));
    return max;
  }
  if (isRecord(v)) {
    let max = depth;
    for (const k of Object.keys(v)) max = Math.max(max, measureDepth(v[k], depth + 1));
    return max;
  }
  return depth;
}

function finNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function intNum(v: unknown): v is number {
  return finNum(v) && Number.isInteger(v);
}

function validRandomSeed(v: unknown): v is number { return intNum(v) && v >= 0 && v <= 4294967295; }

function str(v: unknown): v is string {
  return typeof v === 'string';
}

function bool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function codepoints(s: string): number {
  return [...s].length;
}

function validName(s: unknown, max: number): boolean {
  return str(s) && codepoints(s.trim()) >= 1 && codepoints(s) <= max;
}

function validRGBA(v: unknown): v is RGBA {
  return str(v) && RGBA_RE.test(v);
}

function validMat(v: unknown): v is [number, number, number, number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 6 &&
    v.every(finNum)
  );
}

function validPoint(v: unknown): v is Point {
  return isRecord(v) && finNum(v.x) && finNum(v.y);
}

function validPointArray(v: unknown, max = 64): v is Point[] {
  return Array.isArray(v) && v.length >= 3 && v.length <= max && v.every(validPoint);
}

/** 对象矩阵线性伸缩范围 [1e-4,1e4]、|e|,|f|≤1e7；det>1e-8 不允许反射 */
function checkMatrix(m: [number, number, number, number, number, number], path: string, problems: Problem[]): boolean {
  const det = determinant(m);
  if (det <= 1e-8) {
    problems.push(problem('matrix/singular', `矩阵行列式 ${det} ≤ 1e-8（奇异或反射）`, path));
    return false;
  }
  const [a, b, c, d, e, f] = m;
  const sx = Math.hypot(a, b);
  const sy = det / (sx || 1);
  const scale = Math.max(Math.abs(sx), Math.abs(sy), sx > 0 ? Math.abs((a * c + b * d) / (sx * sy || 1)) : 0);
  if (scale < MATRIX_SCALE.min || scale > MATRIX_SCALE.max) {
    problems.push(problem('matrix/scale-out-of-range', `矩阵伸缩 ${scale} 超出 [${MATRIX_SCALE.min},${MATRIX_SCALE.max}]`, path));
    return false;
  }
  if (Math.abs(e) > MATRIX_TRANSLATE_MAX || Math.abs(f) > MATRIX_TRANSLATE_MAX) {
    problems.push(problem('matrix/translate-out-of-range', `平移分量 |${e}|,|${f}| 超过 ${MATRIX_TRANSLATE_MAX}`, path));
    return false;
  }
  return true;
}

/** Same transform contract for high-frequency previews without validating unrelated pages. */
export function validateTransform(input: unknown): Result<void> {
  if (!validMat(input)) return fail(problem('matrix/format', '矩阵须为6个有限数字'));
  const problems: Problem[] = [];
  checkMatrix(input as [number, number, number, number, number, number], 'matrix', problems);
  return problems.length ? fail(...problems) : ok(undefined);
}

function isIdentity(m: unknown): boolean {
  return (
    Array.isArray(m) &&
    m.length === 6 &&
    m.every((v: unknown) => finNum(v)) &&
    Math.abs(m[0] - 1) < 1e-9 &&
    Math.abs(m[1]) < 1e-9 &&
    Math.abs(m[2]) < 1e-9 &&
    Math.abs(m[3] - 1) < 1e-9 &&
    Math.abs(m[4]) < 1e-9 &&
    Math.abs(m[5]) < 1e-9
  );
}

// ---------- 结构解析（不用 as） ----------

interface ParsedLayer {
  layer: Layer;
  raw: Record<string, unknown>;
}

function parseLayer(id: string, raw: Record<string, unknown>, pageId: Id, problems: Problem[], version: number): ParsedLayer | null {
  const parentIdOk = raw.parentId === null || (str(raw.parentId) && isUuid(raw.parentId));
  const colorOk = raw.colorLabel === null || raw.colorLabel === undefined || (typeof raw.colorLabel === 'string' && ['red', 'orange', 'yellow', 'green', 'blue', 'purple'].includes(raw.colorLabel));
  if (
    !isUuid(id) ||
    !parentIdOk ||
    !validName(raw.name, LIMIT_LAYER_NAME_CODEPOINTS) ||
    !bool(raw.visible) ||
    !bool(raw.locked) ||
    !validMat(raw.matrix) ||
    !colorOk
  ) {
    problems.push(problem('layer/invalid-base', `图层 ${id} 基础字段非法`, `layers.${id}`));
    return null;
  }
  const matrix = raw.matrix as [number, number, number, number, number, number];
  const appearance = raw.presentation === undefined ? null : parsePresentation(raw.presentation, `layers.${id}.presentation`);
  if (raw.presentation !== undefined && (version < 12 || !appearance?.ok)) { problems.push(...(appearance && !appearance.ok ? appearance.problems : [problem('appearance/version','图层外观需要格式12',`layers.${id}`)])); return null; }
  const common = {
    id,
    pageId,
    parentId: (raw.parentId === null ? null : raw.parentId) as Id | null,
    name: raw.name as string,
    visible: raw.visible as boolean,
    locked: raw.locked as boolean,
    colorLabel: ((raw.colorLabel ?? null) === null ? null : raw.colorLabel) as Layer['colorLabel'],
    matrix,
    ...(appearance?.ok ? { presentation: appearance.value } : {}),
  };

  const type = raw.type;
  switch (type) {
    case 'pageBackground': {
      const values = validateBackgroundValues(raw);
      if (version < 4 || !values.ok || !isIdentity(raw.matrix) || raw.parentId !== null || 'children' in raw) {
        problems.push(problem('background/invalid', '背景需要格式4、单位矩阵、根图层及合法样式', `layers.${id}`)); return null;
      }
      return { layer: { ...common, type: 'pageBackground', ...values.value }, raw };
    }
    case 'group': {
      if (!validIdArray(raw.children)) {
        problems.push(problem('group/children', `编组 ${id} children 非法`, `layers.${id}`));
        return null;
      }
      const layer: GroupLayer = { ...common, type: 'group', children: raw.children as Id[] };
      if ('dialogue' in raw) {
        if (version < 6) { problems.push(problem('dialogue/version', '对白组需要格式6', `layers.${id}`)); return null; }
        const dialogue = parseDialogue(raw.dialogue, `layers.${id}.dialogue`); if (!dialogue.ok) { problems.push(...dialogue.problems); return null; }
        layer.dialogue = dialogue.value;
      }
      return { layer, raw };
    }
    case 'panel': {
      if (version < 5 ? raw.editorNumber !== undefined : raw.role === 'leaf' ? !Number.isSafeInteger(raw.editorNumber) || (raw.editorNumber as number) < 1 : raw.editorNumber !== undefined) { problems.push(problem('panel/number', '格式5叶子分镜需要唯一正整数序号，分格容器不应编号', `layers.${id}.editorNumber`)); return null; }
      if (raw.geometryMode !== undefined && raw.geometryMode !== 'convex' && (raw.geometryMode !== 'simple' || version < 2)) { problems.push(problem('panel/mode', '自由轮廓需要项目格式2，几何模式非法', `layers.${id}`)); return null; }
      if (raw.randomSeed !== undefined && (version < 2 || !validRandomSeed(raw.randomSeed))) { problems.push(problem('panel/random-seed', '随机分镜来源种子须为32位非负整数且使用项目格式2', `layers.${id}`)); return null; }
      if (!validPointArray(raw.geometry, raw.geometryMode === 'simple' ? 256 : 64)) {
        problems.push(problem('panel/geometry', `分镜 ${id} geometry 非法（需 3～${raw.geometryMode === 'simple' ? 256 : 64} 个有限顶点）`, `layers.${id}`));
        return null;
      }
      if (raw.role !== 'leaf' && raw.role !== 'split') {
        problems.push(problem('panel/role', `分镜 ${id} role 非法`, `layers.${id}`));
        return null;
      }
      const style = raw.style;
      if (
        !isRecord(style) ||
        !finNum(style.borderRadius) ||
        !finNum(style.borderWidth) ||
        !validRGBA(style.borderColor) ||
        !validRGBA(style.fill) ||
        (style.borderRadius as number) < PANEL_STYLE.radius.min ||
        (style.borderRadius as number) > PANEL_STYLE.radius.max ||
        (style.borderWidth as number) < PANEL_STYLE.borderWidth.min ||
        (style.borderWidth as number) > PANEL_STYLE.borderWidth.max
      ) {
        problems.push(problem('panel/style', `分镜 ${id} style 非法或超范围`, `layers.${id}`));
        return null;
      }
      if (!validIdArray(raw.children)) {
        problems.push(problem('panel/children', `分镜 ${id} children 非法`, `layers.${id}`));
        return null;
      }
      const layer: PanelLayer = {
        ...common,
        type: 'panel',
        ...(version >= 9 && raw.role === 'leaf' ? { nameMode: raw.nameMode as PanelLayer['nameMode'] } : {}),
        ...(raw.editorNumber !== undefined ? { editorNumber: raw.editorNumber as number } : {}),
        ...(raw.geometryMode ? { geometryMode: raw.geometryMode as 'convex' | 'simple' } : {}),
        ...(raw.randomSeed !== undefined ? { randomSeed: raw.randomSeed as number } : {}),
        geometry: raw.geometry as Point[],
        role: raw.role as 'leaf' | 'split',
        style: {
          borderRadius: style.borderRadius as number,
          borderWidth: style.borderWidth as number,
          borderColor: style.borderColor as RGBA,
          fill: style.fill as RGBA,
        },
        children: raw.children as Id[],
      };
      if (version >= 9 && layer.role === 'leaf' && !['automatic','custom'].includes(String(raw.nameMode))) { problems.push(problem('panel/name-mode', '分镜名称需要automatic或custom来源', `layers.${id}.nameMode`)); return null; }
      return { layer, raw };
    }
    case 'image': {
      if (!str(raw.assetId) || !finNum(raw.width) || !finNum(raw.height) || (raw.width as number) <= 0 || (raw.height as number) <= 0) {
        problems.push(problem('image/fields', `图片 ${id} assetId/width/height 非法`, `layers.${id}`));
        return null;
      }
      let crop: ImageLayer['crop'] = null;
      if (raw.crop !== null && raw.crop !== undefined) {
        const c = raw.crop;
        if (
          !isRecord(c) ||
          !isRecord(c.focus) ||
          !finNum(c.focus.u) ||
          !finNum(c.focus.v) ||
          !finNum(c.zoom) ||
          (c.zoom as number) < 1
        ) {
          problems.push(problem('image/crop', `图片 ${id} crop 非法（zoom≥1）`, `layers.${id}`));
          return null;
        }
        crop = { focus: { u: c.focus.u as number, v: c.focus.v as number }, zoom: c.zoom as number };
      }
      let mask: ImageLayer['mask'];
      if (raw.mask !== undefined) {
        const m = raw.mask;
        if (version < 3 || crop || !isRecord(m) || typeof m.enabled !== 'boolean' || typeof m.linked !== 'boolean' || !['rect', 'ellipse', 'polygon'].includes(m.shape as string) || !validPointArray(m.geometry, 256) || !validMat(m.matrix)) {
          problems.push(problem('image/mask', '遮罩格式非法，遮罩需要格式3和自由图片', `layers.${id}.mask`)); return null;
        }
        mask = m as unknown as NonNullable<ImageLayer['mask']>;
        const checked = validateMaskGeometry(mask);
        if (!checked.ok) { problems.push(...checked.problems); return null; }
        if (!checkMatrix(mask.matrix as [number,number,number,number,number,number], `layers.${id}.mask.matrix`, problems)) return null;
      }
      let panelClip: ImageLayer['panelClip'];
      if (raw.panelClip !== undefined) {
        const policy = raw.panelClip;
        if (version < 5 || crop || !isRecord(policy) || !['normal', 'whole', 'partial'].includes(policy.mode as string) || (policy.mode === 'partial' && !isRecord(policy.region))) { problems.push(problem('image/panel-clip', '破格模式需要格式5自由图片和有效区域', `layers.${id}.panelClip`)); return null; }
        if (policy.region !== undefined) {
          const r = policy.region;
          if (!isRecord(r) || !['rect', 'ellipse', 'polygon'].includes(r.shape as string) || !validPointArray(r.geometry, 256) || !validMat(r.matrix)) { problems.push(problem('image/breakout-region', '局部破格区域格式无效', `layers.${id}.panelClip.region`)); return null; }
          const checked = validateMaskGeometry({ ...r, enabled: true, linked: true } as unknown as NonNullable<ImageLayer['mask']>);
          if (!checked.ok) { problems.push(...checked.problems); return null; }
          if (!checkMatrix(r.matrix as [number,number,number,number,number,number], `layers.${id}.panelClip.region.matrix`, problems)) return null;
        }
        panelClip = structuredClone(policy) as unknown as ImageLayer['panelClip'];
      }
      const layer: ImageLayer = {
        ...common,
        type: 'image',
        assetId: raw.assetId as Id,
        width: raw.width as number,
        height: raw.height as number,
        crop,
        ...(mask ? { mask: structuredClone(mask) } : {}),
        ...(panelClip ? { panelClip } : {}),
      };
      if (version >= 9) { const window = parseSourceRect(raw.sourceRect, `layers.${id}.sourceRect`); if (!window.ok) { problems.push(...window.problems); return null; } if (crop && window.value) { problems.push(problem('image/source-cover', '裁剪源窗不能与旧铺满映射同时使用', `layers.${id}`)); return null; } layer.sourceRect = window.value; }
      return { layer, raw };
    }
    case 'bubble': {
      if (!finNum(raw.width) || !finNum(raw.height) || (raw.width as number) <= 0 || (raw.height as number) <= 0) {
        problems.push(problem('bubble/size', `气泡 ${id} 尺寸非法`, `layers.${id}`));
        return null;
      }
      const shapes = ['rect', 'roundRect', 'circle', 'cloud', 'spiky', ...(version >= 6 ? ['handOval', 'handPolygon', 'wave'] : []), ...(version >= 10 ? ['freehand'] : [])];
      if (!shapes.includes(raw.shape as string)) {
        problems.push(problem('bubble/shape', `气泡 ${id} shape "${String(raw.shape)}" 非法`, `layers.${id}`));
        return null;
      }
      const style = raw.style;
      if (
        !isRecord(style) ||
        !validRGBA(style.fill) ||
        !finNum(style.borderWidth) ||
        !validRGBA(style.borderColor) ||
        !finNum(style.radius) ||
        (style.radius as number) < PANEL_STYLE.radius.min || (style.radius as number) > PANEL_STYLE.radius.max ||
        (style.borderWidth as number) < PANEL_STYLE.borderWidth.min || (style.borderWidth as number) > PANEL_STYLE.borderWidth.max
      ) {
        problems.push(problem('bubble/style', `气泡 ${id} style 非法`, `layers.${id}`));
        return null;
      }
      let tail: BubbleLayer['tail'] = null;
      if (version >= 6 && 'tail' in raw) { problems.push(problem('bubble/legacy-tail', '格式6尾巴必须使用独立子层，不接受旧tail对象', `layers.${id}.tail`)); return null; }
      if (raw.tail !== null && raw.tail !== undefined) {
        const t = raw.tail;
        if (
          !isRecord(t) ||
          (t.kind !== 'triangle' && t.kind !== 'line') ||
          !finNum(t.attachU) ||
          !finNum(t.baseWidth) ||
          !isRecord(t.tip) ||
          !finNum(t.tip.x) ||
          !finNum(t.tip.y) ||
          (t.attachU as number) < 0 ||
          (t.attachU as number) >= 1
        ) {
          problems.push(problem('bubble/tail', `气泡 ${id} tail 非法（attachU∈[0,1)）`, `layers.${id}`));
          return null;
        }
        tail = {
          kind: t.kind as 'triangle' | 'line',
          attachU: t.attachU as number,
          baseWidth: t.baseWidth as number,
          tip: { x: t.tip.x as number, y: t.tip.y as number },
        };
      }
      if (!validIdArray(raw.children)) {
        problems.push(problem('bubble/children', `气泡 ${id} children 非法`, `layers.${id}`));
        return null;
      }
      const layer: BubbleLayer = {
        ...common,
        type: 'bubble',
        width: raw.width as number,
        height: raw.height as number,
        shape: raw.shape as BubbleLayer['shape'],
        ...(version < 6 ? { tail } : {}),
        style: {
          fill: style.fill as RGBA,
          borderWidth: style.borderWidth as number,
          borderColor: style.borderColor as RGBA,
          radius: style.radius as number,
        },
        children: raw.children as Id[],
      };
      if (version >= 6) {
        const hand = parseHandDrawn(raw.handDrawn, `layers.${id}.handDrawn`), contour = parseBubbleContour(raw.contour, `layers.${id}.contour`);
        if (!hand.ok || !contour.ok) { if (!hand.ok) problems.push(...hand.problems); if (!contour.ok) problems.push(...contour.problems); return null; }
        layer.handDrawn = hand.value; layer.contour = contour.value;
      }
      if (version >= 9) {
        const edge = parseBubbleEdge(raw.edgeStyle, `layers.${id}.edgeStyle`); if (!edge.ok) { problems.push(...edge.problems); return null; } layer.edgeStyle = edge.value;
        for (const key of ['innerStroke','outerStroke'] as const) { const band = parseStrokeBand(style[key], `layers.${id}.style.${key}`); if (!band.ok) { problems.push(...band.problems); return null; } layer.style[key] = band.value; }
      }
      if (raw.freehandSource !== undefined || layer.shape === 'freehand') {
        if (version < 10 || layer.shape !== 'freehand' || layer.contour || layer.handDrawn) { problems.push(problem('drawing/version', '自由绘画气泡需要格式10和独立绘画源', `layers.${id}`)); return null; }
        const source = parseDrawingSource(raw.freehandSource, 'bubble'); if (!source.ok) { problems.push(...source.problems); return null; }
        if (version < 11 && source.value.version === 2) { problems.push(problem('drawing/version', '气泡细节需要格式11', `layers.${id}`)); return null; } layer.freehandSource = source.value;
      }
      const geometry = buildBubble(layer.shape, layer.width, layer.height, layer.style, layer.tail ?? null, layer);
      if (!geometry.ok) { problems.push(...geometry.problems.map((entry) => ({ ...entry, path: `layers.${id}` }))); return null; }
      return { layer, raw };
    }
    case 'bubbleTail': {
      if (version < 6) { problems.push(problem('tail/version', '独立尾组件需要格式6', `layers.${id}`)); return null; }
      const fields = parseTailFields(raw, `layers.${id}`); if (!fields.ok) { problems.push(...fields.problems); return null; }
      return { layer: { ...common, type: 'bubbleTail', ...fields.value }, raw };
    }
    case 'text': {
      const text = raw.text;
      if (!isRecord(text) || !parseTextContent(text, `layers.${id}.text`, problems)) {
        problems.push(problem('text/content', `文字 ${id} text 非法`, `layers.${id}`));
        return null;
      }
      const box = raw.box;
      if (
        !isRecord(box) ||
        !finNum(box.x) ||
        !finNum(box.y) ||
        !finNum(box.width) ||
        !finNum(box.height) ||
        (box.width as number) < 0 ||
        (box.height as number) < 0
      ) {
        problems.push(problem('text/box', `文字 ${id} box 非法（需非负有限宽高）`, `layers.${id}`));
        return null;
      }
      const layer: TextLayer = {
        ...common,
        type: 'text',
        box: { x: box.x as number, y: box.y as number, width: box.width as number, height: box.height as number },
        text: buildTextContent(text),
      };
      if(text.wrapMode!==undefined){if(version<9||!['word','grapheme'].includes(String(text.wrapMode))){problems.push(problem('text/wrap-mode','换行策略需要格式9的word或grapheme',`layers.${id}.text.wrapMode`));return null;}layer.text.wrapMode=text.wrapMode as 'word'|'grapheme';}
      if (version >= 9 && raw.bubbleFrame !== undefined) { const frame = parseBubbleFrame(raw.bubbleFrame, `layers.${id}.bubbleFrame`); if (!frame.ok) { problems.push(...frame.problems); return null; } layer.bubbleFrame = frame.value; }
      if (version < 6 && raw.role === 'plain' && raw.effects === null) { layer.role = 'plain'; layer.effects = null; }
      if (version >= 6) {
        if (raw.role !== 'plain' && raw.role !== 'sfx') { problems.push(problem('text/role', '格式6文字需要plain或sfx角色', `layers.${id}.role`)); return null; }
        if (raw.role === 'plain' && raw.effects !== null) { problems.push(problem('text/effects', '普通文字不能带声效变形', `layers.${id}.effects`)); return null; }
        layer.role = raw.role; layer.effects = null;
        if (raw.role === 'sfx') { const effects = parseTextEffects(raw.effects, `layers.${id}.effects`); if (!effects.ok) { problems.push(...effects.problems); return null; } layer.effects = effects.value; }
      }
      return { layer, raw };
    }
    case 'decoration': {
      const spec = parseDecorationSpec(raw.spec, `layers.${id}.spec`, problems);
      if (!spec) return null;
      if (version < 7 && spec.kind === 'speed-brush') { problems.push(problem('brush/version', '速度线笔刷需要格式7', `layers.${id}.spec`)); return null; }
      if (version < 12 && spec.kind === 'shape') { problems.push(problem('shape/version', '普通矢量形状需要格式12', `layers.${id}.spec`)); return null; }
      if (version >= 6 && spec.kind === 'sfx') { problems.push(problem('text/legacy-sfx', '格式6声效必须使用独立文字图层', `layers.${id}.spec`)); return null; }
      const layer: Layer = { ...common, type: 'decoration', spec };
      return { layer, raw };
    }
    default:
      problems.push(problem('layer/unknown-type', `未知图层类型 "${String(type)}"`, `layers.${id}`));
      return null;
  }
}

function parseTextContent(t: Record<string, unknown>, path: string, problems: Problem[]): boolean {
  if (!str(t.content)) {
    problems.push(problem('text/content-type', 'content 必须为字符串', path));
    return false;
  }
  if (codepoints(t.content) > LIMIT_TEXT_CODEPOINTS) {
    problems.push(problem('text/too-long', `文本 ${codepoints(t.content)} 码点超过上限 ${LIMIT_TEXT_CODEPOINTS}`, path));
    return false;
  }
  if (t.direction !== 'horizontal' && t.direction !== 'vertical') {
    problems.push(problem('text/direction', `direction "${String(t.direction)}" 非法`, path));
    return false;
  }
  if (t.align !== 'start' && t.align !== 'center' && t.align !== 'end') {
    problems.push(problem('text/align', `align "${String(t.align)}" 非法`, path));
    return false;
  }
  const font = t.font;
  if (
    !isRecord(font) ||
    !str(font.family) ||
    !finNum(font.size) ||
    !validRGBA(font.color) ||
    !bool(font.bold) ||
    !bool(font.italic)
  ) {
    problems.push(problem('text/font', 'font 字段非法', `${path}.font`));
    return false;
  }
  if (!finNum(t.lineHeight) || !finNum(t.letterSpacing)) {
    problems.push(problem('text/spacing', 'lineHeight/letterSpacing 必须为有限数值', path));
    return false;
  }
  if ((font.size as number) < 1 || (font.size as number) > 512 || (t.lineHeight as number) < 1 || (t.lineHeight as number) > 3 || (t.letterSpacing as number) < -0.2 * (font.size as number) || (t.letterSpacing as number) > 2 * (font.size as number)) {
    problems.push(problem('text/range', '字号1～512、行高1～3、字距-0.2～2倍字号', path));
    return false;
  }
  return true;
}

function buildTextContent(t: Record<string, unknown>): TextContent {
  const font = t.font as Record<string, unknown>;
  return {
    content: t.content as string,
    direction: t.direction as TextContent['direction'],
    font: {
      family: font.family as string,
      size: font.size as number,
      color: font.color as RGBA,
      bold: font.bold as boolean,
      italic: font.italic as boolean,
    },
    align: t.align as TextContent['align'],
    lineHeight: t.lineHeight as number,
    letterSpacing: t.letterSpacing as number,
  };
}

function parseDecorationSpec(v: unknown, path: string, problems: Problem[]): DecorationSpec | null {
  if (!isRecord(v)) {
    problems.push(problem('decoration/spec', 'spec 必须为对象', path));
    return null;
  }
  const inRange = (x: number, min: number, max: number) => x >= min && x <= max;
  switch (v.kind) {
    case 'shape': {
      const style=v.style;
      if(!finNum(v.width)||!finNum(v.height)||!inRange(v.width,1,16384)||!inRange(v.height,1,16384)||!['convex','simple'].includes(String(v.geometryMode))||!validPointArray(v.geometry,256)||!isRecord(style)||!validRGBA(style.fill)||!validRGBA(style.borderColor)||!finNum(style.borderWidth)||!inRange(style.borderWidth,0,256)||!finNum(style.borderRadius)||!inRange(style.borderRadius,0,4096)) {problems.push(problem('shape/fields','矢量形状参数无效',path));return null;}
      const geometry=v.geometry as Point[], valid=validatePanelGeometry({geometry,geometryMode:v.geometryMode as 'convex'|'simple'}); if(!valid.ok){problems.push(...valid.problems);return null;}
      if(v.geometryMode==='simple'&&style.borderRadius!==0){problems.push(problem('shape/radius','自由轮廓圆角必须为0',path));return null;}
      return {kind:'shape',width:v.width,height:v.height,geometry:geometry.map(p=>({...p})),geometryMode:v.geometryMode as 'convex'|'simple',style:{fill:style.fill.toUpperCase(),borderColor:style.borderColor.toUpperCase(),borderWidth:style.borderWidth,borderRadius:style.borderRadius}};
    }
    case 'speed-brush': {
      const point = (p: unknown): p is Point => isRecord(p) && finNum(p.x) && finNum(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
      if (!finNum(v.width) || !finNum(v.height) || !inRange(v.width, 16, 16384) || !inRange(v.height, 16, 16384)
        || !intNum(v.seed) || v.seed < 0 || v.seed > 0xffffffff || !validRGBA(v.color) || !validBrushOptions(v.options)
        || !Array.isArray(v.centerline) || v.centerline.length < 2 || v.centerline.length > SPEED_BRUSH.centerPoints || !v.centerline.every(point)
        || !Array.isArray(v.ribbons) || v.ribbons.length < 1 || v.ribbons.length > SPEED_BRUSH.ribbonPoints / 4
        || v.ribbons.some(r => !Array.isArray(r) || r.length < 4 || r.length > 1024 || !r.every(point))
        || v.ribbons.reduce((n, r) => n + r.length, 0) > SPEED_BRUSH.ribbonPoints) {
        problems.push(problem('brush/fields', '速度线笔刷轮廓或参数无效/超出预算', path)); return null;
      }
      return { kind: 'speed-brush', width: v.width, height: v.height, seed: v.seed, color: v.color,
        options: { ...v.options }, centerline: v.centerline.map(p => ({ x: p.x, y: p.y })), ribbons: v.ribbons.map(r => r.map((p: Point) => ({ x: p.x, y: p.y }))) };
    }
    case 'speed':
    case 'focus': {
      if (
        !finNum(v.width) ||
        !finNum(v.height) ||
        !intNum(v.count) ||
        !finNum(v.seed) ||
        !finNum(v.strokeWidth) ||
        !validRGBA(v.color) ||
        !inRange(v.width, DECORATION.size.min, DECORATION.size.max) ||
        !inRange(v.height, DECORATION.size.min, DECORATION.size.max) ||
        !inRange(v.count, DECORATION.count.min, DECORATION.count.max) ||
        !inRange(v.strokeWidth, DECORATION.strokeWidth.min, DECORATION.strokeWidth.max)
      ) {
        problems.push(problem('decoration/fields', `装饰参数非法或超范围`, path));
        return null;
      }
      if (v.kind === 'speed') {
        return {
          kind: 'speed',
          width: v.width as number,
          height: v.height as number,
          count: v.count as number,
          angleDeg: finNum(v.angleDeg) ? (v.angleDeg as number) : 0,
          seed: v.seed as number,
          strokeWidth: v.strokeWidth as number,
          color: v.color as RGBA,
        };
      }
      if (
        !finNum(v.innerRatio) ||
        !inRange(v.innerRatio as number, DECORATION.innerRatio.min, DECORATION.innerRatio.max)
      ) {
        problems.push(problem('decoration/inner-ratio', `innerRatio 须在 [${DECORATION.innerRatio.min},${DECORATION.innerRatio.max}]`, path));
        return null;
      }
      return {
        kind: 'focus',
        width: v.width as number,
        height: v.height as number,
        count: v.count as number,
        innerRatio: v.innerRatio as number,
        seed: v.seed as number,
        strokeWidth: v.strokeWidth as number,
        color: v.color as RGBA,
      };
    }
    case 'sfx': {
      if (
        !finNum(v.width) ||
        !finNum(v.height) ||
        !str(v.content) ||
        !str(v.fontFamily) ||
        !finNum(v.fontSize) ||
        !validRGBA(v.color) ||
        !validRGBA(v.outline) ||
        !finNum(v.outlineWidth) ||
        codepoints(v.content as string) > LIMIT_TEXT_CODEPOINTS ||
        !inRange(v.width, DECORATION.size.min, DECORATION.size.max) ||
        !inRange(v.height, DECORATION.size.min, DECORATION.size.max) ||
        !inRange(v.fontSize as number, 1, 512) ||
        !inRange(v.outlineWidth, DECORATION.strokeWidth.min, DECORATION.strokeWidth.max)
      ) {
        problems.push(problem('decoration/fields', '音效字参数非法或超范围', path));
        return null;
      }
      return {
        kind: 'sfx',
        width: v.width as number,
        height: v.height as number,
        content: v.content as string,
        fontFamily: v.fontFamily as string,
        fontSize: v.fontSize as number,
        color: v.color as RGBA,
        outline: v.outline as RGBA,
        outlineWidth: v.outlineWidth as number,
      };
    }
    default:
      problems.push(problem('decoration/kind', `未知装饰类型 "${String(v.kind)}"`, path));
      return null;
  }
}

function validIdArray(v: unknown): v is Id[] {
  return Array.isArray(v) && v.every((x) => str(x) && x.length > 0);
}

// ---------- 主体 ----------

export function validateProject(input: unknown): Result<Project> {
  const problems: Problem[] = [];

  // 1. JSON 长度与深度
  if (str(input)) {
    if (input.length > LIMITS.maxProjectBytes) {
      return fail(problem('json/too-large', `JSON 长度 ${input.length} 超过 ${LIMITS.maxProjectBytes}`));
    }
    try {
      input = JSON.parse(input);
    } catch (e) {
      return fail(problem('json/parse', `JSON 解析失败：${(e as Error).message}`));
    }
  }
  if (!isRecord(input)) {
    return fail(problem('json/not-object', '项目必须是 JSON 对象'));
  }
  // Reject oversized brush arrays before recursive JSON scans, cloning or compilation.
  let brushPoints = 0;
  if (isRecord(input.layers)) for (const layer of Object.values(input.layers)) {
    if (!isRecord(layer) || !isRecord(layer.spec) || layer.spec.kind !== 'speed-brush') continue;
    const v = layer.spec;
    if (!Array.isArray(v.centerline) || v.centerline.length > SPEED_BRUSH.centerPoints || !Array.isArray(v.ribbons) || v.ribbons.length > SPEED_BRUSH.ribbonPoints / 4) return fail(problem('brush/budget', '速度线笔刷超出几何预算'));
    let count = 0;
    for (const ring of v.ribbons) {
      if (!Array.isArray(ring) || ring.length > 1024 || (count += ring.length) > SPEED_BRUSH.ribbonPoints) return fail(problem('brush/budget', '速度线笔刷超出单笔几何预算'));
    }
    if ((brushPoints += count) > SPEED_BRUSH.projectPoints) return fail(problem('brush/project-budget', '作品速度线超过500000轮廓点，请拆分作品'));
  }
  if (measureDepth(input) > MAX_JSON_DEPTH) {
    return fail(problem('json/too-deep', `JSON 嵌套深度超过 ${MAX_JSON_DEPTH}`));
  }
  if (hasProtoKey(input, 'project', problems)) {
    return fail(...problems);
  }

  // 2. 顶层结构
  if (input.schemaVersion !== 1 && input.schemaVersion !== 2 && input.schemaVersion !== 3 && input.schemaVersion !== 4 && input.schemaVersion !== 5 && input.schemaVersion !== 6 && input.schemaVersion !== 7 && input.schemaVersion !== 8 && input.schemaVersion !== 9 && input.schemaVersion !== 10 && input.schemaVersion !== 11 && input.schemaVersion !== 12) {
    return fail(problem('project/version', `schemaVersion 必须为 1～12，收到 ${String(input.schemaVersion)}`));
  }
  if (input.schemaVersion >= 5 ? !Number.isSafeInteger(input.nextPanelNumber) || (input.nextPanelNumber as number) < 1 : input.nextPanelNumber !== undefined) return fail(problem('project/number-counter', '格式5/6需要有效的分镜计数器，旧格式不应包含新计数器'));
  if (!isUuid(input.id)) {
    return fail(problem('project/id', 'project.id 必须为 UUID'));
  }
  if (!validName(input.name, LIMIT_LAYER_NAME_CODEPOINTS)) {
    return fail(problem('project/name', '项目名须为 1～80 码点'));
  }
  if (!Array.isArray(input.pageOrder) || input.pageOrder.length === 0 || !input.pageOrder.every((x: unknown) => isUuid(x))) {
    return fail(problem('project/page-order', 'pageOrder 必须为非空 UUID 数组'));
  }
  if (!isRecord(input.pages) || !isRecord(input.layers) || !isRecord(input.assets) || !isRecord(input.templates)) {
    return fail(problem('project/records', 'pages/layers/assets/templates 必须为对象'));
  }
  const settings = input.settings;
  if (
    !isRecord(settings) ||
    (settings.readingDirection !== 'ltr' && settings.readingDirection !== 'rtl') ||
    !finNum(settings.defaultDpi) ||
    (settings.defaultDpi as number) < DPI.min ||
    (settings.defaultDpi as number) > DPI.max
  ) {
    return fail(problem('project/settings', 'settings 非法（readingDirection ltr/rtl，defaultDpi 72～600）'));
  }

  // 资产
  const assets: Record<Id, AssetMeta> = {};
  let totalAssetBytes = 0;
  for (const [id, raw] of Object.entries(input.assets)) {
    if (!isUuid(id) || !isRecord(raw)) {
      problems.push(problem('asset/id', `资产 ${id} 非法`, `assets.${id}`));
      continue;
    }
    if (
      !validName(raw.name, LIMIT_LAYER_NAME_CODEPOINTS) ||
      !str(raw.originalMime) ||
      !str(raw.originalHash) ||
      !/^[0-9a-f]{64}$/.test(raw.originalHash as string) ||
      !str(raw.renderHash) ||
      !/^[0-9a-f]{64}$/.test(raw.renderHash as string) ||
      (raw.renderMime !== 'image/png' && raw.renderMime !== 'image/jpeg' && raw.renderMime !== 'image/webp') ||
      !intNum(raw.width) ||
      !intNum(raw.height) ||
      (raw.width as number) <= 0 ||
      (raw.height as number) <= 0 ||
      !intNum(raw.originalBytes) ||
      !intNum(raw.renderBytes) ||
      (raw.originalBytes as number) <= 0 ||
      (raw.renderBytes as number) <= 0 ||
      (raw.framePolicy !== 'still' && raw.framePolicy !== 'first-frame') ||
      raw.normalizedOrientation !== true
    ) {
      problems.push(problem('asset/fields', `资产 ${raw.name ?? id} 字段非法`, `assets.${id}`));
      continue;
    }
    if ((raw.width as number) * (raw.height as number) > LIMITS.maxAssetPixels) {
      problems.push(problem('asset/too-many-pixels', `资产 ${id} 像素超上限 ${LIMITS.maxAssetPixels}`, `assets.${id}`));
      continue;
    }
    let drawingSource: AssetMeta['drawingSource'];
    if (raw.drawingSource !== undefined || raw.drawingSourceHash !== undefined) {
      if (input.schemaVersion < 10 || !str(raw.drawingSourceHash) || !/^[0-9a-f]{64}$/.test(raw.drawingSourceHash)) { problems.push(problem('drawing/asset-version', '绘画素材需要格式10、绘画源和源摘要')); continue; }
      const source = parseDrawingSource(raw.drawingSource, 'material'); if (!source.ok) { problems.push(...source.problems); continue; }
      if (source.value.width !== raw.width || source.value.height !== raw.height || raw.renderMime !== 'image/png') { problems.push(problem('drawing/asset-size', '绘画源须与透明PNG素材尺寸一致')); continue; }
      drawingSource = source.value;
    }
    totalAssetBytes += raw.originalBytes as number;
    assets[id] = {
      id,
      name: raw.name as string,
      originalMime: raw.originalMime as string,
      originalHash: raw.originalHash as string,
      renderHash: raw.renderHash as string,
      renderMime: raw.renderMime as AssetMeta['renderMime'],
      width: raw.width as number,
      height: raw.height as number,
      originalBytes: raw.originalBytes as number,
      renderBytes: raw.renderBytes as number,
      framePolicy: raw.framePolicy as AssetMeta['framePolicy'],
      normalizedOrientation: true,
      ...(drawingSource ? { drawingSource, drawingSourceHash: raw.drawingSourceHash as string } : {}),
    };
  }
  if (totalAssetBytes > LIMIT_ASSET_TOTAL_BYTES) {
    problems.push(problem('asset/total-bytes', `素材原始字节累计 ${totalAssetBytes} 超过 ${LIMIT_ASSET_TOTAL_BYTES}`));
  }

  // 模板
  const templates: Record<Id, UserTemplate> = {};
  const templateNames = new Set<string>();
  if (input.schemaVersion >= 8 && Object.keys(input.templates).length > PRESET_LIMITS.count) return fail(problem('preset/limit', '自定义预设最多256个'));
  for (const [id, raw] of Object.entries(input.templates)) {
    if(input.schemaVersion<12&&isRecord(raw)&&isRecord(raw.recipe)&&isRecord(raw.recipe.nodes)&&Object.values(raw.recipe.nodes).some(n=>isRecord(n)&&(n.presentation!==undefined||isRecord(n.spec)&&n.spec.kind==='shape'))){problems.push(problem('preset/version','外观／矢量形状预设需要格式12',`templates.${id}.recipe`));continue;}
    if(input.schemaVersion<9&&isRecord(raw)&&isRecord(raw.recipe)&&raw.recipe.kind==='bubble-brush'){problems.push(problem('preset/version','气泡笔刷预设需要格式9',`templates.${id}.recipe`));continue;}
    if(input.schemaVersion<10&&isRecord(raw)&&isRecord(raw.recipe)&&isRecord(raw.recipe.nodes)&&Object.values(raw.recipe.nodes).some(n=>isRecord(n)&&(n.shape==='freehand'||n.freehandSource!==undefined))){problems.push(problem('preset/version','自由绘画组件预设需要格式10',`templates.${id}.recipe`));continue;}
    if(input.schemaVersion<11&&isRecord(raw)&&isRecord(raw.recipe)&&isRecord(raw.recipe.nodes)&&Object.values(raw.recipe.nodes).some(n=>isRecord(n)&&isRecord(n.freehandSource)&&n.freehandSource.version===2)){problems.push(problem('preset/version','气泡细节预设需要格式11',`templates.${id}.recipe`));continue;}
    if (!isSafeId(id) || !isRecord(raw)) {
      problems.push(problem('template/id', `模板 ${id} 非法`, `templates.${id}`));
      continue;
    }
    if (input.schemaVersion >= 8) {
      const parsed = validateComponentPreset({ ...raw, id });
      if (!parsed.ok) { problems.push(...parsed.problems); continue; }
      const key = libraryNameKey(parsed.value.name);
      if (templateNames.has(key)) { problems.push(problem('preset/name', '组件预设名称重复')); continue; }
      templateNames.add(key); templates[id] = parsed.value; continue;
    }
    if (!validName(raw.name, LIMIT_LAYER_NAME_CODEPOINTS) || !isRecord(raw.root)) {
      problems.push(problem('template/fields', `模板 ${id} 字段非法`, `templates.${id}`));
      continue;
    }
    const root = parseTemplateNode(raw.root, `templates.${id}.root`, problems, input.schemaVersion);
    if (!root) continue;
    templates[id] = { id, name: raw.name as string, root };
  }

  // 页面
  const pages: Record<Id, Page> = {};
  const pageOrder = input.pageOrder as Id[];
  if (new Set(pageOrder).size !== pageOrder.length) {
    problems.push(problem('page/order-dup', 'pageOrder 存在重复 ID'));
  }
  for (const [id, raw] of Object.entries(input.pages)) {
    if (!isUuid(id) || !isRecord(raw)) {
      problems.push(problem('page/id', `页面 ${id} 非法`, `pages.${id}`));
      continue;
    }
    if (
      !validName(raw.name, LIMIT_PAGE_NAME_CODEPOINTS) ||
      !finNum(raw.width) ||
      !finNum(raw.height) ||
      !intNum(raw.dpi) ||
      (raw.width as number) < PAGE_AXIS.min ||
      (raw.width as number) > PAGE_AXIS.max ||
      (raw.height as number) < PAGE_AXIS.min ||
      (raw.height as number) > PAGE_AXIS.max ||
      (raw.dpi as number) < DPI.min ||
      (raw.dpi as number) > DPI.max ||
      (input.schemaVersion < 4 ? !validRGBA(raw.background) : 'background' in raw) ||
      !validIdArray(raw.roots)
    ) {
      problems.push(problem('page/fields', `页面 ${raw.name ?? id} 字段非法（尺寸 ${PAGE_AXIS.min}～${PAGE_AXIS.max}px，dpi ${DPI.min}～${DPI.max}）`, `pages.${id}`));
      continue;
    }
    pages[id] = {
      id,
      name: raw.name as string,
      width: raw.width as number,
      height: raw.height as number,
      dpi: raw.dpi as number,
      ...(input.schemaVersion < 4 ? { background: raw.background as RGBA } : {}),
      roots: raw.roots as Id[],
    };
  }
  for (const pid of pageOrder) {
    if (!pages[pid]) {
      problems.push(problem('page/missing', `pageOrder 引用了不存在的页面 ${pid}`));
    }
  }
  for (const id of Object.keys(pages)) {
    if (!pageOrder.includes(id as Id)) {
      problems.push(problem('page/orphan', `页面 ${id} 不在 pageOrder 中`, `pages.${id}`));
    }
  }

  // 图层
  const layers: Record<Id, Layer> = {};
  for (const [id, raw] of Object.entries(input.layers)) {
    if (!isRecord(raw)) {
      problems.push(problem('layer/not-object', `图层 ${id} 非法`, `layers.${id}`));
      continue;
    }
    const parsed = parseLayer(id, raw, str(raw.pageId) ? (raw.pageId as Id) : '', problems, input.schemaVersion);
    if (parsed) layers[id] = parsed.layer;
  }
  const counts = mangaLayerCounts({ layers });
  if (counts.content > LIMITS.maxLayers || counts.boundTails > MANGA.maxBoundTails) {
    problems.push(problem('project/too-many-layers', `图层数 ${Object.keys(layers).length} 超过上限 ${LIMITS.maxLayers}`));
  }

  if (problems.length > 0) {
    return fail(...problems);
  }

  // 3. DFS 不变量检查
  if (input.schemaVersion >= 5) {
    const numbers = Object.values(layers).flatMap(layer => layer.type === 'panel' && layer.role === 'leaf' ? [layer.editorNumber!] : []);
    if (new Set(numbers).size !== numbers.length || numbers.some(n => n >= (input.nextPanelNumber as number))) return fail(problem('panel/duplicate-number', '漫画内分镜序号重复或超过下一可分配序号'));
  }
  if (input.schemaVersion >= 3 && (!validIdArray(input.libraryAssetIds) || new Set(input.libraryAssetIds as string[]).size !== (input.libraryAssetIds as string[]).length || (input.libraryAssetIds as string[]).some(id => !assets[id]))) return fail(problem('project/library', '素材库引用缺失、重复或无效'));
  const organization = input.schemaVersion >= 8 ? validateAssetLibrary(input.assetLibrary, input.libraryAssetIds as Id[], new Set([input.id as Id, ...Object.keys(pages), ...Object.keys(layers), ...Object.keys(assets), ...Object.keys(templates)])) : null;
  if (organization && !organization.ok) return organization;
  const treeProblems = checkTree(pageOrder, pages, layers, assets, input.schemaVersion);
  if (treeProblems.length > 0) {
    return fail(...treeProblems);
  }

  const stylePresets: Record<Id, import('./types').AppearancePreset> = {};
  if(input.stylePresets!==undefined){if(input.schemaVersion<12||!isRecord(input.stylePresets)||Object.keys(input.stylePresets).length>128)return fail(problem('appearance/presets','外观预设需要格式12且最多128项'));const names=new Set<string>();for(const [id,raw] of Object.entries(input.stylePresets)){const p=parseAppearancePreset(raw,`stylePresets.${id}`);if(!p.ok)return p;if(p.value.id!==id||names.has(libraryNameKey(p.value.name)))return fail(problem('appearance/preset-duplicate','外观预设编号或名称重复'));names.add(libraryNameKey(p.value.name));stylePresets[id]=p.value;}}
  const project:Project = {
    schemaVersion: input.schemaVersion,
    ...(input.schemaVersion >= 5 ? { nextPanelNumber: input.nextPanelNumber as number } : {}),
    id: input.id as Id,
    name: input.name as string,
    pageOrder,
    pages,
    layers,
    assets,
    ...(input.schemaVersion >= 3 ? { libraryAssetIds: input.libraryAssetIds as Id[] } : {}),
    ...(organization?.ok ? { assetLibrary: organization.value } : {}),
    templates,
    ...(input.stylePresets!==undefined?{stylePresets}:{}),
    settings: {
      readingDirection: settings.readingDirection as 'ltr' | 'rtl',
      defaultDpi: settings.defaultDpi as number,
    },
  };
  for(const layer of Object.values(layers))if(layer.type==='group'&&layer.dialogue){const geometry=prepareDialogue(project,layer.id);if(!geometry.ok)return fail(...geometry.problems.map(p=>({...p,path:`layers.${layer.id}`})));}
  return ok(project);
}

function checkTree(
  pageOrder: Id[],
  pages: Record<Id, Page>,
  layers: Record<Id, Layer>,
  assets: Record<Id, AssetMeta>,
  version: number,
): Problem[] {
  const problems: Problem[] = [];
  const incoming = new Map<Id, number>();
  const state = new Map<Id, 'unvisited' | 'visiting' | 'done'>();
  for (const id of Object.keys(layers)) {
    state.set(id, 'unvisited');
    incoming.set(id, 0);
  }

  const visit = (id: Id, owner: Id | null, pageId: Id, depth: number, path: string): void => {
    const layer = layers[id];
    if (!layer) {
      problems.push(problem('layer/missing', `引用了不存在的图层 ${id}`, path));
      return;
    }
    // Count every owner-list occurrence, including a second reference to an
    // already visited node. DFS state only prevents repeating its descendants.
    incoming.set(id, (incoming.get(id) ?? 0) + 1);
    if (layer.parentId !== owner) {
      problems.push(problem('tree/parent-mismatch', `图层 ${id} 的 parentId(${layer.parentId}) 与 owner(${owner}) 不符`, path));
    }
    if (layer.pageId !== pageId) {
      problems.push(problem('tree/cross-page', `图层 ${id} 的 pageId(${layer.pageId}) 与 owner 页面(${pageId}) 不符`, path));
    }
    if (depth > LIMITS.maxDepth && !(version >= 6 && isBoundTail(layer) && depth === LIMITS.maxDepth + 1 && owner !== null && layers[owner]?.type === 'bubble')) {
      problems.push(problem('tree/too-deep', `树深超过 ${LIMITS.maxDepth}`, path));
      return;
    }
    const st = state.get(id);
    if (st === 'visiting') {
      problems.push(problem('tree/cycle', `检测到环：图层 ${id}`, path));
      return;
    }
    if (st === 'done') return;
    state.set(id, 'visiting');
    checkMatrix(layer.matrix as [number, number, number, number, number, number], `${path}.matrix`, problems);

    if (owner === null) {
      // 根层
    } else {
      const parent = layers[owner];
      if (parent && parent.type !== 'group' && parent.type !== 'panel' && parent.type !== 'bubble') {
        problems.push(problem('tree/bad-parent', `图层 ${id} 的父级 ${owner} 类型 ${parent.type} 不允许包含子层`, path));
      }
    }

    switch (layer.type) {
      case 'pageBackground': {
        if (owner !== null) problems.push(problem('background/parent', '背景必须在页面根层', path));
        const page = pages[pageId];
        if (page) { const budget = validateBackgroundBudget(page.width, page.height, layer.watermark); if (!budget.ok) problems.push(...budget.problems); }
        break;
      }
      case 'group':
        if (layer.dialogue) { const check = validateDialogueGroup({ layers }, id); if (!check.ok) problems.push(...check.problems); }
        for (const c of layer.children) visit(c, id, pageId, depth + 1, `${path}.children`);
        break;
      case 'panel': {
        const geoCheck = validatePanelGeometry(layer);
        if (layer.geometryMode === 'simple' && layer.style.borderRadius !== 0) problems.push(problem('panel/simple-radius', '自由轮廓请用平滑修正，圆角参数必须为0', path));
        if (!geoCheck.ok) {
          problems.push(...geoCheck.problems.map((p) => ({ ...p, path: `${path}.geometry` })));
        }
        for (const c of layer.children) {
          const child = layers[c];
          if (child) {
            if (layer.role === 'leaf' && child.type !== 'image') {
              problems.push(problem('panel/leaf-children', `leaf 分镜 ${id} 只能包含 image，发现 ${child.type}`, path));
            }
            if (layer.role === 'split' && child.type !== 'panel') {
              problems.push(problem('panel/split-children', `split 分镜 ${id} 只能包含 panel，发现 ${child.type}`, path));
            }
            if (child.type === 'image') {
              if ((child.crop || version < 3) && !isIdentity(child.matrix)) {
                problems.push(problem('panel/image-matrix', `分镜内图片 ${c} 的 matrix 必须为单位矩阵`, path));
              }
              if (child.crop === null && version < 3) {
                problems.push(problem('panel/image-crop', `分镜内图片 ${c} 必须有 crop`, path));
              }
            }
            // Legacy convex split containers may deliberately clip oversized children.
            // Free contours use the new full-edge containment contract.
            if (child.type === 'panel' && (layer.geometryMode === 'simple' || child.geometryMode === 'simple') && !polygonContained(layer.geometry, child.geometry)) problems.push(problem('panel/child-outside', '子分镜边界超出父轮廓', path));
            if (child.type === 'panel' && !isIdentity(child.matrix)) {
              problems.push(problem('panel/child-matrix', `切割子分镜 ${c} 的 matrix 必须为单位矩阵`, path));
            }
          }
          visit(c, id, pageId, depth + 1, `${path}.children`);
        }
        break;
      }
      case 'bubble':
        if (layer.children.filter(c => layers[c]?.type === 'text').length > 1) {
          problems.push(problem('bubble/text-count', `气泡 ${id} 至多 1 个文字子层`, path));
        }
        for (const c of layer.children) {
          const child = layers[c];
          if (child && (child.type !== 'text' && !(version >= 6 && child.type === 'bubbleTail') || child.type === 'text' && child.role === 'sfx')) {
            problems.push(problem('bubble/children-type', `气泡 ${id} 只能包含普通文字或绑定尾，发现 ${child.type}`, path));
          }
          visit(c, id, pageId, depth + 1, `${path}.children`);
        }
        if (layer.children.filter(c => layers[c]?.type === 'bubbleTail').length > MANGA.maxTailsPerBubble) problems.push(problem('bubble/tail-count', '同一气泡最多4个尾巴', `layers.${id}.children`));
        break;
      case 'bubbleTail': {
        const check = boundTailOwnerProblem(layers, layer); if (!check.ok) problems.push(...check.problems);
        else {
          const owner = layer.parentId ? layers[layer.parentId] : undefined;
          if (layer.legacySplice && owner?.type === 'bubble' && layer.attachment.mode === 'bubble') {
            if (owner.handDrawn || owner.contour || !['rect','roundRect','circle','cloud','spiky'].includes(owner.shape)) problems.push(problem('tail/legacy-body','新轮廓必须先切换尾巴到新绘制模式',`layers.${id}`));
            else {
              const geometry = buildBubble(owner.shape,owner.width,owner.height,owner.style,{ kind: layer.appearance as 'triangle'|'line', attachU: layer.attachment.attachU, baseWidth: layer.attachment.baseWidth, tip: layer.tip });
              if (!geometry.ok) problems.push(...geometry.problems.map(p=>({...p,path:`layers.${id}`})));
            }
          } else { const geometry = buildTailAppearance({layers},id); if(!geometry.ok)problems.push(...geometry.problems.map(p=>({...p,path:`layers.${id}`}))); }
        }
        break;
      }
      case 'image': {
        if (!assets[layer.assetId]) {
          problems.push(problem('image/asset-missing', `图片 ${id} 引用了不存在的素材 ${layer.assetId}`, path));
        }
        if (layer.sourceRect && assets[layer.assetId] && (layer.sourceRect.x + layer.sourceRect.width > assets[layer.assetId].width + 1e-8 || layer.sourceRect.y + layer.sourceRect.height > assets[layer.assetId].height + 1e-8)) problems.push(problem('image/source-bounds', '裁剪源窗超出原图像素范围', `layers.${id}.sourceRect`));
        if (layer.parentId !== null) {
          const parent = layers[layer.parentId];
          if (parent && parent.type !== 'panel' && layer.crop !== null) {
            problems.push(problem('image/crop-outside-panel', `非分镜子图片 ${id} 不应有 crop`, path));
          }
        }
        break;
      }
      case 'text':
        if (layer.bubbleFrame && (owner === null || layers[owner]?.type !== 'bubble' || layer.role === 'sfx' || layer.bubbleFrame.placement === 'center' && !isIdentity(layer.matrix))) problems.push(problem('text/bubble-frame-owner', '居中对白框必须属于气泡主对白且使用单位矩阵', `layers.${id}.bubbleFrame`));
        // Bubble safe areas are derived and can collapse to zero at the
        // documented minimum size. Keep their content; standalone boxes
        // retain the existing positive-size invariant.
        if ((layer.box.width === 0 || layer.box.height === 0) && (owner === null || layers[owner]?.type !== 'bubble')) {
          problems.push(problem('text/box', `独立文字 ${id} box 非法（需正宽高）`, `layers.${id}`));
        }
        break;
      case 'decoration':
        break;
    }
    state.set(id, 'done');
  };

  for (const pid of pageOrder) {
    const page = pages[pid];
    if (!page) continue;
    const backgrounds = page.roots.filter(id => layers[id]?.type === 'pageBackground');
    if (backgrounds.length > 1 || (backgrounds.length === 1 && page.roots[0] !== backgrounds[0])) problems.push(problem('background/order', '每页最多一个背景，且必须位于最底部', `pages.${pid}.roots`));
    for (const rootId of page.roots) {
      visit(rootId, null, pid, 1, `pages.${pid}.roots`);
    }
  }

  // 每层恰好出现于一个 roots/children 列表：incoming == 1
  for (const [id, count] of incoming) {
    const visited = state.get(id) === 'done' || state.get(id) === 'unvisited';
    if (count === 0 && visited && state.get(id) === 'unvisited') {
      problems.push(problem('tree/orphan', `图层 ${id} 未被任何 roots/children 列表引用`, `layers.${id}`));
    } else if (count > 1) {
      problems.push(problem('tree/duplicate-parent', `图层 ${id} 被引用 ${count} 次`, `layers.${id}`));
    }
  }

  return problems;
}

function parseTemplateNode(v: Record<string, unknown>, path: string, problems: Problem[], version: number): PanelTemplateNode | null {
  if ('editorNumber' in v) { problems.push(problem('template/number', '组件模板不能保存分镜编辑序号', path)); return null; }
  if (v.randomSeed !== undefined && (version < 2 || !validRandomSeed(v.randomSeed))) { problems.push(problem('template/random-seed', '模板来源种子须为32位非负整数且使用项目格式2', path)); return null; }
  if ((v.geometryMode !== undefined && v.geometryMode !== 'convex' && (v.geometryMode !== 'simple' || version < 2)) || !validPointArray(v.geometry, v.geometryMode === 'simple' ? 256 : 64) || !isRecord(v.style)) {
    problems.push(problem('template/node', '模板节点 geometry/style 非法', path));
    return null;
  }
  const style = v.style;
  if (
    !finNum(style.borderRadius) ||
    !finNum(style.borderWidth) ||
    !validRGBA(style.borderColor) ||
    !validRGBA(style.fill)
  ) {
    problems.push(problem('template/style', '模板节点 style 非法', path));
    return null;
  }
  if (!Array.isArray(v.children)) {
    problems.push(problem('template/children', '模板节点 children 非法', path));
    return null;
  }
  const children: PanelTemplateNode[] = [];
  for (let i = 0; i < v.children.length; i++) {
    const child = v.children[i];
    if (!isRecord(child)) {
      problems.push(problem('template/node', '模板子节点非法', `${path}.children[${i}]`));
      return null;
    }
    const parsed = parseTemplateNode(child, `${path}.children[${i}]`, problems, version);
    if (!parsed) return null;
    children.push(parsed);
  }
  const convex = validatePanelGeometry({ geometry: v.geometry as Point[], geometryMode: v.geometryMode as 'convex' | 'simple' | undefined });
  if (v.geometryMode === 'simple' && style.borderRadius !== 0) { problems.push(problem('template/simple-radius', '自由轮廓圆角必须为0', path)); return null; }
  if (!convex.ok) {
    problems.push(...convex.problems.map((p) => ({ ...p, path: `${path}.geometry` })));
    return null;
  }
  return {
    geometry: v.geometry as Point[],
    ...(v.geometryMode ? { geometryMode: v.geometryMode as 'convex' | 'simple' } : {}),
    ...(v.randomSeed !== undefined ? { randomSeed: v.randomSeed as number } : {}),
    style: {
      borderRadius: style.borderRadius as number,
      borderWidth: style.borderWidth as number,
      borderColor: style.borderColor as RGBA,
      fill: style.fill as RGBA,
    },
    children,
  };
}
