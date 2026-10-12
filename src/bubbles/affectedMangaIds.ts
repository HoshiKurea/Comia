import type { Id, Project } from '../domain/types';
/** Dependency closure, not paint order. Replay uses the original root order. */
export function affectedMangaIds(project:Project,changedIds:readonly Id[]):Id[]{
  const result=new Set<Id>(),expand=(id:Id):void=>{if(result.has(id))return;const layer=project.layers[id];if(!layer)return;result.add(id);if(layer.type==='bubble'||layer.type==='group'&&layer.dialogue)for(const child of layer.children)expand(child);};
  for(const id of changedIds){expand(id);let parent=project.layers[id]?.parentId;while(parent){const layer=project.layers[parent];if(!layer)break;if(layer.type==='bubble'||layer.type==='group'&&layer.dialogue)expand(parent);parent=layer.parentId;}}
  return [...result];
}
