import type { Page, PageBackgroundLayer } from '../domain/types';
import { DEFAULT_FONT_FAMILY } from '../domain/factories';
import { fontStyle } from '../text/fontStyle';
import { backgroundFrames, watermarkLayout } from './backgroundGeometry';

export function measureWatermark(ctx: CanvasRenderingContext2D, w: NonNullable<PageBackgroundLayer['watermark']>) {
  ctx.font = fontStyle(DEFAULT_FONT_FAMILY, w.fontSize);
  const metrics = ctx.measureText(w.content);
  return { width: metrics.width, height: Math.max(w.fontSize, (metrics.actualBoundingBoxAscent || 0) + (metrics.actualBoundingBoxDescent || 0)) };
}
export function drawBackground(ctx: CanvasRenderingContext2D, page: Page, layer: PageBackgroundLayer): void {
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, page.width, page.height); ctx.clip();
  ctx.fillStyle = layer.fill; ctx.fillRect(0, 0, page.width, page.height);
  const frame = backgroundFrames(page.width, page.height, layer.frame);
  if (layer.frame) { ctx.strokeStyle = layer.frame.color; ctx.lineWidth = frame.effectiveWidth; for (const box of frame.boxes) ctx.strokeRect(box.x, box.y, box.width, box.height); }
  const w = layer.watermark;
  if (w) {
    const metrics = measureWatermark(ctx, w), layout = watermarkLayout(page.width, page.height, w, metrics.width, metrics.height);
    if (!layout.ok) { ctx.restore(); throw new Error(layout.problems[0].message); }
    ctx.fillStyle = w.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const center of layout.value.centers) { ctx.save(); ctx.translate(center.x, center.y); ctx.rotate(layout.value.angle); ctx.fillText(w.content, 0, 0); ctx.restore(); }
  }
  ctx.restore();
}
