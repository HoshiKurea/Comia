/**
 * Comia 统一数据模型（M01）。
 * 规格来源：docs/implementation/01-foundation.md M01 数据结构。
 * 所有跨模块类型契约以本文件为唯一权威定义；其他模块只允许 import type。
 */

export type Id = string; // crypto.randomUUID；一项目内所有 page/layer/asset ID 不重复

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** [a,b,c,d,e,f]：M=[a c e; b d f; 0 0 1] */
export type Mat = readonly [number, number, number, number, number, number];

export interface Problem {
  code: string;
  message: string;
  path?: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; problems: Problem[] };

/** 规范化 #RRGGBBAA，alpha=00 即透明 */
export type RGBA = string;

export type LabelColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | null;

export interface LayerBase {
  id: Id;
  pageId: Id;
  parentId: Id | null;
  name: string;
  visible: boolean;
  locked: boolean;
  colorLabel: LabelColor;
  matrix: Mat;
  presentation?: LayerPresentation;
}

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'colorDodge' | 'colorBurn' | 'hardLight' | 'softLight' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';
export interface StrokePresentation {
  alignment: 'center' | 'inside' | 'outside';
  dash: 'solid' | 'dash' | 'dot' | 'dashdot';
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
  miterLimit: number;
  edgeWidths?: number[];
}
export interface LayerEffect {
  id: Id; kind: 'shadow' | 'outline' | 'outerGlow'; enabled: boolean;
  color: RGBA; opacity: number; width: number; blur: number; offsetX: number; offsetY: number;
}
/** Matrix remains authoritative. A factorization hint is used only while its reconstructed linear matrix matches. */
export interface TransformHint { rotation: number; sx: number; sy: number; skewX: number; skewY: number }
export interface LayerPresentation {
  opacity: number; blendMode: BlendMode; fillBlendMode: BlendMode; strokeBlendMode: BlendMode;
  stroke: StrokePresentation; effects: LayerEffect[]; transformHint?: TransformHint;
}
export interface AppearancePreset {
  id: Id; name: string; presentation: LayerPresentation;
  paint?: { fill: RGBA; borderColor: RGBA; borderWidth: number; radius: number };
}

export interface GroupLayer extends LayerBase {
  type: 'group';
  children: Id[];
  dialogue?: DialogueSpec;
}

export interface PanelStyle {
  borderRadius: number;
  borderWidth: number;
  borderColor: RGBA;
  fill: RGBA;
}

export interface PanelLayer extends LayerBase {
  type: 'panel';
  editorNumber?: number;
  nameMode?: 'automatic' | 'custom'; // format9; never infer after an explicit rename
  geometryMode?: 'convex' | 'simple'; // omitted in legacy/default convex data
  randomSeed?: number; // generation provenance; stored geometry remains authoritative after editing
  geometry: Point[];
  children: Id[];
  role: 'leaf' | 'split';
  style: PanelStyle;
}

/** zoom=s/sMin，>=1；focus 是分镜 bbox 中心对应的归一原图位置 */
export interface CropParams {
  focus: { u: number; v: number };
  zoom: number;
}

export interface ImageLayer extends LayerBase {
  type: 'image';
  assetId: Id;
  width: number;
  height: number;
  crop: CropParams | null; // legacy cover mapping; null allows independent transforms, also inside panels
  sourceRect?: Rect | null; // format9 window in normalized render-resource pixels
  mask?: ImageMask;
  panelClip?: PanelClipPolicy;
}

export interface BreakoutRegion {
  shape: 'rect' | 'ellipse' | 'polygon';
  geometry: Point[];
  matrix: Mat;
}
export type PanelClipPolicy =
  | { mode: 'normal' | 'whole'; region?: BreakoutRegion }
  | { mode: 'partial'; region: BreakoutRegion };

/** Non-destructive clip in image-local coordinates, independent from source pixels. */
export interface ImageMask {
  enabled: boolean;
  linked: boolean;
  shape: 'rect' | 'ellipse' | 'polygon';
  geometry: Point[];
  matrix: Mat;
}

export type LegacyBubbleShape = 'rect' | 'roundRect' | 'circle' | 'cloud' | 'spiky';
export type BubbleShape = LegacyBubbleShape | 'handOval' | 'handPolygon' | 'wave' | 'freehand';

export interface InkSample extends Point { pressure: number; dt: number }
export interface InkStroke {
  id: Id; tool: 'pen' | 'eraser'; points: InkSample[]; color: RGBA;
  width: number; opacity: number; pressureMode: 'fixed' | 'pen';
}
export interface BubbleShapeEdit { id: Id; mode: 'add' | 'subtract'; stroke: InkStroke }
export interface FreehandBubbleSourceV1 {
  version: 1; width: number; height: number; baseRing: Point[]; edits: BubbleShapeEdit[];
}
export interface FreehandBubbleSourceV2 {
  version: 2; width: number; height: number; baseRing: Point[]; edits: BubbleShapeEdit[]; ink: InkStroke[];
}
export type FreehandBubbleSource = FreehandBubbleSourceV1 | FreehandBubbleSourceV2;
export interface FreehandMaterialSource { version: 1; width: number; height: number; strokes: InkStroke[] }

