import { PageBackgroundInspector } from '../pages/PageBackgroundInspector';
import { openDrawingWindow } from '../freehand/session';
import { ImageInspector } from '../images/ImageInspector';
import { enableFreeImage } from '../images/freeImage';
import { beginDrawing } from '../panels/drawingController';
import { separatePanelLayout } from '../panels/independentLayout';
import { useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { Id, Layer, Result } from '../domain/types';
import { firstMessage } from '../domain/types';
import { decompose } from '../geometry/matrix';
import { documentStore } from '../state/documentStore';
import { sessionStore, pushNotice, type NoticeContext } from '../state/sessionStore';
import { changeLayer } from '../app/actions';
import { TextInspector } from '../text/TextInspector';
import { EffectTextInspector } from '../text/EffectTextInspector';
import { currentTextEdit, beginSfxTextEdit, commitTextEdit, setTextComposing, textEditStore, updateTextInput } from '../text/editController';
import { cancelTextEdit } from '../text/editController';
import { cancelActiveGesture } from '../interaction/activeGesture';
import { setDimensions, setRotation, transformDimensions } from '../interaction/transformCommands';
import { isParallelogram } from '../panels/editGeometry';
import { PanelStyleInspector } from '../panels/PanelStyleInspector';
import { CutInspector } from '../panels/CutInspector';
import { beginCropEdit } from '../images/editCommands';
import { runtimeStore } from '../state/runtimeStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { moveLayer } from '../layers/reorder';
import { breakoutSplitGuard } from '../images/breakoutCommands';
import { detachOwned, reparent } from '../layers/reparent';
import { buildBubble } from '../bubbles/geometry';
import { defaultTail } from '../bubbles/tail';
import { setBubbleStyle } from '../bubbles/commands';
import { BubbleStyleInspector } from '../bubbles/BubbleStyleInspector';
import { openPresetDialog } from '../library/PresetDialog';
import type { BubbleShape } from '../domain/types';
import { mangaEditStore } from '../bubbles/mangaEditController';
import { BubbleShapeInspector } from '../bubbles/BubbleShapeInspector';
import { TailInspector } from '../bubbles/TailInspector';
import { DialogueInspector } from '../bubbles/DialogueInspector';
import { setPrimaryTailKind } from '../bubbles/tailCommands';
import { beginBubbleShapeEdit, setEditedBubbleShape, commitBubbleShapeEdit, cancelBubbleShapeEdit } from '../bubbles/shapeController';
import { isPanelRelocating } from './panelInteraction';

function notice(result: Result<unknown>, context?: NoticeContext): void { if (!result.ok) pushNotice('error', firstMessage(result), context); }

function editNumber(id: Id, label: string, field: string, raw: string): void {
  const value = Number(raw);
  if (!Number.isFinite(value) || raw.trim() === '') { pushNotice('error', `${label}必须是有效数字`); return; }
  if (field === 'width' || field === 'height') { notice(setDimensions(id, field === 'width' ? value : undefined, field === 'height' ? value : undefined)); return; }
  if (field === 'rotation') { notice(setRotation(id, value)); return; }
  if (documentStore.getState().project.layers[id]?.type === 'bubble' && (field === 'borderWidth' || field === 'radius')) { notice(setBubbleStyle(id, { [field]: value })); return; }
  notice(changeLayer(id, `修改${label}`, (layer) => {
    if (field === 'x' || field === 'y') {
      const m = [...layer.matrix] as [number, number, number, number, number, number];
      m[field === 'x' ? 4 : 5] = value;
      layer.matrix = m;
    } else if (layer.type === 'panel' && field === 'borderWidth') layer.style.borderWidth = value;
    else if (layer.type === 'panel' && field === 'radius') layer.style.borderRadius = value;
    else if (layer.type === 'bubble' && field === 'borderWidth') layer.style.borderWidth = value;
    else if (layer.type === 'text' && field === 'fontSize') layer.text.font.size = value;
    else if (layer.type === 'text' && field === 'lineHeight') layer.text.lineHeight = value;
    else if (layer.type === 'text' && field === 'letterSpacing') layer.text.letterSpacing = value;
    else if (layer.type === 'decoration') {
      if (field === 'count' && (layer.spec.kind === 'speed' || layer.spec.kind === 'focus')) layer.spec.count = Math.round(value);
      else if (field === 'angleDeg' && layer.spec.kind === 'speed') layer.spec.angleDeg = value;
      else if (field === 'innerRatio' && layer.spec.kind === 'focus') layer.spec.innerRatio = value;
      else if (field === 'strokeWidth' && (layer.spec.kind === 'speed' || layer.spec.kind === 'focus')) layer.spec.strokeWidth = value;
      else if (field === 'fontSize' && layer.spec.kind === 'sfx') layer.spec.fontSize = value;
      else if (field === 'outlineWidth' && layer.spec.kind === 'sfx') layer.spec.outlineWidth = value;
    }
  }));
}

function Numeric({ id, field, label, value, disabled = false }: { id: Id; field: string; label: string; value: number; disabled?: boolean }) {
  const [draft, setDraft] = useState(String(Math.round(value * 100) / 100));
  const cancelled = useRef(false);
  const edited=useRef(false);
  useLayoutEffect(() => setDraft(String(Math.round(value * 100) / 100)), [value, id]);
  return <label className="field"><span>{label}</span><input aria-label={`对象${label}`} title={disabled ? '此属性受容器控制，请编辑所属分镜或气泡' : label} type="number" disabled={disabled} value={draft} onChange={(e) => {edited.current=true;setDraft(e.target.value);}}
    onFocus={() => { if(isPanelRelocating())return;cancelled.current = false;if(draft===String(Math.round(value*100)/100))edited.current=false; }} onBlur={() => { if (isPanelRelocating()) return; if (!cancelled.current&&edited.current) editNumber(id, label, field, draft); setDraft(String(Math.round(value * 100) / 100)); }}
    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { cancelled.current = true; setDraft(String(value)); e.currentTarget.blur(); } }} /></label>;
}

