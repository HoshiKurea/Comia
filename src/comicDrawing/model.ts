import { fail, ok, problem, type Result, type InkStroke } from '../domain/types';
import { parseInkStroke } from '../freehand/model';
import type { BackgroundFillSpec, BubblePenSettings, FlashOptions, FlashPreset, PaintLayerSpec } from './types';

export const PAINT_LIMITS = { axis: 8192, points: 65536, strokes: 256, tileBytes: 64 * 1024 * 1024 } as const;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const range = (v: unknown, a: number, b: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= a && v <= b;
const rgba = (v: unknown): v is string => typeof v === 'string' && /^#[a-f0-9]{8}$/i.test(v);
const bad = (message: string) => fail(problem('comic-drawing/parameters', message));
export const DEFAULT_PEN: BubblePenSettings = { stabilization: .2, postCorrection: 1, sharpCorners: true, pressure: false };
export function parsePen(v: unknown): Result<BubblePenSettings> {
  if (!object(v) || !range(v.stabilization, 0, .9) || !range(v.postCorrection, 0, 4) || typeof v.sharpCorners !== 'boolean' || typeof v.pressure !== 'boolean') return bad('笔刷修正参数无效');
  return ok({ stabilization: v.stabilization, postCorrection: v.postCorrection, sharpCorners: v.sharpCorners, pressure: v.pressure });
}
export function flashPreset(preset: FlashPreset): FlashOptions {
  return { preset, background:preset==='inverse'?'#000000FF':'#00000000',seed: 42, brushSize: preset === 'dense' ? 10 : 8, spacingMode: 'distance', spacing: preset === 'urchin' ? 2.5 : preset === 'dense' ? 4 : preset === 'firework' ? 20 : 8,
    length: preset === 'firework' ? 220 : 120, lengthJitter: .45, referenceJitter: 20, jagged: preset === 'urchin', fillCenter: true };
}
export function flashRayCount(width:number,height:number,o:FlashOptions):number {
  const a=width/2,b=height/2,perimeter=Math.PI*(3*(a+b)-Math.sqrt((3*a+b)*(a+3*b)));
  return Math.max(4,Math.round(o.spacingMode==='angle'?360/o.spacing:perimeter/o.spacing));
}
export function parseFlash(v: unknown): Result<FlashOptions> {
  if (!object(v) || !rgba(v.background) || !['flash','inverse','dense','urchin','firework'].includes(String(v.preset)) || !Number.isInteger(v.seed) || !range(v.seed, 0, 0xffffffff) || !range(v.brushSize, .25, 128) || !['distance','angle'].includes(String(v.spacingMode)) || !range(v.spacing, v.spacingMode === 'angle' ? .5 : 1, v.spacingMode === 'angle' ? 90 : 256) || !range(v.length, 1, 2048) || !range(v.lengthJitter, 0, .9) || !range(v.referenceJitter, 0, 80) || typeof v.jagged !== 'boolean' || typeof v.fillCenter !== 'boolean') return bad('效果线尺寸、间距或随机参数超出范围');
  return ok({ background:v.background.toUpperCase(), preset: v.preset as FlashPreset, seed: v.seed, brushSize: v.brushSize, spacingMode: v.spacingMode as FlashOptions['spacingMode'], spacing: v.spacing, length: v.length, lengthJitter: v.lengthJitter, referenceJitter: v.referenceJitter, jagged: v.jagged, fillCenter: v.fillCenter });
}
export function parseComicSpec(v: unknown): Result<PaintLayerSpec | BackgroundFillSpec> {
  if (!object(v) || !range(v.width, 16, PAINT_LIMITS.axis) || !range(v.height, 16, PAINT_LIMITS.axis) || !Number.isInteger(v.width) || !Number.isInteger(v.height)) return bad('绘画图层尺寸必须为16～8192整数像素');
  if (v.kind === 'paint') {
    if (!['raster','vector'].includes(String(v.mode)) || !Array.isArray(v.strokes) || v.strokes.length > PAINT_LIMITS.strokes) return bad('绘画图层模式或笔数无效');
    const strokes: InkStroke[] = []; let count = 0;
    for (const raw of v.strokes) { const s = parseInkStroke(raw); if (!s.ok) return s; if (v.mode === 'vector' && s.value.tool !== 'pen') return bad('矢量擦除应删除整条笔迹');
      strokes.push(s.value); count += s.value.points.length; }
    if (count > PAINT_LIMITS.points || new Set(strokes.map(s => s.id)).size !== strokes.length) return bad('图层点数超限或笔迹编号重复');
    return ok({ kind: 'paint', mode: v.mode as PaintLayerSpec['mode'], width: v.width, height: v.height, strokes });
  }
  if (v.kind !== 'background-fill' || !['solid','gradient','tone'].includes(String(v.mode)) || !rgba(v.color) || !rgba(v.secondary) || !range(v.angle, -360, 360) || !range(v.frequency, 5, 150) || !range(v.density, 0, 100) || !range(v.dpi, 72, 1200)) return bad('背景图层颜色、角度或网点参数无效');
  return ok({ kind: 'background-fill', mode: v.mode as BackgroundFillSpec['mode'], width: v.width, height: v.height, color: v.color.toUpperCase(), secondary: v.secondary.toUpperCase(), angle: v.angle, frequency: v.frequency, density: v.density, dpi: v.dpi });
}
