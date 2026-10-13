import type { Page, Viewport } from '../domain/types';
import { manuscriptSegments } from './manuscript';
/** Called exclusively by the editor's non-listening overlay Layer; never by drawPage/exports. */
export function drawManuscriptGuides(ctx: CanvasRenderingContext2D, page: Page, viewport: Viewport): void {
  if (!page.manuscript) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(viewport.pan.x, viewport.pan.y, page.width * viewport.zoom, page.height * viewport.zoom); ctx.clip();
  ctx.lineWidth = .85;
  for (const segment of manuscriptSegments(page)) {
    ctx.strokeStyle = segment.kind === 'basic' ? '#9691cc' : segment.kind === 'safe' ? '#b098cb' : '#8a81e5';
    ctx.setLineDash(segment.kind === 'safe' ? [4, 3] : []);
    ctx.beginPath(); ctx.moveTo(segment.a.x * viewport.zoom + viewport.pan.x, segment.a.y * viewport.zoom + viewport.pan.y);
    ctx.lineTo(segment.b.x * viewport.zoom + viewport.pan.x, segment.b.y * viewport.zoom + viewport.pan.y); ctx.stroke();
  }
  ctx.restore();
}
