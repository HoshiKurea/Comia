import type { Page } from '../domain/types';
import { mmToPx } from '../domain/factories';

export const PAPER_SIZES = { A4: [210, 297], 'B4-JIS': [257, 364], 'B4-ISO': [250, 353], 'B5-JIS': [182, 257], 'B5-ISO': [176, 250], A5: [148, 210] } as const;
export type SizePreset = keyof typeof PAPER_SIZES | 'custom';
export const CANVAS_PRESETS = { 'comic-B5': [210, 297] as const, ...PAPER_SIZES };
export type CanvasPreset = keyof typeof CANVAS_PRESETS | 'custom';
export function isB5Manuscript(page: Pick<Page, 'width' | 'height' | 'dpi'>): boolean {
  return (page.width === mmToPx(210,page.dpi) && page.height === mmToPx(297,page.dpi)) || (page.width === mmToPx(297,page.dpi) && page.height === mmToPx(210,page.dpi));
}
export function canvasPresetLabel(preset: CanvasPreset): string { return preset==='comic-B5'?'B5 漫画原稿':paperPresetLabel(preset); }
/** Recover standard nominal mm instead of presenting pixel rounding as a new paper size. */
export function pageDimensionsMm(page: Pick<Page, 'width' | 'height' | 'dpi'>): { width: number; height: number } {
  for (const [w, h] of Object.values(PAPER_SIZES)) {
    if (page.width === mmToPx(w, page.dpi) && page.height === mmToPx(h, page.dpi)) return { width: w, height: h };
    if (page.width === mmToPx(h, page.dpi) && page.height === mmToPx(w, page.dpi)) return { width: h, height: w };
  }
  return { width: Number((page.width * 25.4 / page.dpi).toFixed(6)), height: Number((page.height * 25.4 / page.dpi).toFixed(6)) };
}
export function trimSizePreset(widthMm: number, heightMm: number): SizePreset {
  return (Object.entries(PAPER_SIZES).find(([, [w, h]]) => (Math.abs(w - widthMm) < 1e-7 && Math.abs(h - heightMm) < 1e-7) || (Math.abs(h - widthMm) < 1e-7 && Math.abs(w - heightMm) < 1e-7))?.[0] as SizePreset | undefined) ?? 'custom';
}
export function paperPresetLabel(preset: SizePreset): string {
  return preset === 'custom' ? '自定义' : preset.replace('-JIS', '（JIS）').replace('-ISO', '（ISO）');
}
