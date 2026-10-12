import type { CropParams, Point } from '../domain/types';
import { polyBounds } from '../geometry/polygon';

export interface CropMapping { scale: number; tx: number; ty: number }
function checkedBounds(poly: Point[], assetSize: Point) {
  if (poly.length < 3 || !poly.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) || !Number.isFinite(assetSize.x) || !Number.isFinite(assetSize.y) || assetSize.x <= 0 || assetSize.y <= 0) throw new RangeError('无效的裁剪轮廓或原图尺寸');
  const box = polyBounds(poly);
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width <= 0 || box.height <= 0) throw new RangeError('无效的裁剪尺寸');
  return box;
}

/** All coordinates here are local to the owning panel. */
export function resolveCrop(poly: Point[], assetSize: Point, crop: CropParams): CropMapping {
  const box = checkedBounds(poly, assetSize);
  if (box.width <= 0 || box.height <= 0 || assetSize.x <= 0 || assetSize.y <= 0 || crop.zoom < 1 || !Number.isFinite(crop.zoom)) throw new RangeError('无效的裁剪尺寸或缩放');
  const scale = Math.max(box.width / assetSize.x, box.height / assetSize.y) * crop.zoom;
  if (![crop.focus.u, crop.focus.v, scale, assetSize.x * scale, assetSize.y * scale].every(Number.isFinite)) throw new RangeError('无效的裁剪焦点或映射溢出');
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const tx = Math.min(box.x, Math.max(box.x + box.width - assetSize.x * scale, cx - crop.focus.u * assetSize.x * scale));
  const ty = Math.min(box.y, Math.max(box.y + box.height - assetSize.y * scale, cy - crop.focus.v * assetSize.y * scale));
  return { scale, tx, ty };
}

export function cropFromMapping(poly: Point[], assetSize: Point, mapping: CropMapping): CropParams {
  const box = checkedBounds(poly, assetSize);
  if (![mapping.scale, mapping.tx, mapping.ty, assetSize.x * mapping.scale, assetSize.y * mapping.scale].every(Number.isFinite)) throw new RangeError('无效的裁剪映射');
  if (box.width <= 0 || box.height <= 0 || assetSize.x <= 0 || assetSize.y <= 0 || mapping.scale <= 0) throw new RangeError('无效的裁剪映射');
  const min = Math.max(box.width / assetSize.x, box.height / assetSize.y);
  const zoom = mapping.scale / min;
  if (zoom < 1 - 1e-8) throw new RangeError('原图映射不能覆盖新分镜');
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  return { focus: { u: (cx - mapping.tx) / (assetSize.x * mapping.scale), v: (cy - mapping.ty) / (assetSize.y * mapping.scale) }, zoom: Math.max(1, zoom) };
}

export function panCrop(poly: Point[], assetSize: Point, start: CropParams, delta: Point): CropParams {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) throw new RangeError('裁剪位移须为有限数字');
  const map = resolveCrop(poly, assetSize, start);
  const box = polyBounds(poly);
  const next = { ...map, tx: Math.min(box.x, Math.max(box.x + box.width - assetSize.x * map.scale, map.tx + delta.x)), ty: Math.min(box.y, Math.max(box.y + box.height - assetSize.y * map.scale, map.ty + delta.y)) };
  return cropFromMapping(poly, assetSize, next);
}

export function zoomCrop(poly: Point[], assetSize: Point, start: CropParams, newZoom: number, anchor: Point, maximum = Math.max(16, start.zoom)): CropParams {
  if (![newZoom, anchor.x, anchor.y, maximum].every(Number.isFinite) || maximum < 1) throw new RangeError('缩放与锚点须为有限数字');
  const zoom = Math.min(Math.max(16, maximum), Math.max(1, newZoom));
  const old = resolveCrop(poly, assetSize, start);
  const box = polyBounds(poly);
  const scale = Math.max(box.width / assetSize.x, box.height / assetSize.y) * zoom;
  const ix = (anchor.x - old.tx) / old.scale, iy = (anchor.y - old.ty) / old.scale;
  const tx = Math.min(box.x, Math.max(box.x + box.width - assetSize.x * scale, anchor.x - ix * scale));
  const ty = Math.min(box.y, Math.max(box.y + box.height - assetSize.y * scale, anchor.y - iy * scale));
  return cropFromMapping(poly, assetSize, { scale, tx, ty });
}

export function reflowCrop(newPoly: Point[], assetSize: Point, crop: CropParams): CropParams {
  const mapping = resolveCrop(newPoly, assetSize, crop);
  return cropFromMapping(newPoly, assetSize, mapping);
}