export interface HandDrawnStyle {
  preset: 'soft' | 'rough' | 'custom';
  seed: number;
  wobble: number;
  irregularity: number;
  pressure: number;
}
export interface BubbleContour { nodes: Point[]; tension: number }
export type TailRoute = { kind: 'straight' } | { kind: 'polyline'; knots: Point[] } | { kind: 'spline'; c1: Point; c2: Point };
export interface BubbleTailLayer extends LayerBase {
  type: 'bubbleTail';
  appearance: 'triangle' | 'line' | 'curved' | 'thought' | 'jagged' | 'flat';
  attachment: { mode: 'bubble'; attachU: number; baseWidth: number } | { mode: 'free'; baseA: Point; baseB: Point };
  tip: Point;
  route: TailRoute;
  beads: number;
  zigzag: number;
  style: BubbleStyle | null;
  /** Free tails preserve effective pressure on detach; bound tails inherit it. */
  stroke?: { pressure: number; seed: number } | null;
  legacySplice: boolean;
}
export interface DialogueLink { from: Id; to: Id; width: number; bend: number }
export interface DialogueSpec {
  mode: 'connector' | 'fused' | 'overlap';
  links: DialogueLink[];
  seamRadius: number;
  overlapOpacity: number;
  fusionStyle: BubbleStyle;
  fusionPressure: number;
  seed: number;
}
export interface TextEffects {
  outlineColor: RGBA;
  outlineWidth: number;
  shearDeg: number;
  deformation: 'none' | 'arc' | 'wave' | 'impact';
  amount: number;
  cycles: number;
  recipe: 'layout' | 'legacy-sfx-v5';
}

export interface BubbleStyle {
  fill: RGBA;
  borderWidth: number;
  borderColor: RGBA;
  radius: number;
  innerStroke?: BubbleStrokeBand;
  outerStroke?: BubbleStrokeBand;
}
export interface BubbleStrokeBand { enabled: boolean; width: number; color: RGBA }
export interface BubbleEdgeStyle { recipe: 'legacy-baked' | 'normal-offset-v1'; wobble: number; seed: number }
export interface BubbleTextFrame { mode: 'auto' | 'manual'; manualSize: { width: number; height: number } | null; placement: 'center' | 'legacy' }

/** kind='triangle'|'line'；attachU 沿轮廓弧长比例；tip 为局部坐标 */
export interface BubbleTail {
  kind: 'triangle' | 'line';
  attachU: number;
  baseWidth: number;
  tip: Point;
}

export interface BubbleLayer extends LayerBase {
  type: 'bubble';
  width: number;
  height: number;
  shape: BubbleShape;
  freehandSource?: FreehandBubbleSource;
  /** Only decoded formats1..5; format6 rejects this property, even null. */
  tail?: BubbleTail | null;
  handDrawn?: HandDrawnStyle | null;
  contour?: BubbleContour | null;
  edgeStyle?: BubbleEdgeStyle;
  style: BubbleStyle;
  children: Id[]; // 0/1 plain TextLayer plus 0..4 bound BubbleTailLayer in format6
}

export interface TextContent {
  /** Format9: independent copies retain word wrapping without bubble ownership. */
  wrapMode?:'grapheme'|'word';
  content: string;
  direction: 'horizontal' | 'vertical';
  font: {
    family: string;
    size: number;
    color: RGBA;
    bold: boolean;
    italic: boolean;
  };
  align: 'start' | 'center' | 'end';
  lineHeight: number;
  letterSpacing: number;
}

export interface TextLayer extends LayerBase {
  type: 'text';
  box: Rect;
  bubbleFrame?: BubbleTextFrame;
  text: TextContent;
  /** Required in format6; omitted only in decoded legacy documents. */
  role?: 'plain' | 'sfx';
  effects?: TextEffects | null;
}

/** speed=速度线 focus=集中线 sfx=音效字 */
export interface SpeedBrushOptions {
  radius: number;
  density: number;
  strokeWidth: number;
  irregularity: number;
  color: RGBA;
}
export interface SpeedBrushSpec {
  kind: 'speed-brush';
  width: number;
  height: number;
  color: RGBA;
  seed: number;
  options: SpeedBrushOptions;
  centerline: Point[];
  ribbons: Point[][];
}
export type DecorationSpec =
  | SpeedBrushSpec
  | { kind: 'shape'; width: number; height: number; geometry: Point[]; geometryMode: 'convex' | 'simple'; style: PanelStyle }
  | {
      kind: 'speed';
      width: number;
      height: number;
      count: number;
      angleDeg: number;
      seed: number;
      strokeWidth: number;
      color: RGBA;
    }
  | {
      kind: 'focus';
      width: number;
      height: number;
      count: number;
      innerRatio: number;
      seed: number;
      strokeWidth: number;
      color: RGBA;
    }
  | {
      kind: 'sfx';
      width: number;
      height: number;
      content: string;
      fontFamily: string;
      fontSize: number;
      color: RGBA;
      outline: RGBA;
      outlineWidth: number;
    };

