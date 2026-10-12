import type { Id, Project } from '../domain/types';
import type { GeometryTarget } from '../geometry/flattenForBoolean';
import { multiply, worldMatrix } from '../geometry/matrix';
import { sessionStore } from '../state/sessionStore';
/** Same device/viewport precision as the existing Konva layer; translation has
 * no effect on curve error. Preview preflight and final frame share one result. */
export function editorGeometryTarget(project:Project,id:Id):GeometryTarget{
  const layer=project.layers[id],zoom=layer?sessionStore.getState().viewportByPage[layer.pageId]?.zoom??1:1,dpr=Math.min(2,Math.max(1,window.devicePixelRatio||1)),s=zoom*dpr,m=multiply([s,0,0,s,0,0],worldMatrix(project,id));
  return{localToOutput:[m[0],m[1],m[2],m[3],0,0],tolerancePx:.25};
}
