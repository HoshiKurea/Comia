import type { InkStroke, RGBA } from '../domain/types';

/** Native pixel extent stays fixed when the layer is transformed. */
export interface PaintLayerSpec {
  kind: 'paint'; mode: 'raster' | 'vector'; width: number; height: number;
  strokes: InkStroke[];
}
export interface BackgroundFillSpec {
  kind: 'background-fill'; width: number; height: number;
  mode: 'solid' | 'gradient' | 'tone'; color: RGBA; secondary: RGBA;
  angle: number; frequency: number; density: number; dpi: number;
}
export type FlashPreset = 'flash' | 'inverse' | 'dense' | 'urchin' | 'firework';
export interface FlashOptions {
  background:RGBA; preset: FlashPreset; seed: number; brushSize: number;
  spacingMode: 'distance' | 'angle'; spacing: number; length: number;
  lengthJitter: number; referenceJitter: number; jagged: boolean; fillCenter: boolean;
}
export interface BubblePenSettings {
  stabilization: number; postCorrection: number; sharpCorners: boolean;
  pressure: boolean;
}
