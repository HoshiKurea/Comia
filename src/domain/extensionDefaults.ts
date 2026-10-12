import type { Layer, Project } from './types';
import { completeBubbleStyle } from './bubbleStyleDefaults';
import { buildBubble } from '../bubbles/geometry';
import { legacyBubbleTail, mainBubbleText } from '../bubbles/ownership';

/** Internal constructors can still author legacy shapes. Complete only absent extension defaults. */
export function completeExtensionLayer(layer: Layer): void {
  if (layer.type === 'panel') { if (layer.role === 'leaf') layer.nameMode ??= 'custom'; else delete layer.nameMode; }
  if (layer.type === 'image') layer.sourceRect ??= null;
  if (layer.type === 'bubble') {
    layer.style = completeBubbleStyle(layer.style);
    layer.edgeStyle ??= { recipe: 'legacy-baked', wobble: 0, seed: layer.handDrawn?.seed ?? 42 };
  }
  if (layer.type === 'bubbleTail' && layer.style) layer.style = completeBubbleStyle(layer.style);
  if (layer.type === 'group' && layer.dialogue) layer.dialogue.fusionStyle = completeBubbleStyle(layer.dialogue.fusionStyle);
}
export function completeExtensionProject(project: Project, legacy = false): void {
  for (const layer of Object.values(project.layers)) {
    const priorMode = layer.type === 'panel' ? layer.nameMode : undefined;
    completeExtensionLayer(layer);
    if (legacy && priorMode === undefined && layer.type === 'panel' && layer.role === 'leaf') layer.nameMode = layer.name === `分镜 ${layer.editorNumber}` || layer.name === `分镜${layer.editorNumber}` ? 'automatic' : 'custom';
  }
  for (const bubble of Object.values(project.layers)) if (bubble.type === 'bubble') {
    const text = mainBubbleText(project, bubble.id); if (!text || text.bubbleFrame) continue;
    const g = buildBubble(bubble.shape, bubble.width, bubble.height, bubble.style, legacyBubbleTail(project, bubble), bubble);
    const centered = !legacy || text.box.width >= 1 && text.box.height >= 1 && text.box.width <= 16384 && text.box.height <= 16384 && text.matrix.every((v, i) => Math.abs(v - [1, 0, 0, 1, 0, 0][i]) <= 1e-9) && text.text.align === 'center' && g.ok && (['x','y','width','height'] as const).every(k => Math.abs(text.box[k] - g.value.textBox[k]) <= 1e-6);
    text.bubbleFrame = { mode: legacy ? 'manual' : 'auto', manualSize: legacy ? { width: text.box.width, height: text.box.height } : null, placement: centered ? 'center' : 'legacy' };
  }
}

/** Remove constructor-only format9 defaults when authoring an explicitly legacy document. */
export function stripExtensionDefaults(project: Project, before?: Project): void {
  for (const layer of Object.values(project.layers)) {
    if (before?.layers[layer.id]) continue;
    if (layer.type === 'panel') delete layer.nameMode;
    if (layer.type === 'image') { if (layer.sourceRect) throw Error('实例裁剪需要格式9'); delete layer.sourceRect; }
    if (layer.type === 'text') { if (layer.bubbleFrame) throw Error('新对白框需要格式9'); }
    if (layer.type === 'bubble') { if (layer.edgeStyle?.wobble) throw Error('派生边缘需要格式9'); delete layer.edgeStyle; }
    const style = layer.type === 'bubble' || layer.type === 'bubbleTail' ? layer.style : layer.type === 'group' ? layer.dialogue?.fusionStyle : undefined;
    if (style) { if (style.innerStroke?.enabled || style.outerStroke?.enabled) throw Error('内外描边需要格式9'); delete style.innerStroke; delete style.outerStroke; }
  }
}
