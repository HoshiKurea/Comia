import { fail, ok, problem, type Id, type ImageLayer, type Project, type Rect, type Result } from '../domain/types';
import { multiply, translation } from '../geometry/matrix';
import { validateTransform } from '../domain/validate';
import { freeImage } from './freeImage';

function checkedSource(project: Project, id: Id): Result<ImageLayer> {
  const image = project.layers[id];
  if (image?.type !== 'image' || !project.assets[image.assetId]) return fail(problem('trim/image', '裁剪素材或原图资源已不存在'));
  try { return ok(freeImage(project, id)); } catch { return fail(problem('trim/cover', '无法保持旧框内图片的映射，裁剪未执行')); }
}
function shiftedRegions(image: ImageLayer, x: number, y: number): ImageLayer {
  const shift = translation(x, y);
  return { ...image,
    ...(image.mask ? { mask: { ...image.mask, matrix: multiply(shift, image.mask.matrix) } } : {}),
    ...(image.panelClip?.region ? { panelClip: { ...image.panelClip, region: { ...image.panelClip.region, matrix: multiply(shift, image.panelClip.region.matrix) } } } : {}),
  };
}
function checkedTransforms(image: ImageLayer): Result<ImageLayer> {
  for (const m of [image.matrix, ...(image.mask ? [image.mask.matrix] : []), ...(image.panelClip?.region ? [image.panelClip.region.matrix] : [])]) { const r = validateTransform(m); if (!r.ok) return r; }
  return ok(image);
}
/** Crop one placed instance. The resource and all other instances are immutable. */
export function trimImage(project: Project, id: Id, rect: Rect): Result<ImageLayer> {
  if (![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return fail(problem('trim/rect', '裁剪范围需要有限坐标和正尺寸'));
  const result = checkedSource(project, id); if (!result.ok) return result;
  const image = result.value, asset = project.assets[image.assetId];
  const x = Math.max(0, rect.x), y = Math.max(0, rect.y), right = Math.min(image.width, rect.x + rect.width), bottom = Math.min(image.height, rect.y + rect.height), w = right - x, h = bottom - y;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return fail(problem('trim/empty', '裁剪与素材的交集至少需要1×1局部像素'));
  if (x === 0 && y === 0 && w === image.width && h === image.height) return ok(project.layers[id] as ImageLayer);
  const s = image.sourceRect ?? { x: 0, y: 0, width: asset.width, height: asset.height };
  const window = { x: s.x + x * s.width / image.width, y: s.y + y * s.height / image.height, width: w * s.width / image.width, height: h * s.height / image.height };
  if (![window.x,window.y,window.width,window.height].every(Number.isFinite) || window.x < 0 || window.y < 0 || window.width <= 0 || window.height <= 0 || window.x + window.width > asset.width + 1e-8 || window.y + window.height > asset.height + 1e-8) return fail(problem('trim/source', '裁剪源窗超出原图像素范围'));
  return checkedTransforms(shiftedRegions({ ...image, width: w, height: h, sourceRect: window, matrix: multiply(image.matrix, translation(x, y)) }, -x, -y));
}
export function restoreImageSourceWindow(project: Project, id: Id): Result<ImageLayer> {
  const result = checkedSource(project, id); if (!result.ok) return result;
  const image = result.value, s = image.sourceRect;
  if (!s) return ok(project.layers[id] as ImageLayer);
  const asset = project.assets[image.assetId], sx = image.width / s.width, sy = image.height / s.height, x = s.x * sx, y = s.y * sy;
  return checkedTransforms(shiftedRegions({ ...image, width: asset.width * sx, height: asset.height * sy, sourceRect: null, matrix: multiply(image.matrix, translation(-x, -y)) }, x, y));
}