function SfxContentInput({ id, content }: { id: Id; content: string }) {
  const edit = useStore(textEditStore, (state) => state.active?.layerId === id ? state.active : null);
  const finish = (commit: boolean) => { const result = commit ? commitTextEdit() : cancelTextEdit(); notice(result); if (result.ok) document.querySelector<HTMLElement>('.canvas-viewport')?.focus(); };
  return <div data-text-edit-preserve onBlur={(event) => { if (isPanelRelocating() || (event.relatedTarget instanceof Element && event.relatedTarget.closest('[data-panel-chrome]'))) return; if (!event.currentTarget.contains(event.relatedTarget as Node | null)) notice(commitTextEdit()); }}><label className="field"><span>音效内容</span><textarea aria-label="音效内容" value={edit?.draft.content ?? content}
    onFocus={() => notice(beginSfxTextEdit(id))}
    onChange={(event) => { const node = event.currentTarget; updateTextInput(node.value, node.selectionStart, node.selectionEnd, node.selectionDirection); }}
    onCompositionStart={() => setTextComposing(true)} onCompositionEnd={(event) => { setTextComposing(false); const node = event.currentTarget; updateTextInput(node.value, node.selectionStart, node.selectionEnd); if (!node.closest('[data-text-edit-preserve]')?.contains(document.activeElement)) notice(commitTextEdit()); }}
    onKeyDown={(event) => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); } }} /></label>{edit && <div className="button-stack"><button onPointerDown={(event) => event.preventDefault()} onClick={() => finish(true)}>完成音效编辑</button><button onPointerDown={(event) => event.preventDefault()} onClick={() => finish(false)}>取消音效编辑</button></div>}</div>;
}

