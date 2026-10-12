import type { Id, Project } from '../domain/types';
/** Library entries own unused originals independently of placed layer instances. */
export function assetReferences(project: Project): Id[] {
  return [...new Set([...(project.libraryAssetIds ?? []), ...Object.values(project.layers).flatMap(layer => layer.type === 'image' && layer.assetId ? [layer.assetId] : [])])];
}
