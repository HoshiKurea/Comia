import { fail, ok, problem, type Page, type Point, type Rect, type Result } from '../domain/types';

/** Physical measurements remain in mm; artwork and matrices remain in page pixels. */
export interface ManuscriptSettings {
  trim: { widthMm: number; heightMm: number };
  bleedMm: number;
  basicFrame: { widthMm: number; heightMm: number; offsetXMm: number; offsetYMm: number };
  safeInsetMm: number | null;
  cropMarks: boolean;
}
export const DEFAULT_COMIC_DPI = 600;
export const DEFAULT_COMIC_PAGE_COUNT = 8;
export function defaultManuscript(): ManuscriptSettings {
  return { trim: { widthMm: 182, heightMm: 257 }, bleedMm: 5,
    basicFrame: { widthMm: 149, heightMm: 219, offsetXMm: 0, offsetYMm: 0 }, safeInsetMm: null, cropMarks: true };
}
export interface ManuscriptGeometry { trim: Rect; bleed: Rect; basic: Rect; safe: Rect | null }
export interface GuideSegment { a: Point; b: Point; kind: 'trim' | 'bleed' | 'basic' | 'safe' | 'mark' }
export function manuscriptGeometry(page: Pick<Page, 'width' | 'height' | 'dpi'>, settings: ManuscriptSettings): ManuscriptGeometry {
  const k = page.dpi / 25.4;
  const centered = (w: number, h: number, dx = 0, dy = 0): Rect => ({
    x: (page.width - w * k) / 2 + dx * k, y: (page.height - h * k) / 2 + dy * k, width: w * k, height: h * k,
  });
  const trim = centered(settings.trim.widthMm, settings.trim.heightMm), b = settings.bleedMm * k;
  const s = (settings.safeInsetMm ?? 0) * k;
  return { trim, bleed: { x: trim.x - b, y: trim.y - b, width: trim.width + 2 * b, height: trim.height + 2 * b },
    basic: centered(settings.basicFrame.widthMm, settings.basicFrame.heightMm, settings.basicFrame.offsetXMm, settings.basicFrame.offsetYMm),
    safe: settings.safeInsetMm === null ? null : { x: trim.x + s, y: trim.y + s, width: trim.width - 2 * s, height: trim.height - 2 * s } };
}
export function parseManuscript(value: unknown, page: Pick<Page, 'width' | 'height' | 'dpi'>): Result<ManuscriptSettings> {
  const bad = (message: string) => fail(problem('page/manuscript', message));
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('漫画原稿设置格式无效');
  const v = value as ManuscriptSettings;
  const dimension = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 5000;
  const offset = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 5000;
  if (!v.trim || !v.basicFrame || !dimension(v.trim.widthMm) || !dimension(v.trim.heightMm) ||
      !dimension(v.basicFrame.widthMm) || !dimension(v.basicFrame.heightMm) || !offset(v.basicFrame.offsetXMm) || !offset(v.basicFrame.offsetYMm) ||
      typeof v.bleedMm !== 'number' || !Number.isFinite(v.bleedMm) || v.bleedMm < 0 || v.bleedMm > 50 ||
      typeof v.cropMarks !== 'boolean' || (v.safeInsetMm !== null && (typeof v.safeInsetMm !== 'number' || !Number.isFinite(v.safeInsetMm) || v.safeInsetMm <= 0 || v.safeInsetMm > 100))) return bad('原稿尺寸须为正数；出血为0～50mm，安全边距为大于0且不超过100mm');
  const g = manuscriptGeometry(page, v), epsilon = .500001; // The outer canvas alone is rounded to integer px.
  const inside = (inner: Rect, outer: Rect) => inner.x >= outer.x - epsilon && inner.y >= outer.y - epsilon &&
    inner.x + inner.width <= outer.x + outer.width + epsilon && inner.y + inner.height <= outer.y + outer.height + epsilon;
  if (!inside(g.bleed, { x: 0, y: 0, width: page.width, height: page.height })) return bad('成品尺寸加两侧出血必须放得进画布');
  if (g.trim.width < 1 || g.trim.height < 1 || g.basic.width < 1 || g.basic.height < 1 || !inside(g.basic, g.trim)) return bad('基本框（含偏移）必须位于成品框内，框的宽高至少1像素');
  if (g.safe && (g.safe.width < 1 || g.safe.height < 1)) return bad('安全边距过大，安全框须保留至少1像素的宽高');
  return ok({ trim: { ...v.trim }, bleedMm: v.bleedMm, basicFrame: { ...v.basicFrame }, safeInsetMm: v.safeInsetMm, cropMarks: v.cropMarks });
}
/** Straight crop marks are shortened at page edges; they never spill outside the paper. */
export function manuscriptSegments(page: Page): GuideSegment[] {
  if (!page.manuscript) return [];
  const g = manuscriptGeometry(page, page.manuscript), lines: GuideSegment[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, kind: GuideSegment['kind']) => {
    if ((x1 < 0 && x2 < 0) || (x1 > page.width && x2 > page.width) || (y1 < 0 && y2 < 0) || (y1 > page.height && y2 > page.height)) return;
    const a = { x: Math.max(0, Math.min(page.width, x1)), y: Math.max(0, Math.min(page.height, y1)) };
    const b = { x: Math.max(0, Math.min(page.width, x2)), y: Math.max(0, Math.min(page.height, y2)) };
    if (Math.hypot(a.x - b.x, a.y - b.y) > .01) lines.push({ a, b, kind });
  };
  for (const [kind, r] of [['bleed', g.bleed], ['trim', g.trim], ['basic', g.basic], ['safe', g.safe]] as const) if (r) {
    line(r.x, r.y, r.x + r.width, r.y, kind); line(r.x + r.width, r.y, r.x + r.width, r.y + r.height, kind);
    line(r.x + r.width, r.y + r.height, r.x, r.y + r.height, kind); line(r.x, r.y + r.height, r.x, r.y, kind);
  }
  if (!page.manuscript.cropMarks) return lines;
  const k = page.dpi / 25.4, gap = k, length = 5 * k;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const bx = sx < 0 ? g.bleed.x : g.bleed.x + g.bleed.width, by = sy < 0 ? g.bleed.y : g.bleed.y + g.bleed.height;
    const tx = sx < 0 ? g.trim.x : g.trim.x + g.trim.width, ty = sy < 0 ? g.trim.y : g.trim.y + g.trim.height;
    for (const y of new Set([ty, by])) line(bx + sx * gap, y, bx + sx * (gap + length), y, 'mark');
    for (const x of new Set([tx, bx])) line(x, by + sy * gap, x, by + sy * (gap + length), 'mark');
  }
  const cx = page.width / 2, cy = page.height / 2, half = 3 * k;
  for (const side of [-1, 1]) {
    const y = side < 0 ? g.bleed.y : g.bleed.y + g.bleed.height, x = side < 0 ? g.bleed.x : g.bleed.x + g.bleed.width;
    const ym = y + side * (gap + length / 2), xm = x + side * (gap + length / 2);
    line(cx, y + side * gap, cx, y + side * (gap + length), 'mark'); line(cx - half, ym, cx + half, ym, 'mark');
    line(x + side * gap, cy, x + side * (gap + length), cy, 'mark'); line(xm, cy - half, xm, cy + half, 'mark');
  }
  return lines;
}
