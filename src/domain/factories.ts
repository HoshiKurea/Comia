/**
 * M01-T02：安全工厂。初始化所有必需值；默认名称使用同类递增编号。
 * 新 ID 永不复用；原始导入 ID 冲突时报错，不静默重命名。
 */
import type {
  BubbleLayer,
  DecorationLayer,
  GroupLayer,
  Id,
  ImageLayer,
  Layer,
  Page,
  PageBackgroundLayer,
  PanelLayer,
  Project,
  RGBA,
  TextLayer,
} from './types';
import { newId } from './id';
import { completeBubbleStyle } from './bubbleStyleDefaults';

export const DEFAULT_DPI = 300;
export const DEFAULT_BACKGROUND: RGBA = '#FFFFFFFF';
export const DEFAULT_FONT_FAMILY = 'Noto Sans CJK SC';

/** A4 210×297mm @300DPI → px=round(mm*dpi/25.4) */
export function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm * dpi) / 25.4);
}

export function createPage(opts?: {
  name?: string;
  width?: number;
  height?: number;
  dpi?: number;
  background?: RGBA;
}): Page {
  const dpi = opts?.dpi ?? DEFAULT_DPI;
  return {
    id: newId(),
    name: opts?.name ?? '第1页',
    width: opts?.width ?? mmToPx(210, dpi), // A4 竖
    height: opts?.height ?? mmToPx(297, dpi),
    dpi,
    ...(opts?.background !== undefined ? { background: opts.background } : {}),
    roots: [],
  };
}

export function createProject(options?: { background?: boolean }): Project {
  const page = createPage();
  const background = createPageBackground(page.id);
  if (options?.background !== false) page.roots.push(background.id);
  return {
    schemaVersion: 10,
    nextPanelNumber: 1,
    id: newId(),
    name: '未命名项目',
    pageOrder: [page.id],
    pages: { [page.id]: page },
    layers: options?.background === false ? {} : { [background.id]: background },
    assets: {},
    libraryAssetIds: [],
    assetLibrary: { folders: {}, assetFolder: {} },
    templates: {},
    settings: { readingDirection: 'rtl', defaultDpi: DEFAULT_DPI },
  };
}

// ---------- 同类递增编号 ----------

const counters: Record<string, number> = {};

/** 从已加载项目同步计数器，保证新名称不与现有重号（允许重复名，但编号继续） */
export function syncCounters(project: Project): void {
  const re = /^(分镜|图片|气泡|尾巴|文字|装饰|编组) (\d+)$/;
  for (const layer of Object.values(project.layers)) {
    const m = re.exec(layer.name);
    if (m) {
      const kind = m[1];
      counters[kind] = Math.max(counters[kind] ?? 0, parseInt(m[2], 10));
    }
  }
  for (const page of Object.values(project.pages)) {
    const m = /^第(\d+)页$/.exec(page.name);
    if (m) counters['页'] = Math.max(counters['页'] ?? 0, parseInt(m[1], 10));
  }
}

function nextName(kind: string): string {
  counters[kind] = (counters[kind] ?? 0) + 1;
  return `${kind} ${counters[kind]}`;
}

export function resetCounters(): void {
  for (const k of Object.keys(counters)) delete counters[k];
}

// ---------- 图层工厂 ----------

const PANEL_RECT = [
  { x: 0, y: 0 },
  { x: 600, y: 0 },
  { x: 600, y: 400 },
  { x: 0, y: 400 },
];

function baseLayer(pageId: Id, name: string) {
  return {
    id: newId(),
    pageId,
    parentId: null as Id | null,
    name,
    visible: true,
    locked: false,
    colorLabel: null,
    matrix: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number],
  };
}

export function createPageBackground(pageId: Id, fill = DEFAULT_BACKGROUND): PageBackgroundLayer {
  return { ...baseLayer(pageId, '页面背景'), type: 'pageBackground', fill, frame: null, watermark: null };
}

/** createLayer(kind, pageId)：初始化所有必需值。位置/尺寸由调用方命令调整。 */
export function createLayer(kind: Layer['type'], pageId: Id, nameOverride?: string): Layer {
  switch (kind) {
    case 'pageBackground': return createPageBackground(pageId);
    case 'group': {
      const base = baseLayer(pageId, nameOverride ?? nextName('编组'));
      const layer: GroupLayer = { ...base, type: 'group', children: [] };
      return layer;
    }
    case 'panel': {
      const base = baseLayer(pageId, nameOverride ?? nextName('分镜'));
      const layer: PanelLayer = {
        ...base,
        type: 'panel',
        nameMode: nameOverride === undefined ? 'automatic' : 'custom',
        geometry: PANEL_RECT.map((p) => ({ ...p })),
        children: [],
        role: 'leaf',
        style: { borderRadius: 0, borderWidth: 4, borderColor: '#000000FF', fill: '#FFFFFF00' },
      };
      return layer;
    }
    case 'image': {
      const base = baseLayer(pageId, nameOverride ?? nextName('图片'));
      const layer: ImageLayer = {
        ...base,
        type: 'image',
        assetId: '',
        width: 0,
        height: 0,
        crop: null,
        sourceRect: null,
      };
      return layer;
    }
    case 'bubble': {
      const base = baseLayer(pageId, nameOverride ?? nextName('气泡'));
      const layer: BubbleLayer = {
        ...base,
        type: 'bubble',
        width: 300,
        height: 180,
        shape: 'roundRect',
        handDrawn: null,
        contour: null,
        edgeStyle: { recipe: 'normal-offset-v1', wobble: 0, seed: 42 },
        style: completeBubbleStyle({ fill: '#FFFFFFFF', borderWidth: 3, borderColor: '#000000FF', radius: 24 }),
        children: [],
      };
      return layer;
    }
    case 'bubbleTail': return {
      ...baseLayer(pageId, nameOverride ?? nextName('尾巴')), type: 'bubbleTail',
      appearance: 'triangle', attachment: { mode: 'free', baseA: { x: 0, y: 0 }, baseB: { x: 24, y: 0 } },
      tip: { x: 12, y: 60 }, route: { kind: 'straight' }, beads: 4, zigzag: 4,
      style: completeBubbleStyle({ fill: '#FFFFFFFF', borderWidth: 3, borderColor: '#000000FF', radius: 0 }), stroke: { pressure: 0, seed: 42 }, legacySplice: false,
    };
    case 'text': {
      const base = baseLayer(pageId, nameOverride ?? nextName('文字'));
      const layer: TextLayer = {
        ...base,
        type: 'text',
        role: 'plain',
        effects: null,
        box: { x: 0, y: 0, width: 240, height: 120 },
        text: {
          content: '双击编辑文字',
          direction: 'horizontal',
          font: { family: DEFAULT_FONT_FAMILY, size: 32, color: '#000000FF', bold: false, italic: false },
          align: 'start',
          lineHeight: 1.2,
          letterSpacing: 0,
        },
      };
      return layer;
    }
    case 'decoration': {
      const base = baseLayer(pageId, nameOverride ?? nextName('装饰'));
      const layer: DecorationLayer = {
        ...base,
        type: 'decoration',
        spec: {
          kind: 'speed',
          width: 400,
          height: 240,
          count: 24,
          angleDeg: 0,
          seed: Math.floor(Math.random() * 0xffffffff),
          strokeWidth: 2,
          color: '#000000FF',
        },
      };
      return layer;
    }
  }
}
