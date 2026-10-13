import { memo, useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { Id, Layer, Project } from '../domain/types';
import { runtimeStore } from '../state/runtimeStore';
import { drawLayerFragment } from '../render/drawScene';
import { layerScreenBounds } from '../render/screenBounds';

const cache = new Map<string, HTMLCanvasElement>();
function fingerprint(project: Project, id: Id): unknown {
  const layer = project.layers[id]; if (!layer) return null;
  // Metadata and selection do not change pixels. Subtree content and ancestor clip/matrix do.
  const { name: _name, colorLabel: _label, locked: _locked, ...content } = layer;
  if (content.type === 'panel') { delete content.nameMode; delete content.editorNumber; }
  return [content, 'children' in layer ? layer.children.map((child) => fingerprint(project, child)) : []];
}
export const LayerThumbnail = memo(function LayerThumbnail({ project, id, size = 28 }: { project: Project; id: Id; size?: 28 | 64 }) {
  const ref = useRef<HTMLCanvasElement>(null), fontGeneration = useStore(runtimeStore, (state) => state.fontGeneration), images = useStore(runtimeStore, (state) => state.images);
  const ancestors: Layer[] = []; for (let parent = project.layers[id]?.parentId; parent; parent = project.layers[parent].parentId) ancestors.push(project.layers[parent]);
  const imageKeys: unknown[] = [];
  const scan = (layerId: Id) => { const layer = project.layers[layerId]; if (!layer) return; if (layer.type === 'image') { const hash = project.assets[layer.assetId]?.renderHash; imageKeys.push([hash, Boolean(hash && images.has(hash))]); } if ('children' in layer) layer.children.forEach(scan); }; scan(id);
  const key = size + ':' + JSON.stringify([fingerprint(project, id), project.layers[id].type === 'pageBackground' ? [project.pages[project.layers[id].pageId].width, project.pages[project.layers[id].pageId].height] : null, ancestors.map((layer) => [layer.matrix, layer.type === 'panel' ? [layer.geometry, layer.style.borderRadius] : null]), imageKeys, fontGeneration, Math.min(2, window.devicePixelRatio || 1)]);
  useEffect(() => {
    const target = ref.current; if (!target) return;
    let source = cache.get(key);
    if (!source) {
      const layer = project.layers[id], visible = { ...project, layers: { ...project.layers, [id]: { ...layer, visible: true } } };
      const parent = layer.parentId ? project.layers[layer.parentId] : null;
      // Fit the painted footprint (curves, tails, transformed stroke), while
      // snapping and transform handles retain their stroke-free geometry bbox.
      const box = layerScreenBounds(visible, parent?.type === 'panel' && layer.type === 'image' ? parent.id : id, { zoom: 1, pan: { x: 0, y: 0 } });
      source = document.createElement('canvas'); const dpr = Math.min(2, window.devicePixelRatio || 1); source.width = source.height = Math.round(size * dpr);
      const ctx = source.getContext('2d');
      if (ctx && box && box.width > 0 && box.height > 0) { const scale = Math.min((size - 4) * dpr / box.width, (size - 4) * dpr / box.height); ctx.translate((source.width - box.width * scale) / 2, (source.height - box.height * scale) / 2); ctx.scale(scale, scale); ctx.translate(-box.x, -box.y); drawLayerFragment(ctx, visible, id, images); }
      cache.set(key, source);
      while (cache.size > 128) { const oldest = cache.keys().next().value!; const old = cache.get(oldest)!; cache.delete(oldest); old.width = old.height = 0; }
    } else { cache.delete(key); cache.set(key, source); }
    target.width = source.width; target.height = source.height; target.getContext('2d')?.drawImage(source, 0, 0); target.dataset.paintCount = String(Number(target.dataset.paintCount ?? 0) + 1);
  }, [key]);
  return <canvas className={size === 64 ? 'inspector-thumbnail' : 'layer-thumbnail'} ref={ref} aria-label={`${project.layers[id].name}${size === 64 ? '属性预览' : '缩略图'}`} />;
});
