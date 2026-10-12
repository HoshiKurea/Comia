import { expect, it, vi } from 'vitest';
import { paintImageWindow } from '../../src/images/paintImageWindow';
it('draws an actual source subrectangle rather than squeezing the whole bitmap into cropped bounds', () => {
  const drawImage = vi.fn(), ctx = { drawImage } as unknown as CanvasRenderingContext2D, source = {} as CanvasImageSource;
  paintImageWindow(ctx, source, { x: 0, y: 0, width: 40, height: 30, source: { x: 10, y: 20, width: 40, height: 30 } });
  expect(drawImage).toHaveBeenLastCalledWith(source, 10, 20, 40, 30, 0, 0, 40, 30);
  paintImageWindow(ctx, source, { x: 12, y: 24, width: 100, height: 80 }); expect(drawImage).toHaveBeenLastCalledWith(source, 12, 24, 100, 80);
});
