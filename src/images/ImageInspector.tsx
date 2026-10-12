import type { ImageLayer, Result } from '../domain/types';
import { documentStore } from '../state/documentStore';
import { pushNotice } from '../state/sessionStore';
import { changeLayer } from '../app/actions';
import { detachOwned } from '../layers/reparent';
import { bindImageToPanel, enableFreeImage } from './freeImage';
import {beginImageTrim,restoreImageTrim} from './trimController';
import { beginMaskEdit } from './maskController';
import { beginBreakoutEdit } from './breakoutController';
import { setPanelClipMode } from './breakoutCommands';
import { AssociationRecommendation } from './AssociationRecommendation';
function notice(result: Result<unknown>): void { if (!result.ok) pushNotice('error', result.problems.map(p => p.message).join('\n')); }
export function ImageInspector({ image }: { image: ImageLayer }) {
  const project = documentStore.getState().project, panels = Object.values(project.layers).filter(layer => layer.type === 'panel' && layer.role === 'leaf' && layer.pageId === image.pageId);
  return <div className="image-material-controls">
    <AssociationRecommendation />
    {image.crop && <><button onClick={() => notice(enableFreeImage(image.id))}>自由编辑素材</button><p className="hint">保持当前显示效果，解除铺满约束，允许移动、缩放和旋转。</p></>}
    <label>关联分镜 <select aria-label="素材关联分镜" value={image.parentId && project.layers[image.parentId]?.type === 'panel' ? image.parentId : ''} onChange={event => { if (event.target.value) notice(bindImageToPanel(image.id, event.target.value)); else if (image.parentId && project.layers[image.parentId]?.type === 'panel') notice(detachOwned(image.id)); }}><option value="">自由素材（无分镜）</option>{panels.map(panel => <option key={panel.id} value={panel.id}>{panel.type === 'panel' && panel.editorNumber ? `${panel.editorNumber} · ${panel.name}` : panel.name}</option>)}</select></label>
    {image.parentId && project.layers[image.parentId]?.type === 'panel' && <button onClick={() => notice(detachOwned(image.id))}>解除分镜关联</button>}
    <strong>破格显示</strong>
    {image.parentId && project.layers[image.parentId]?.type === 'panel' ? <><label>分镜边界 <select aria-label="素材破格模式" value={image.panelClip?.mode ?? 'normal'} onChange={e => notice(e.target.value === 'partial' ? beginBreakoutEdit(image.id) : setPanelClipMode([image.id], e.target.value as 'normal' | 'whole'))}><option value="normal">正常裁剪</option><option value="whole">整图破格</option><option value="partial">局部破格</option></select></label><div className="button-stack">{(['rect','ellipse','polygon'] as const).map((shape, i) => <button key={shape} onClick={() => notice(beginBreakoutEdit(image.id, shape))}>{['矩形破格区域','椭圆破格区域','多边形破格区域'][i]}</button>)}</div>{image.panelClip?.region && <><button onClick={() => notice(beginBreakoutEdit(image.id))}>修正破格区域</button><button onClick={() => notice(changeLayer(image.id, '移除破格区域', l => { if (l.type === 'image') l.panelClip = { mode: l.panelClip?.mode === 'whole' ? 'whole' : 'normal' }; }))}>移除破格区域</button></>}<p className="hint">破格素材显示在所属分支框线之上；相邻分镜仍按图层顺序遮挡。素材自身遮罩始终有效。</p></> : <p className="hint">关联分镜后可开启破格。已保存的破格设置在自由素材中暂不生效。</p>}
    <strong>素材裁剪</strong><div className="button-stack"><button onClick={()=>notice(beginImageTrim(image.id))}>裁剪素材范围</button><button disabled={!image.sourceRect} onClick={()=>notice(restoreImageTrim(image.id))}>恢复裁剪</button></div><p className="hint">裁剪改变画布选择框；库原图保留。</p>
    <strong>非破坏遮罩</strong>
    {image.mask ? <><button onClick={() => notice(beginMaskEdit(image.id))}>编辑图片与遮罩</button><label><input type="checkbox" aria-label="启用素材遮罩" checked={image.mask.enabled} onChange={event => notice(changeLayer(image.id, '切换素材遮罩', layer => { if (layer.type === 'image' && layer.mask) layer.mask.enabled = event.target.checked; }))} />启用遮罩</label><label><input type="checkbox" aria-label="链接图片与遮罩" checked={image.mask.linked} onChange={event => notice(changeLayer(image.id, '切换遮罩链接', layer => { if (layer.type === 'image' && layer.mask) layer.mask.linked = event.target.checked; }))} />图片与遮罩一起移动</label><button onClick={() => notice(changeLayer(image.id, '移除素材遮罩', layer => { if (layer.type === 'image') delete layer.mask; }))}>移除遮罩</button></> : <div className="button-stack"><button onClick={() => notice(beginMaskEdit(image.id, 'rect'))}>矩形遮罩</button><button onClick={() => notice(beginMaskEdit(image.id, 'ellipse'))}>椭圆遮罩</button><button onClick={() => notice(beginMaskEdit(image.id, 'polygon'))}>多边形遮罩</button></div>}
    <p className="hint">遮罩只隐藏像素。编辑时分别选择图片或遮罩；关闭或移除后显示当前裁剪范围。</p>
  </div>;
}
