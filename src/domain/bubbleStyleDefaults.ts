import type { BubbleStyle } from './types';
/** Pure constructor defaults: do not import stores, history or geometry here. */
export function completeBubbleStyle(style: BubbleStyle): BubbleStyle {
  return { ...style, innerStroke: style.innerStroke ?? { enabled: false, width: 0, color: style.borderColor }, outerStroke: style.outerStroke ?? { enabled: false, width: 0, color: style.borderColor } };
}