function setBubbleShape(id: Id, shape: BubbleShape): void {
  if(documentStore.getState().project.schemaVersion>=6){const began=beginBubbleShapeEdit(id);if(!began.ok){notice(began);return;}const result=setEditedBubbleShape(shape);if(!result.ok){cancelBubbleShapeEdit();notice(result);return;}notice(commitBubbleShapeEdit());return;}
  notice(changeLayer(id, '修改气泡形状', (target, draft) => {
    if (target.type !== 'bubble') return;
    const oldW = target.width, oldH = target.height;
    if (shape === 'circle') {
      const diameter = Math.max(oldW, oldH);
      target.width = diameter; target.height = diameter;
    }
    const ratioX = target.width / oldW, ratioY = target.height / oldH;
    if (target.tail) target.tail = { ...target.tail, tip: { x: target.tail.tip.x * ratioX, y: target.tail.tip.y * ratioY }, baseWidth: target.tail.baseWidth * Math.min(ratioX, ratioY) };
    const dx = (oldW - target.width) / 2, dy = (oldH - target.height) / 2;
    target.matrix = [target.matrix[0], target.matrix[1], target.matrix[2], target.matrix[3], target.matrix[4] + target.matrix[0] * dx + target.matrix[2] * dy, target.matrix[5] + target.matrix[1] * dx + target.matrix[3] * dy];
    target.shape = shape;
    const geometry = buildBubble(shape, target.width, target.height, target.style, target.tail);
    if (!geometry.ok) throw new Error(geometry.problems[0].message);
    const text = target.children[0] ? draft.layers[target.children[0]] : null;
    if (text?.type === 'text') text.box = geometry.value.textBox;
  }));
}

function setBubbleTail(id: Id, kind: 'triangle' | 'line' | null): void {
  if(documentStore.getState().project.schemaVersion>=6){notice(setPrimaryTailKind(id,kind));return;}
  notice(changeLayer(id, '修改气泡尾部', (target) => {
    if (target.type !== 'bubble') return;
    if (kind) {
      if (target.tail) target.tail = { ...target.tail, kind };
      else {
        const candidate = defaultTail(target, kind);
        if (!candidate.ok) throw new Error(candidate.problems[0].message);
        target.tail = candidate.value;
      }
    } else target.tail = null;
    const geometry = buildBubble(target.shape, target.width, target.height, target.style, target.tail);
    if (!geometry.ok) throw new Error(geometry.problems[0].message);
  }));
}

