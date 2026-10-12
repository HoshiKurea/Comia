/**
 * 可配置限值（M01 全局决策）。
 * 这些是实施规格提出的可配置初值，不是原需求承诺。
 */
import type { Limits } from './types';

export const LIMITS: Limits = {
  maxLayers: 5000, // 图层 ≤5000/项目
  maxDepth: 16, // 树深 ≤16
  maxAssetBytes: 50 * 1024 * 1024, // 单原图 ≤50 MiB
  maxAssetPixels: 40_000_000, // 解码后 ≤40MP
  maxProjectBytes: 256 * 1024 * 1024, // 单文件项目 ≤256 MiB
  maxHistory: 200, // 历史保留最近 200 个事务
};

export const LIMIT_ASSET_TOTAL_BYTES = 512 * 1024 * 1024; // 项目累计素材原始字节 ≤512 MiB
export const LIMIT_TEXT_CODEPOINTS = 10000; // 文本 ≤10000 个 Unicode 码点/对象
export const LIMIT_LAYER_NAME_CODEPOINTS = 80;
export const LIMIT_PAGE_NAME_CODEPOINTS = 80;

/** 页面每轴 16～16384 px */
export const PAGE_AXIS = { min: 16, max: 16384 } as const;

/** 编辑器对象局部 W/H 范围（M05-T03） */
export const OBJECT_WH = { min: 16, max: 16384 } as const;

/** 自由对象矩阵线性最大伸缩限制与平移限制（M01 不变量） */
export const MATRIX_SCALE = { min: 1e-4, max: 1e4 } as const;
export const MATRIX_TRANSLATE_MAX = 1e7;

/** DPI 范围（M12-T04） */
export const DPI = { min: 72, max: 600 } as const;

/** 几何策略默认值（M03-T02）：局部 minEdge=1px、minArea=4px² */
export const GEOMETRY_POLICY = { minEdge: 1, minArea: 4, epsilon: 1e-8 } as const;

/** 分镜样式范围（M07-T04） */
export const PANEL_STYLE = {
  radius: { min: 0, max: 4096 },
  borderWidth: { min: 0, max: 256 },
} as const;

/** 切割参数范围（M07-T05） */
export const CUT = {
  ratio: { min: 0.01, max: 0.99 },
  gap: { min: 0, max: 256 },
} as const;

/** 裁剪缩放交互范围（M08-T03）；切割继承可超限存储 */
export const CROP_ZOOM_INTERACTIVE_MAX = 16;

/** 气泡尾部范围（M10-T02） */
export const TAIL = {
  baseWidth: { min: 4, max: 128 },
  tipMinDistance: 4,
} as const;

/** BG-Q01..03 remain provisional implementation defaults authorized 2026-10-05. */
export const MANGA = {
  maxTailsPerBubble: 4, maxBoundTails: 20000, maxDialogueMembers: 16,
  contourNodes: { min: 8, max: 32 }, seamRadius: { min: 0, max: 24, default: 4 },
  overlapOpacity: { min: 0, max: 1, default: .65 },
  booleanEdgesPerMember: 8192, booleanEdgesPerGroup: 65536, booleanDepth: 20,
} as const;

/** 字体排版范围（M11-T02） */
export const TEXT_STYLE = {
  fontSize: { min: 1, max: 512 },
  lineHeight: { min: 1, max: 3 },
} as const;

/** 装饰参数范围（M09-T03） */
export const DECORATION = {
  count: { min: 2, max: 256 },
  size: { min: 16, max: 16384 },
  strokeWidth: { min: 0, max: 64 },
  innerRatio: { min: 0.05, max: 0.9 },
} as const;

/** PNG/PDF 导出预算（M14-T01，待 M15 设备验证） */
export const EXPORT_BUDGET = {
  maxSide: 8192,
  maxPixels: 40_000_000,
  maxEstimatedBytes: 384 * 1024 * 1024,
  pdfTotalBytes: 256 * 1024 * 1024,
} as const;

/** 视口缩放范围（M05-T06） */
export const VIEWPORT_ZOOM = { min: 0.05, max: 8 } as const;
