import { fail, ok, problem, type BubbleEdgeStyle, type BubbleStrokeBand, type BubbleTextFrame, type Rect, type Result } from './types';
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function parseStrokeBand(v: unknown, path: string): Result<BubbleStrokeBand> {
  if (!record(v) || typeof v.enabled !== 'boolean' || !finite(v.width) || v.width < 0 || v.width > 256 || typeof v.color !== 'string' || !/^#[0-9a-f]{8}$/i.test(v.color)) return fail(problem('bubble/stroke-band', '内外描边需要开关、0～256宽度与RGBA颜色', path));
  return ok({ enabled: v.enabled, width: v.width, color: v.color });
}
export function parseBubbleEdge(v: unknown, path: string): Result<BubbleEdgeStyle> {
  if (!record(v) || !['legacy-baked','normal-offset-v1'].includes(String(v.recipe)) || !finite(v.wobble) || v.wobble < 0 || v.wobble > .03 || !finite(v.seed) || !Number.isInteger(v.seed) || v.seed < 0 || v.seed > 0xffffffff || v.recipe === 'legacy-baked' && v.wobble !== 0) return fail(problem('bubble/edge', '边缘需要合法配方、0～0.03抖动及uint32种子', path));
  return ok({ recipe: v.recipe as BubbleEdgeStyle['recipe'], wobble: v.wobble, seed: v.seed });
}
export function parseSourceRect(v: unknown, path: string): Result<Rect | null> {
  if (v === null) return ok(null);
  if (!record(v) || !finite(v.x) || !finite(v.y) || !finite(v.width) || !finite(v.height) || v.x < 0 || v.y < 0 || v.width <= 0 || v.height <= 0) return fail(problem('image/source-window', '裁剪源窗需要非负原点及有限正尺寸', path));
  return ok({ x: v.x, y: v.y, width: v.width, height: v.height });
}
export function parseBubbleFrame(v: unknown, path: string): Result<BubbleTextFrame> {
  if (!record(v) || !['auto','manual'].includes(String(v.mode)) || !['center','legacy'].includes(String(v.placement)) || v.mode === 'auto' && (v.manualSize !== null || v.placement !== 'center')) return fail(problem('text/bubble-frame', '对白框模式/定位组合非法', path));
  let size: BubbleTextFrame['manualSize'] = null;
  if (v.mode === 'manual') {
    const s = v.manualSize, minimum = v.placement === 'legacy' ? 0 : 1, maximum = v.placement === 'legacy' ? Number.MAX_VALUE : 16384;
    if (!record(s) || !finite(s.width) || !finite(s.height) || s.width < minimum || s.height < minimum || s.width > maximum || s.height > maximum) return fail(problem('text/bubble-frame-size', '手动对白框需要范围内的宽高', path));
    size = { width: s.width, height: s.height };
  }
  return ok({ mode: v.mode as BubbleTextFrame['mode'], placement: v.placement as BubbleTextFrame['placement'], manualSize: size });
}
