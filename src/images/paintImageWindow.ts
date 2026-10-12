import type { PreparedImage } from '../render/compileScene';
/** The same prepared source/destination pair serves editor, ghosts, thumbnails and exports. */
export function paintImageWindow(ctx: CanvasRenderingContext2D, image: CanvasImageSource, rect: PreparedImage): void {
  const s = rect.source;
  if (s) ctx.drawImage(image, s.x, s.y, s.width, s.height, rect.x, rect.y, rect.width, rect.height);
  else ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
}
