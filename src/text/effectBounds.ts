import type { TextLayer } from '../domain/types';
import { runtimeStore } from '../state/runtimeStore';
import { layoutText } from './layout';
import { fontCss } from './fonts';
import { compileEffectText, type PreparedEffectText } from './effects';
import { applyCanvasTextPolicy } from './canvasStyle';
const cache=new WeakMap<TextLayer,{generation:number;value:PreparedEffectText}>();let canvas:HTMLCanvasElement|null=null;
export function effectGeometryFor(layer:TextLayer):PreparedEffectText|null{
  if(layer.role!=='sfx'||!layer.effects)return null;const generation=runtimeStore.getState().fontGeneration,entry=cache.get(layer);if(entry?.generation===generation)return entry.value;
  canvas??=document.createElement('canvas');const ctx=canvas.getContext('2d');if(!ctx)return null;applyCanvasTextPolicy(ctx);const font=fontCss(layer.text.font.family,layer.text.font.size,layer.text.font.bold,layer.text.font.italic);ctx.font=font;const layout=layoutText(layer.text,layer.box,ctx),glyphFonts=new Map<string,string>();for(const run of layout.runs)for(const cell of run.cells)if(cell.fontFamily)glyphFonts.set(cell.fontFamily,fontCss(cell.fontFamily,layer.text.font.size,layer.text.font.bold,layer.text.font.italic));
  const value=compileEffectText(layer,layout,font,glyphFonts,ctx);cache.set(layer,{generation,value});return value;
}
