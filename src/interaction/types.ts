/**
 * M05 交互类型契约。
 */
import type { Id, Layer, Point } from '../domain/types';

export type ToolMode = 'select' | 'panel-cut' | 'image-crop' | 'image-mask' | 'marquee' | 'lasso' | 'geometry' | 'crop' | 'text' | 'speed-brush' | 'bubble-brush';

export type GestureKind = 'move' | 'resize' | 'rotate' | 'vertex' | 'edge' | 'crop' | 'tail' | 'create';

export interface PointerGesture {
  pointerId: number;
  kind: GestureKind;
  startClient: Point;
  startPage: Point;
  startLayers: Record<Id, Layer>;
  primaryId: Id;
  moved: boolean;
}

export interface SnapCandidate {
  axis: 'x' | 'y';
  value: number;
  sourceId: Id | null;
  kind: 'edge' | 'center';
}

export interface SnapResult {
  delta: Point;
  guides: SnapCandidate[];
}

export interface TransformInput {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotationDeg?: number;
}

export type ResizeHandleId =
  | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** 结构化 2D 上下文接口：drawPlan 同时支持原生 canvas 与 Konva Context */
export interface Ctx2D {
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  arc(x: number, y: number, r: number, start: number, end: number, ccw?: boolean): void;
  clip(fillRule?: 'nonzero' | 'evenodd'): void;
  fill(): void;
  stroke(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  drawImage(img: CanvasImageSource, dx: number, dy: number, dw?: number, dh?: number): void;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  measureText(text: string): TextMetrics;
}

/** 命中测试范围 */
export interface HitScope {
  pageId: Id;
  /** 限定在某个容器 scope 内（组内编辑） */
  scopeId: Id | null;
}
