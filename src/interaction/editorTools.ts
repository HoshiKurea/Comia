import {activateBubbleBrush} from '../bubbles/brushController';
import { fail, ok, problem, type Result } from '../domain/types';
import { getProject } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { cancelActiveGesture } from './activeGesture';
import {beginPanelCutTarget} from './panelCutTool';
import {beginImageMaskTarget} from './imageMaskTool';
import {beginImageCropTarget} from './imageCropTool';
import { clearGeometryNode, selectGeometryNode } from './geometryNodeEdit';
export function setEditorTool(mode:'select'|'geometry'|'marquee'|'lasso'|'panel-cut'|'image-crop'|'image-mask'|'bubble-brush'):Result<void>{
  if(mode==='bubble-brush')return activateBubbleBrush();
  const p=getProject(),s=sessionStore.getState(),id=s.selection[0];
  if(mode==='geometry'&&(s.selection.length!==1||p.layers[id]?.type!=='panel'||!effectiveLayerFlags(p,id).visible||effectiveLayerFlags(p,id).locked))return fail(problem('tool/panel','请选择可见且未锁定的一个分镜'));
  cancelActiveGesture();clearGeometryNode();sessionStore.setState({toolMode:mode});if(mode==='geometry')selectGeometryNode(id,0);if(mode==='panel-cut'&&s.selection.length===1&&p.layers[id]?.type==='panel')return beginPanelCutTarget(id);if(mode==='image-crop'&&s.selection.length===1&&p.layers[id]?.type==='image')return beginImageCropTarget(id);if(mode==='image-mask'&&s.selection.length===1&&p.layers[id]?.type==='image')return beginImageMaskTarget(id);return ok(undefined);
}
