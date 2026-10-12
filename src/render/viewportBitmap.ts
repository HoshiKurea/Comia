import type { Id, Point, Project, Viewport } from '../domain/types';
import { drawPage, type ImageResources } from './drawScene';
export interface ViewportBitmap { canvas: HTMLCanvasElement; size: Point; initial: Viewport }
/** One whole-page raster per view gesture. Panning can expose any page area; only the preview is budget-scaled. */
export function captureViewport(project: Project, pageId: Id, initial: Viewport, _viewportSize: Point, images: ImageResources): ViewportBitmap {
  const page = project.pages[pageId]; if (!page) throw Error('视图页面不存在');
  const size = { x: page.width * initial.zoom, y: page.height * initial.zoom };
  const ratio = Math.min(window.devicePixelRatio || 1, 16384 / Math.max(1, size.x, size.y), Math.sqrt(64 * 1024 * 1024 / (4 * Math.max(1, size.x) * Math.max(1, size.y))));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.floor(size.x * ratio)); canvas.height = Math.max(1, Math.floor(size.y * ratio));
  const ctx = canvas.getContext('2d'); if (!ctx) { canvas.width = canvas.height = 0; throw Error('无法创建视图预览画布'); }
  try { ctx.scale(canvas.width / page.width, canvas.height / page.height); drawPage(ctx, project, pageId, images); }
  catch (error) { canvas.width = canvas.height = 0; throw error; }
  return { canvas, size, initial: { zoom: initial.zoom, pan: { x: 0, y: 0 } } };
}
export function drawViewportBitmap(ctx: CanvasRenderingContext2D, bitmap: ViewportBitmap, viewport: Viewport): void {
  const ratio = viewport.zoom / bitmap.initial.zoom;
  ctx.save(); ctx.translate(viewport.pan.x - bitmap.initial.pan.x * ratio, viewport.pan.y - bitmap.initial.pan.y * ratio); ctx.scale(ratio, ratio);
  ctx.drawImage(bitmap.canvas, 0, 0, bitmap.size.x, bitmap.size.y); ctx.restore();
}
export function releaseViewportBitmap(bitmap: ViewportBitmap | null): void { if (bitmap) { bitmap.canvas.width = 0; bitmap.canvas.height = 0; } }
