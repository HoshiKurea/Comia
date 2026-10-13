import {FlashInspector,ComicLayerInspector} from '../comicDrawing/ComicLayerInspector';
import {ReferenceTransform,ReferenceAppearance,ReferenceEffects} from '../appearance/ReferenceControls';
import {ReferenceGeometry} from '../appearance/ReferenceGeometry';
import {geometryPanel} from '../appearance/geometry';
import { PageBackgroundInspector } from '../pages/PageBackgroundInspector';
import { openDrawingWindow } from '../freehand/session';
import { ImageInspector } from '../images/ImageInspector';
import { enableFreeImage } from '../images/freeImage';
import { separatePanelLayout } from '../panels/independentLayout';
import { useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { Id, Layer, Result } from '../domain/types';
import { firstMessage } from '../domain/types';
import { documentStore } from '../state/documentStore';
import { sessionStore, pushNotice, type NoticeContext } from '../state/sessionStore';
import { changeLayer, deleteSelected } from '../app/actions';
import { copyToClipboard, pasteFromClipboard } from '../layers/clipboard';
import { InspectorLayout, InspectorSection, InspectorIcon } from './InspectorLayout';
import { TextInspector } from '../text/TextInspector';
import { EffectTextInspector } from '../text/EffectTextInspector';
import { currentTextEdit, beginSfxTextEdit, commitTextEdit, setTextComposing, textEditStore, updateTextInput } from '../text/editController';
import { cancelTextEdit } from '../text/editController';
import { setDimensions, setRotation } from '../interaction/transformCommands';
import { CutInspector } from '../panels/CutInspector';
import { beginCropEdit } from '../images/editCommands';
import { runtimeStore } from '../state/runtimeStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { moveLayers } from '../layers/reorder';
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
  const unit = field === 'rotation' ? '°' : ['x','y','width','height','borderWidth','radius','fontSize','outlineWidth','strokeWidth'].includes(field) ? 'px' : '';
  return <label className="field"><span>{label}</span><input aria-label={`对象${label}`} title={disabled ? '此属性受容器控制，请编辑所属分镜或气泡' : label} type="number" disabled={disabled} value={draft} onChange={(e) => {edited.current=true;setDraft(e.target.value);}}
    onFocus={() => { if(isPanelRelocating())return;cancelled.current = false;if(draft===String(Math.round(value*100)/100))edited.current=false; }} onBlur={() => { if (isPanelRelocating()) return; if (!cancelled.current&&edited.current) editNumber(id, label, field, draft); setDraft(String(Math.round(value * 100) / 100)); }}
    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { cancelled.current = true; setDraft(String(value)); e.currentTarget.blur(); } }} />{unit && <em className="field-unit">{unit}</em>}</label>;
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

function DecorationProperties({layer}:{layer:Extract<Layer,{type:'decoration'}>}) {
  const spec=layer.spec;if(spec.kind==='shape'||spec.kind==='paint'||spec.kind==='background-fill')return null;
  return <><label className="color-field">颜色<input aria-label="装饰颜色" type="color" value={spec.color.slice(0,7)} onChange={e=>notice(changeLayer(layer.id,'修改装饰颜色',l=>{if(l.type==='decoration'&&l.spec.kind!=='shape'&&l.spec.kind!=='paint')l.spec.color=e.target.value+'FF';}))}/></label>{spec.kind==='sfx'?<><SfxContentInput id={layer.id} content={spec.content}/><Numeric id={layer.id} field="fontSize" label="字号" value={spec.fontSize}/><Numeric id={layer.id} field="outlineWidth" label="描边" value={spec.outlineWidth}/></>:spec.kind==='speed-brush'?<p className="hint">独立速度线笔触；笔刷参数用于下一笔。</p>:<><Numeric id={layer.id} field="count" label="线数" value={spec.count}/><Numeric id={layer.id} field="strokeWidth" label="线宽" value={spec.strokeWidth}/>{spec.kind==='speed'?<Numeric id={layer.id} field="angleDeg" label="角度" value={spec.angleDeg}/>:<Numeric id={layer.id} field="innerRatio" label="留白比例" value={spec.innerRatio}/>}</>}</>;
}

