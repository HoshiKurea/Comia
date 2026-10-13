import type { AppearancePreset, BlendMode, Layer, LayerEffect, LayerPresentation, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { isUuid, migrationId, newId } from '../domain/id';

export const BLENDS: [BlendMode, string, GlobalCompositeOperation][] = [
  ['normal','正常','source-over'],['multiply','正片叠底','multiply'],['screen','滤色','screen'],['overlay','叠加','overlay'],['darken','变暗','darken'],['lighten','变亮','lighten'],['colorDodge','颜色减淡','color-dodge'],['colorBurn','颜色加深','color-burn'],['hardLight','强光','hard-light'],['softLight','柔光','soft-light'],['difference','差值','difference'],['exclusion','排除','exclusion'],['hue','色相','hue'],['saturation','饱和度','saturation'],['color','颜色','color'],['luminosity','明度','luminosity'],
];
export const compositeMode = (mode: BlendMode) => BLENDS.find(b => b[0] === mode)?.[2] ?? 'source-over';
export function defaultEffect(kind: LayerEffect['kind'], id = newId(), enabled = true): LayerEffect {
  return { id, kind, enabled, color: kind === 'outerGlow' ? '#3478F6FF' : '#000000FF', opacity: kind === 'shadow' ? .35 : 1, width: kind === 'outline' ? 4 : kind === 'outerGlow' ? 3 : 0, blur: kind === 'shadow' ? 12 : kind === 'outerGlow' ? 16 : 0, offsetX: kind === 'shadow' ? 8 : 0, offsetY: kind === 'shadow' ? 8 : 0 };
}
export function presentation(layer: Layer): LayerPresentation {
  return layer.presentation ?? { opacity: 1, blendMode: 'normal', fillBlendMode: 'normal', strokeBlendMode: 'normal', stroke: { alignment: 'center', dash: 'solid', cap: 'butt', join: 'round', miterLimit: 10 }, effects: (['shadow','outline','outerGlow'] as const).map(kind => defaultEffect(kind, migrationId(`effect:${layer.id}:${kind}`), false)) };
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const range = (v: unknown, a: number, b: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= a && v <= b;
const rgba = (v: unknown): v is string => typeof v === 'string' && /^#[0-9A-F]{8}$/i.test(v);
export function parsePresentation(v: unknown, path = 'presentation'): Result<LayerPresentation> {
  const bad = () => fail(problem('appearance/fields', '外观、描边或效果参数无效／超出预算', path));
  if (!object(v) || !range(v.opacity,0,1) || !['blendMode','fillBlendMode','strokeBlendMode'].every(k => BLENDS.some(b => b[0] === v[k])) || !object(v.stroke) || !Array.isArray(v.effects) || v.effects.length > 8) return bad();
  const s = v.stroke;
  if (!['center','inside','outside'].includes(String(s.alignment)) || !['solid','dash','dot','dashdot'].includes(String(s.dash)) || !['butt','round','square'].includes(String(s.cap)) || !['miter','round','bevel'].includes(String(s.join)) || !range(s.miterLimit,1,100)) return bad();
  if (s.edgeWidths !== undefined && (!Array.isArray(s.edgeWidths) || s.edgeWidths.length !== 4 || !s.edgeWidths.every(w => range(w,0,256)))) return bad();
  const effects: LayerEffect[] = [];
  for (const e of v.effects) {
    if (!object(e) || !isUuid(e.id) || !['shadow','outline','outerGlow'].includes(String(e.kind)) || typeof e.enabled !== 'boolean' || !rgba(e.color) || !range(e.opacity,0,1) || !range(e.width,0,256) || !range(e.blur,0,128) || !range(e.offsetX,-1024,1024) || !range(e.offsetY,-1024,1024)) return bad();
    effects.push({ id: e.id, kind: e.kind as LayerEffect['kind'], enabled: e.enabled, color: e.color.toUpperCase(), opacity: e.opacity, width: e.width, blur: e.blur, offsetX: e.offsetX, offsetY: e.offsetY });
  }
  if (new Set(effects.map(e => e.id)).size !== effects.length) return bad();
  let hint: LayerPresentation['transformHint'];
  if (v.transformHint !== undefined) { const h=v.transformHint; if (!object(h) || !range(h.rotation,-1e7,1e7) || !range(h.sx,1e-4,1e4) || !range(h.sy,1e-4,1e4) || !range(h.skewX,-80,80) || !range(h.skewY,-80,80)) return bad(); hint={rotation:h.rotation,sx:h.sx,sy:h.sy,skewX:h.skewX,skewY:h.skewY}; }
  return ok({ opacity:v.opacity, blendMode:v.blendMode as BlendMode, fillBlendMode:v.fillBlendMode as BlendMode, strokeBlendMode:v.strokeBlendMode as BlendMode,
    stroke:{ alignment:s.alignment as LayerPresentation['stroke']['alignment'], dash:s.dash as LayerPresentation['stroke']['dash'], cap:s.cap as CanvasLineCap, join:s.join as CanvasLineJoin, miterLimit:s.miterLimit, ...(s.edgeWidths ? {edgeWidths:[...s.edgeWidths as number[]]} : {}) }, effects, ...(hint?{transformHint:hint}:{}) });
}
export function parseAppearancePreset(v: unknown, path='stylePreset'): Result<AppearancePreset> {
  if (!object(v) || !isUuid(v.id) || typeof v.name !== 'string' || !v.name.trim() || Array.from(v.name.trim()).length > 80) return fail(problem('appearance/preset','外观预设名称或编号无效',path));
  const parsed=parsePresentation(v.presentation,path); if(!parsed.ok)return parsed;
  let paint: AppearancePreset['paint']; if(v.paint!==undefined){const p=v.paint; if(!object(p)||!rgba(p.fill)||!rgba(p.borderColor)||!range(p.borderWidth,0,256)||!range(p.radius,0,4096))return fail(problem('appearance/preset','预设填充或描边参数无效',path)); paint={fill:p.fill.toUpperCase(),borderColor:p.borderColor.toUpperCase(),borderWidth:p.borderWidth,radius:p.radius};}
  return ok({id:v.id,name:v.name.trim(),presentation:parsed.value,...(paint?{paint}:{})});
}
export function layerPaint(layer: Layer): AppearancePreset['paint'] | null {
  if(layer.type==='panel')return {...layer.style,radius:layer.style.borderRadius};
  if(layer.type==='bubble')return layer.style;
  if(layer.type==='group'&&layer.dialogue)return layer.dialogue.fusionStyle;
  if(layer.type==='decoration'&&layer.spec.kind==='shape')return {...layer.spec.style,radius:layer.spec.style.borderRadius};
  return null;
}
