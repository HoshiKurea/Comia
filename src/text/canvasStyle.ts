/** Document glyphs must not inherit UI font-synthesis rules.
 * WebKit observes this CSS property even for Canvas text. Permit requested bold/italic
 * synthesis consistently on attached editor/thumbnail canvases and detached export surfaces.
 */
export function applyCanvasTextPolicy(ctx: CanvasRenderingContext2D): void {
  const style = (ctx.canvas as HTMLCanvasElement | undefined)?.style;
  if (style && style.fontSynthesis !== 'weight style') style.fontSynthesis = 'weight style';
}