export interface DecorationLayer extends LayerBase {
  type: 'decoration';
  spec: DecorationSpec;
}

export interface PageBackgroundLayer extends LayerBase {
  type: 'pageBackground';
  fill: RGBA;
  frame: null | { kind: 'single' | 'double'; color: RGBA; width: number; insetRatio: number; gap: number };
  watermark: null | { content: string; color: RGBA; fontSize: number; angleDeg: number; repeat: boolean; spacingX: number; spacingY: number };
}

export type Layer = GroupLayer | PanelLayer | ImageLayer | BubbleLayer | BubbleTailLayer | TextLayer | DecorationLayer | PageBackgroundLayer;

export interface Page {
  id: Id;
  name: string;
  width: number;
  height: number;
  dpi: number;
  manuscript?: import('../pages/manuscript').ManuscriptSettings;
  background?: RGBA; // legacy formats only; schema4 paints the real bottom layer
  roots: Id[]; // 后元素在上，唯一根层顺序
}

export interface AssetMeta {
  drawingSource?: FreehandMaterialSource;
  drawingSourceHash?: string;
  id: Id;
  name: string;
  originalMime: string;
  originalHash: string;
  renderHash: string;
  renderMime: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  originalBytes: number;
  renderBytes: number;
  framePolicy: 'still' | 'first-frame';
  normalizedOrientation: true;
}

/** 只保存几何树和样式，剔除图片/asset 引用/原 ID */
export interface PanelTemplateNode {
  geometryMode?: 'convex' | 'simple';
  randomSeed?: number;
  geometry: Point[];
  style: PanelStyle;
  children: PanelTemplateNode[];
}

export interface LegacyUserTemplate {
  id: Id;
  name: string;
  root: PanelTemplateNode;
}

export interface AssetFolder { id: Id; name: string; parentId: Id | null }
export interface AssetLibraryOrganization { folders: Record<Id, AssetFolder>; assetFolder: Record<Id, Id | null> }
export type PresetLayer = Exclude<Layer, ImageLayer | PageBackgroundLayer>;
type PresetNodeOf<T extends PresetLayer> = T extends PresetLayer
  ? Omit<T, 'pageId' | 'editorNumber' | 'locked'> : never;
/** UUIDs are local to this recipe; each placement remaps every reference. */
export type PresetNode = PresetNodeOf<PresetLayer>;
export interface ScenePresetRecipe { kind: 'scene'; roots: Id[]; nodes: Record<Id, PresetNode>; bounds: Rect }
export interface BrushPresetRecipe { kind: 'speed-brush'; options: SpeedBrushOptions }
export interface BubbleBrushOptions {
  borderWidth:number;borderColor:RGBA;fill:RGBA;smoothing:number;simplifyScreenPx:number;closeScreenPx:number;
  handDrawn:HandDrawnStyle|null;innerStroke:BubbleStrokeBand;outerStroke:BubbleStrokeBand;
}
export interface BubbleBrushRecipe {kind:'bubble-brush';options:BubbleBrushOptions}
export interface ComponentPreset { id: Id; name: string; recipe: ScenePresetRecipe | BrushPresetRecipe | BubbleBrushRecipe }
export type UserTemplate = LegacyUserTemplate | ComponentPreset;

export interface Project {
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
  nextPanelNumber?: number; // Format5/6 compatibility cache: max(live leaf numbers)+1, refreshed by transactions.
  id: Id;
  name: string;
  pageOrder: Id[];
  pages: Record<Id, Page>;
  layers: Record<Id, Layer>;
  assets: Record<Id, AssetMeta>;
  libraryAssetIds?: Id[]; // required in schema3; absent only in legacy documents
  assetLibrary?: AssetLibraryOrganization; // required in format8; UI navigation is not stored here
  templates: Record<Id, UserTemplate>;
  stylePresets?: Record<Id, AppearancePreset>;
  settings: {
    readingDirection: 'ltr' | 'rtl';
    defaultDpi: number;
  };
}

export interface Viewport {
  zoom: number;
  pan: Point;
}

export interface SessionState {
  activePageId: Id;
  selection: Id[];
  scopeId: Id | null;
  viewportByPage: Record<Id, Viewport>;
  expanded: Id[];
  filter: { name: string; color: LabelColor };
  theme: 'light' | 'dark' | 'system';
  snap16: boolean;
}

export interface Limits {
  maxLayers: number;
  maxDepth: number;
  maxAssetBytes: number;
  maxAssetPixels: number;
  maxProjectBytes: number;
  maxHistory: number;
}

export const LAYER_TYPES = ['group', 'panel', 'image', 'bubble', 'bubbleTail', 'text', 'decoration', 'pageBackground'] as const;

// ---------- Result 辅助 ----------

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail(...problems: Problem[]): Result<never> {
  return { ok: false, problems };
}

export function problem(code: string, message: string, path?: string): Problem {
  return path === undefined ? { code, message } : { code, message, path };
}

/** 取第一个错误信息用于 UI 显示 */
export function firstMessage(result: Result<unknown>): string {
  if (result.ok) return '';
  return result.problems.map((p) => (p.path ? `${p.path}: ${p.message}` : p.message)).join('\n');
}
