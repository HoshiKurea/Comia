import type { Point, Rect } from '../domain/types';

/** n·p <= offset 的半平面（M03） */
export interface HalfPlane {
  normal: Point;
  offset: number;
}

export type PathOp =
  | { op: 'M'; p: Point }
  | { op: 'L'; p: Point }
  | { op: 'Q'; control: Point; p: Point }
  | { op: 'C'; c1: Point; c2: Point; p: Point }
  | { op: 'Z' };

export interface ShapePath {
  ops: PathOp[];
  bounds: Rect;
}

export interface PolygonMetrics {
  signedArea: number;
  centroid: Point;
  bounds: Rect;
}

/** 默认局部 minEdge=1px、minArea=4px²（M03-T02） */
export interface GeometryPolicy {
  minEdge: number;
  minArea: number;
  epsilon: number;
}

export const DEFAULT_GEOMETRY_POLICY: GeometryPolicy = {
  minEdge: 1,
  minArea: 4,
  epsilon: 1e-8,
};
