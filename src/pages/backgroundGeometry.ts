import type { PageBackgroundLayer, Rect, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';

export type BackgroundValues = Pick<PageBackgroundLayer, 'fill' | 'frame' | 'watermark'>;
const color = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{8}$/i.test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export function validateBackgroundValues(input: unknown): Result<BackgroundValues> {
  if (!record(input) || !color(input.fill) || !('frame' in input) || !('watermark' in input)) return fail(problem('background/fields', '背景须包含合法底色、边框和水印'));
  const f = input.frame, w = input.watermark;
  if (f !== null && (!record(f) || !['single', 'double'].includes(String(f.kind)) || !color(f.color) || !number(f.width, 0, 256) || !number(f.insetRatio, 0, .45) || !number(f.gap, 0, 256))) return fail(problem('background/frame', '边框颜色或参数无效'));
  if (w !== null && (!record(w) || typeof w.content !== 'string' || !w.content.trim() || [...w.content].length > 80 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(w.content) || !color(w.color) || !number(w.fontSize, 12, 512) || !number(w.angleDeg, -180, 180) || typeof w.repeat !== 'boolean' || !number(w.spacingX, 16, 4096) || !number(w.spacingY, 16, 4096))) return fail(problem('background/watermark', '水印须为1～80码点单行文字，字号12～512，角度±180，间距16～4096'));
  return ok({ fill: input.fill.toUpperCase(), frame: f === null ? null : structuredClone(f) as BackgroundValues['frame'], watermark: w === null ? null : structuredClone(w) as BackgroundValues['watermark'] });
}
export function backgroundFrames(width: number, height: number, frame: PageBackgroundLayer['frame']): { boxes: Rect[]; effectiveWidth: number; innerOmitted: boolean } {
  if (!frame || frame.width === 0) return { boxes: [], effectiveWidth: 0, innerOmitted: false };
  const d = Math.min(width, height), b = Math.min(frame.width, d / 4), inset = Math.min(frame.insetRatio * d, (d - b - 1) / 2);
  const outer = { x: inset + b / 2, y: inset + b / 2, width: width - 2 * inset - b, height: height - 2 * inset - b };
  const boxes = [outer], offset = b + frame.gap;
  const inner = { x: outer.x + offset, y: outer.y + offset, width: outer.width - 2 * offset, height: outer.height - 2 * offset };
  if (frame.kind === 'double' && inner.width > 0 && inner.height > 0) boxes.push(inner);
  return { boxes, effectiveWidth: b, innerOmitted: frame.kind === 'double' && boxes.length === 1 };
}
export interface WatermarkLayout { centers: { x: number; y: number }[]; angle: number }
export function validateBackgroundBudget(width: number, height: number, w: PageBackgroundLayer['watermark']): Result<void> {
  // Bound the requested grid independently of platform font metrics; loaded fonts may increase spacing only.
  if (w?.repeat && (2 * Math.floor(width / (2 * w.spacingX)) + 1) * (2 * Math.floor(height / (2 * w.spacingY)) + 1) > 4096) return fail(problem('background/watermark-count', '水印超过4096个，请增大间距'));
  return ok(undefined);
}
export function watermarkLayout(width: number, height: number, w: NonNullable<PageBackgroundLayer['watermark']>, textWidth: number, textHeight: number): Result<WatermarkLayout> {
  const angle = w.angleDeg * Math.PI / 180;
  if (!w.repeat) return ok({ centers: [{ x: width / 2, y: height / 2 }], angle });
  const sx = Math.max(w.spacingX, textWidth + w.fontSize / 2), sy = Math.max(w.spacingY, w.fontSize * 1.5);
  if (![textWidth, textHeight].every(v => Number.isFinite(v) && v >= 0)) return fail(problem('background/metrics', '水印字体测量无效'));
  const kMin = -Math.floor(width / (2 * sx)), kMax = -kMin;
  const lMin = -Math.floor(height / (2 * sy)), lMax = -lMin;
  if ((kMax - kMin + 1) * (lMax - lMin + 1) > 4096) return fail(problem('background/watermark-count', '水印超过4096个，请增大间距'));
  const centers = []; for (let l = lMin; l <= lMax; l++) for (let k = kMin; k <= kMax; k++) centers.push({ x: width / 2 + k * sx, y: height / 2 + l * sy });
  return ok({ centers, angle });
}