function QuickActions({ layer, disabled }: { layer: Layer; disabled: boolean }) {
  const ids = sessionStore.getState().selection, project = documentStore.getState().project;
  const sortDisabled = ids.some(id => project.layers[id]?.type === 'pageBackground' || project.layers[id]?.parentId !== project.layers[ids[0]]?.parentId);
  return <div className="inspector-quick-actions">
    <button disabled={disabled || ids.some(id => project.layers[id]?.type === 'pageBackground')} onClick={() => { const r = copyToClipboard(ids); if (r.ok) notice(pasteFromClipboard(layer.pageId)); else notice(r); }}><InspectorIcon kind="copy"/>复制图层</button>
    <button disabled={disabled} onClick={() => notice(deleteSelected())}><InspectorIcon kind="delete"/>删除图层</button>
    {(['up', 'down', 'top', 'bottom'] as const).map((direction, index) => <button key={direction} disabled={disabled || sortDisabled} onClick={() => notice(moveLayers(ids, direction))}><InspectorIcon kind={direction}/>{['上移一层', '下移一层', '置顶', '置底'][index]}</button>)}
  </div>;
}

export function InspectorPanel({ layer }: { layer: Layer | undefined }) {
  const mangaEditing = useStore(mangaEditStore, state => state.active !== null);
  useStore(runtimeStore, state => state.fontGeneration);
  const selection = useStore(sessionStore, state => state.selection);
  const preview = useStore(runtimeStore, state => layer ? state.previewProject?.layers[layer.id] : undefined);
  layer = preview ?? layer;
  if (!layer) return <div className="empty-inspector"><span className="empty-glyph">◇</span><p>选择画布对象</p><small>在这里调整位置、形状和样式</small></div>;
  const source = currentTextEdit()?.preview ?? runtimeStore.getState().previewProject ?? documentStore.getState().project;
  const formal = documentStore.getState().project, thumbnailProject = formal.layers[layer.id] ? formal : source;
  const locked = selection.some(id => effectiveLayerFlags(source, id).locked);
  if (selection.length > 1) {
    return <InspectorLayout key={selection.join('|')} layer={layer} project={thumbnailProject} count={selection.length}>
      <InspectorSection title="变换" category="transform"><ReferenceTransform layer={layer} ids={selection} disabled={locked}/></InspectorSection>
      <InspectorSection title="外观" category="appearance"><ReferenceAppearance layer={layer} ids={selection} disabled={locked}/></InspectorSection>
      <InspectorSection title="效果" category="effects"><ReferenceEffects layer={layer} ids={selection} disabled={locked}/></InspectorSection>
      <InspectorSection title="选区操作" category="adjustments"><p className="hint">复制、删除和编组作用于整个选区；混合类型的样式请按对象类型分别选择。</p></InspectorSection>
      <InspectorSection title="快速操作" category="quick"><QuickActions layer={layer} disabled={locked || mangaEditing}/></InspectorSection>
    </InspectorLayout>;
  }
  const parent = layer.parentId ? source.layers[layer.parentId] : null;
  const restricted = effectiveLayerFlags(source, layer.id).locked;
  return <InspectorLayout key={layer.id} layer={layer} project={thumbnailProject}>
    {restricted && <p className="hint" role="status">“{layer.name}”或其祖先已锁定；请在图层列表解锁后修改属性。</p>}
    {layer.type !== 'pageBackground' && <InspectorSection title="变换" category="transform"><ReferenceTransform layer={layer} ids={selection} disabled={restricted||mangaEditing}/></InspectorSection>}
    <InspectorSection title="外观" category="appearance"><ReferenceAppearance layer={layer} ids={selection} disabled={restricted||mangaEditing} extra={layer.type==='bubble'?<details className="ref-extras"><summary>气泡内外描边</summary><BubbleStyleInspector bubble={layer} bandsOnly/></details>:layer.type==='decoration'?<DecorationProperties layer={layer}/>:undefined}/></InspectorSection>
    <InspectorSection title={geometryPanel(layer) ? '几何与路径' : layer.type === 'bubble' ? '轮廓与对白' : '内容与调整'} category="adjustments"><fieldset className="inspector-edit" disabled={restricted}>
      {geometryPanel(layer)&&<ReferenceGeometry layer={layer} disabled={restricted}/>}
      {layer.type === 'panel' && <details className="ref-extras"><summary>分镜与切割选项</summary>
        {layer.children.map(id => source.layers[id]).filter(item => item?.type === 'image').map(image => <button key={image.id} onClick={() => notice(enableFreeImage(image.id))}>编辑素材 {image.name}</button>)}
        {layer.role === 'split' && <><button onClick={() => notice(separatePanelLayout(layer!.id))}>拆为独立分镜</button><p className="hint">移除分格父框及其裁剪，保留各格页面位置和图片裁剪。</p></>}
        <div className="button-stack"><button onClick={() => notice(openPresetDialog())}>存为组件</button>{layer.children.some(id => { const c = source.layers[id]; return c?.type === 'image' && !!c.crop; }) && <button onClick={() => notice(beginCropEdit(layer!.id))}>编辑裁剪</button>}</div>
        <CutInspector id={layer.id} leaf={layer.role === 'leaf'}/>
      </details>}
      {layer.type==='decoration'&&<ComicLayerInspector layer={layer}/>}
      {layer.type === 'bubble' && <><FlashInspector bubble={layer}/><BubbleShapeInspector bubble={layer}/><fieldset className="inspector-edit" disabled={mangaEditing}>
        <label className="field bubble-select"><span>形状</span><select value={layer.shape} onChange={e => setBubbleShape(layer!.id, e.target.value as BubbleShape)}><option value="rect">方框</option><option value="roundRect">圆角</option><option value="circle">圆形</option><option value="ellipse">椭圆</option><option value="cloud">云朵</option><option value="spiky">尖刺</option>{layer.shape === 'freehand' && <option value="freehand">手绘轮廓</option>}</select></label>
        <div className="button-stack"><button onClick={() => setBubbleTail(layer!.id, null)}>无尾</button><button onClick={() => setBubbleTail(layer!.id, 'triangle')}>三角尾</button><button onClick={() => setBubbleTail(layer!.id, 'line')}>线尾</button></div><p className="hint">双击气泡编辑对白</p>
      </fieldset></>}
      {layer.type === 'bubbleTail' && <TailInspector tail={layer}/>}
      {layer.type === 'group' && <><button onClick={() => sessionStore.setState({ scopeId: layer!.id, selection: [] })}>进入组</button>{layer.dialogue && <DialogueInspector group={layer}/>}</>}
      {layer.type === 'image' && <>{source.assets[layer.assetId]?.drawingSource && <button onClick={() => notice(openDrawingWindow(layer!.id))}>在绘画窗口编辑</button>}<ImageInspector image={layer}/></>}
      {layer.type === 'pageBackground' && <PageBackgroundInspector layer={layer}/>}
      {layer.type === 'text' && <TextInspector layer={layer}/>}
    </fieldset></InspectorSection>
    <InspectorSection title="效果" category="effects"><ReferenceEffects layer={layer} ids={selection} disabled={restricted||mangaEditing}/>{layer.type==='text'&&layer.role==='sfx'&&<EffectTextInspector layer={layer}/>}</InspectorSection>
    <InspectorSection title="快速操作" category="quick"><fieldset className="inspector-edit" disabled={restricted || mangaEditing}>
      <QuickActions layer={layer} disabled={restricted || mangaEditing}/>
      {layer.type !== 'image' && layer.type !== 'pageBackground' && <button className="preset-save-button" onClick={() => notice(openPresetDialog())}>保存为组件预设…</button>}
      <div className="button-stack">{parent?.type === 'group' && <button onClick={() => notice(reparent([layer!.id], null))}>移出组</button>}{(parent?.type === 'panel' || parent?.type === 'bubble') && <button onClick={() => { if (window.confirm('移出后不再受容器裁剪。继续？')) notice(detachOwned(layer!.id)); }}>移出容器</button>}
        {(parent === null || parent.type === 'group') && Object.values(source.layers).some(g => g.type === 'group' && g.pageId === layer!.pageId && g.id !== layer!.id && g.id !== layer!.parentId) && <label className="reparent-select">移入组<select aria-label="移入组" value="" onChange={e => { if (e.target.value) notice(reparent([layer!.id], e.target.value)); }}><option value="">选择目标编组</option>{Object.values(source.layers).filter(g => g.type === 'group' && g.pageId === layer!.pageId && g.id !== layer!.id && g.id !== layer!.parentId).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>}
      </div>
    </fieldset></InspectorSection>
  </InspectorLayout>;
}