export function InspectorPanel({ layer }: { layer: Layer | undefined }) {
  const mangaEditing=useStore(mangaEditStore,state=>state.active!==null);
  useStore(runtimeStore, (state) => state.fontGeneration);
  const selection = useStore(sessionStore, (state) => state.selection);
  const geometryConstraint = useStore(sessionStore, (state) => state.geometryConstraint);
  const preview = useStore(runtimeStore, (state) => layer ? state.previewProject?.layers[layer.id] : undefined);
  layer = preview ?? layer;
  if (!layer) return <div className="empty-inspector"><span className="empty-glyph">◇</span><p>选择画布对象</p><small>在这里调整位置、形状和样式</small></div>;
  const source = currentTextEdit()?.preview ?? runtimeStore.getState().previewProject ?? documentStore.getState().project;
  if (selection.length > 1) {
    const selectedLayers = selection.map((id) => source.layers[id]);
    if (selectedLayers.every((item) => item?.type === 'panel')) return <div className="inspector-content"><div className="section-title"><span>分镜批量样式</span><small>{selectedLayers.length} 个分镜</small></div><p className="hint">混合值显示 —；输入后整批应用。含锁定对象时整批禁用。</p><PanelStyleInspector panels={selectedLayers} disabled={selectedLayers.some((item) => effectiveLayerFlags(source, item.id).locked)} /></div>;
    return <div className="inspector-content"><h3>已选择 {selection.length} 个对象</h3><p className="hint">混合类型选区可移动或编组；样式请按对象类型分别选择。</p></div>;
  }
  const parent = layer.parentId ? source.layers[layer.parentId] : null;
  const owned = (parent?.type === 'panel' && !(layer.type === 'image' && !layer.crop)) || parent?.type === 'bubble';
  const dimensions = transformDimensions(layer.id, source);
  return <div className="inspector-content" key={layer.id}>
    <div className="section-title"><span>属性</span><small>{layer.type === 'pageBackground' ? '底层' : layer.type.toUpperCase()}</small></div>
    {layer.type==='image'&&source.assets[layer.assetId]?.drawingSource&&<button disabled={effectiveLayerFlags(source,layer.id).locked} onClick={()=>notice(openDrawingWindow(layer.id))}>在绘画窗口编辑</button>}
    {layer.type === 'group' && <button onClick={() => sessionStore.setState({ scopeId: layer.id, selection: [] })}>进入组</button>}

    <h3>{layer.name}</h3>{layer.type!=='image'&&layer.type!=='pageBackground'&&<button className="preset-save-button" onClick={()=>notice(openPresetDialog())}>保存为组件预设…</button>}
    {effectiveLayerFlags(source, layer.id).locked && <p className="hint" role="status">“{layer.name}”或其祖先已锁定；请在图层列表解锁后修改属性。</p>}
    <fieldset className="inspector-edit" disabled={effectiveLayerFlags(source,layer.id).locked}>{layer.type==='bubble'&&<BubbleShapeInspector bubble={layer}/>} {layer.type==='bubbleTail'&&<TailInspector tail={layer}/>} {layer.type==='group'&&layer.dialogue&&<DialogueInspector group={layer}/>}</fieldset>
    <fieldset className="inspector-edit" title={effectiveLayerFlags(source, layer.id).locked ? `“${layer.name}”或其祖先已锁定，请先解锁` : undefined} disabled={effectiveLayerFlags(source, layer.id).locked||mangaEditing}>
    {layer.type !== 'pageBackground' && <><p className="hint">位置为父级坐标 · 尺寸为局部尺寸{owned ? ' · 受容器控制' : ''}</p>
    <div className="field-grid"><Numeric id={layer.id} field="x" label="X" disabled={owned} value={layer.matrix[4]} /><Numeric id={layer.id} field="y" label="Y" disabled={owned} value={layer.matrix[5]} /></div></>}
    {dimensions && layer.type !== 'pageBackground' && <><div className="field-grid"><Numeric id={layer.id} field="width" label="宽" value={dimensions.width} disabled={owned && layer.type !== 'panel'} /><Numeric id={layer.id} field="height" label="高" value={dimensions.height} disabled={owned && layer.type !== 'panel'} /></div><div className="field-grid"><Numeric id={layer.id} field="rotation" label="旋转" value={decompose(layer.matrix).thetaRad * 180 / Math.PI} disabled={owned} /></div></>}
    {layer.type === 'panel' && <>
      {layer.children.map(id => source.layers[id]).filter(item => item?.type === 'image').map(image => <button key={image.id} onClick={() => notice(enableFreeImage(image.id))}>编辑素材 {image.name}</button>)}
      <PanelStyleInspector panels={[layer]} />{layer.role === 'split' && <><button onClick={() => notice(separatePanelLayout(layer.id))}>拆为独立分镜</button><p className="hint">移除分格父框及其裁剪，保留各格页面位置和图片裁剪。</p></>}
      <label className="geometry-constraint"><input aria-label="平行四边形约束" type="checkbox" disabled={!isParallelogram(layer.geometry)} checked={geometryConstraint === 'parallelogram'} onChange={(event) => sessionStore.setState({ geometryConstraint: event.target.checked ? 'parallelogram' : 'freeConvex' })} />平行四边形约束{!isParallelogram(layer.geometry) && <small>仅现有平行四边形可启用</small>}</label>
      <div className="button-stack"><button onClick={() => { notice(openPresetDialog()); }}>存为组件</button><button onClick={() => { cancelActiveGesture(); sessionStore.setState({ toolMode: 'geometry' }); }}>编辑顶点与边</button>{layer.children.some((id) => { const child = source.layers[id]; return child?.type === 'image' && !!child.crop; }) && <button onClick={() => notice(beginCropEdit(layer.id))}>编辑裁剪</button>}</div><div className="button-stack"><button disabled={layer.role !== 'leaf'} onClick={() => notice(beginDrawing('edit', layer.id))}>修正分格轮廓</button><button disabled={layer.role !== 'leaf' || !breakoutSplitGuard(source, layer.id).ok} title={(() => { const r = breakoutSplitGuard(source, layer.id); return r.ok ? undefined : r.problems[0].message; })()} onClick={() => notice(beginDrawing('line', layer.id))}>直线切割工具</button></div><CutInspector id={layer.id} leaf={layer.role === 'leaf'} />
    </>}
    {layer.type === 'pageBackground' && <PageBackgroundInspector layer={layer} />}
    {layer.type === 'image' && <ImageInspector image={layer} />}
    {layer.type === 'text' && <><TextInspector layer={layer} />{layer.role==='sfx'&&<EffectTextInspector layer={layer}/>}</>}
    {layer.type === 'bubble' && <><Numeric id={layer.id} field="borderWidth" label="边框" value={layer.style.borderWidth} /><Numeric id={layer.id} field="radius" label="圆角" value={layer.style.radius} /><BubbleStyleInspector bubble={layer} /><label className="field bubble-select"><span>形状</span><select value={layer.shape} onChange={(e) => setBubbleShape(layer.id, e.target.value as BubbleShape)}><option value="rect">方框</option><option value="roundRect">圆角</option><option value="circle">圆形</option><option value="cloud">云朵</option><option value="spiky">尖刺</option></select></label><div className="button-stack"><button onClick={() => setBubbleTail(layer.id, null)}>无尾</button><button onClick={() => setBubbleTail(layer.id, 'triangle')}>三角尾</button><button onClick={() => setBubbleTail(layer.id, 'line')}>线尾</button></div><p className="hint">双击气泡编辑对白</p></>}
    {layer.type === 'decoration' && <>
      {layer.spec.kind === 'speed-brush' ? <p className="hint">独立速度线笔触 · 可移动、缩放、旋转和换色。笔刷参数用于下一笔。</p> : layer.spec.kind === 'sfx' ? <><SfxContentInput id={layer.id} content={layer.spec.content} /><div className="field-grid"><Numeric id={layer.id} field="fontSize" label="字号" value={layer.spec.fontSize} /><Numeric id={layer.id} field="outlineWidth" label="描边" value={layer.spec.outlineWidth} /></div></> : <><div className="field-grid"><Numeric id={layer.id} field="count" label="线数" value={layer.spec.count} /><Numeric id={layer.id} field="strokeWidth" label="线宽" value={layer.spec.strokeWidth} /></div>{layer.spec.kind === 'speed' ? <Numeric id={layer.id} field="angleDeg" label="角度" value={layer.spec.angleDeg} /> : <Numeric id={layer.id} field="innerRatio" label="留白比例" value={layer.spec.innerRatio} />}</>}
      <label className="color-field">颜色 <input type="color" value={layer.spec.color.slice(0, 7)} onChange={(event) => notice(changeLayer(layer.id, '修改装饰颜色', (target) => { if (target.type === 'decoration') target.spec.color = `${event.target.value}FF`; }))} /></label>
    </>}
    <div className="button-stack"><button onClick={() => notice(moveLayer(layer.id, 'top'))}>置顶</button><button onClick={() => notice(moveLayer(layer.id, 'up'))}>上移</button><button onClick={() => notice(moveLayer(layer.id, 'down'))}>下移</button><button onClick={() => notice(moveLayer(layer.id, 'bottom'))}>置底</button></div>
    {(() => { const project = documentStore.getState().project; const parent = layer.parentId ? project.layers[layer.parentId] : null; const groups = Object.values(project.layers).filter((item) => item.type === 'group' && item.pageId === layer.pageId && item.id !== layer.id && item.id !== layer.parentId); return <div className="button-stack">
      {parent?.type === 'group' && <button onClick={() => notice(reparent([layer.id], null))}>移出组</button>}
      {(parent?.type === 'panel' || parent?.type === 'bubble') && <button onClick={() => { if (window.confirm('移出后不再受容器裁剪。继续？')) notice(detachOwned(layer.id)); }}>移出容器</button>}
      {(parent === null || parent.type === 'group') && groups.length > 0 && <label className="reparent-select">移入组 <select aria-label="移入组" value="" onChange={(event) => { if (event.target.value) notice(reparent([layer.id], event.target.value)); }}><option value="">选择目标编组</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
    </div>; })()}
    </fieldset>
  </div>;
}

