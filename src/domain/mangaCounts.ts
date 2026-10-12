import type { Layer, Project } from './types';

export function isBoundTail(layer: Layer): boolean { return layer.type === 'bubbleTail' && layer.attachment.mode === 'bubble'; }
export function mangaLayerCounts(project: Pick<Project, 'layers'>): { content: number; boundTails: number } {
  let content = 0, boundTails = 0;
  for (const layer of Object.values(project.layers)) {
    if (isBoundTail(layer)) boundTails++;
    else if (layer.type !== 'pageBackground') content++;
  }
  return { content, boundTails };
}
