/**
 * M01-T03：有效显隐/锁定标志。祖先 visible 取 AND，locked 取 OR。
 */
import type { Id, Layer, Project } from '../domain/types';
import { getProject } from './documentStore';

export function effectiveLayerFlags(project: Project, id: Id): { visible: boolean; locked: boolean } {
  let visible = true;
  let locked = false;
  let current: Id | null = id;
  let guard = 0;
  while (current) {
    const layer: Layer | undefined = project.layers[current];
    if (!layer) break;
    visible = visible && layer.visible;
    locked = locked || layer.locked;
    current = layer.parentId;
    guard += 1;
    if (guard > 64) break; // 防御：树已在事务后校验无环
  }
  return { visible, locked };
}

export function getEffectiveLayerFlags(id: Id): { visible: boolean; locked: boolean } {
  return effectiveLayerFlags(getProject(), id);
}
