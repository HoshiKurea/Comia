import {geometryPanel,setGeometry,rectangleVertex} from '../appearance/geometry';
import {propertyAnchor} from '../appearance/commands';
import {appearanceEditStore,currentAppearanceEdit,cancelAppearanceEdit} from '../appearance/commands';
import {BubbleBrushSurface} from '../bubbles/BubbleBrushSurface';
import {bubbleBrushStore,currentBubbleBrush} from '../bubbles/brushController';
import {recordDrawingFrame} from '../freehand/metrics';
import {beginAreaSelection,appendAreaPoint,validAreaShape,type AreaSelectionGesture} from '../interaction/areaSelectionGesture';
import {areaHits,combineAreaSelection,isAreaTool} from '../interaction/regionSelection';
import {drawAreaSelection} from '../render/areaSelectionOverlay';
import {beginPanelCutPointer,updatePanelCutPointer,finishPanelCutPointer,type ToolCutPointer} from '../interaction/panelCutTool';
import {beginImageMaskTarget} from '../interaction/imageMaskTool';
import {TrimEditor} from '../images/TrimEditor';
import {currentImageTrim,trimEditStore} from '../images/trimController';
import {beginImageCropTarget} from '../interaction/imageCropTool';
import {cancelDrawing} from '../panels/drawingController';
import { MangaEditPanel } from '../bubbles/MangaEditPanel';
import { SpeedBrushSurface } from '../library/SpeedBrushSurface';
import { speedBrushStore, currentSpeedStroke } from '../library/speedBrushController';
import { componentSceneDraft } from '../panels/instantiate';
import { CanvasContextMenu } from './CanvasContextMenu';
import { associationStore, clearAssociation, suggestAssociation } from '../images/associationController';
import { bindImagesDraft, rankPanelOverlaps } from '../images/panelAssociation';
import { tracePath } from '../render/drawScene';
import { buildRoundedPolygon } from '../geometry/roundedPolygon';
import { BreakoutEditor } from '../images/BreakoutEditor';
import { currentBreakoutEdit, breakoutEditStore } from '../images/breakoutController';
import { MaskEditor } from '../images/MaskEditor';
import { beginMaskEdit, currentMaskEdit, maskEditStore } from '../images/maskController';
import { preserveUnlinkedMasks } from '../images/maskGeometry';
import { DrawingSurface } from '../panels/DrawingSurface';
import { currentDrawing, drawingStore } from '../panels/drawingController';
import { useEffect, useRef, useState } from 'react';
import { Layer, Shape, Stage } from 'react-konva';
import { selectionPolygon as screenPolygon, selectionOutlines, drawSelectionOutlines } from '../render/selectionOverlay';
import { getPanelNumberLabels } from '../panels/numberOverlay';
import type Konva from 'konva';
import { useStore } from 'zustand';
import type { Id, Layer as ComicLayer, Point, Project, Rect, Viewport } from '../domain/types';
import { apply, clientToPage, decompose, inverse, multiply, pageToScreen, rotationRad, scaling, translation, worldMatrix } from '../geometry/matrix';
import { drawPage, hitLayer, hitVisibleImage, pointInsidePanelClips, type ImageResources } from '../render/drawScene';
import { assistNodeDrag, emptyNodeAssist, type NodeAssistContext, type NodeAssistState, type NodeGuide } from '../interaction/nodeDragAssist';
import { currentNodeEdit, geometryNodeStore, pickPanelVertex, selectGeometryNode, constrainNodeGeometry } from '../interaction/geometryNodeEdit';
import { requestElementHint, hideElementHint, leaveElementHint } from './ElementHintPanel';
import { beginGestureRuns, disposeGestureRuns, drawGestureRuns, type GestureRuns } from '../render/gestureRuns';
import { contourDamage } from '../render/contourDamage';
import { documentStore } from '../state/documentStore';
import { getViewport, sessionStore, setSelection, setViewport, pushNotice } from '../state/sessionStore';
import { addGestureDraws, addMainDraws, addOverlayDraws, runtimeStore } from '../state/runtimeStore';
import { changeLayer, placeObjectDraft } from './actions';
import { decodeImage, placeImages } from '../assets/importImage';
import { makeAsyncToken, isTokenCurrent } from '../history/asyncGuard';
import { hasLockedDescendant } from '../layers/group';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { registerGestureCanceller } from '../interaction/activeGesture';
import { panCrop, reflowCrop } from '../images/crop';
import { cancelCropEdit, commitCropEdit, cropEditStore, currentCropEdit, previewCropParams, previewCropZoom } from '../images/cropController';
import { CropControls } from '../images/CropControls';
import { execute } from '../history/commandBus';
import { moveTailBase, moveTailTip, tailBasePoint } from '../bubbles/tail';
import { currentCreation, registerCreationDrop, subscribeCreation } from '../library/creationController';
import { resolveComponentPlacement } from '../library/placement';
import { currentTextEdit, commitTextEdit, textEditStore, beginBubbleTextEdit } from '../text/editController';
import { textPointer } from '../text/editorPointer';
import { TextEditor } from '../text/TextEditor';
import { BubbleTextFrameEditor } from '../text/BubbleTextFrameEditor';
import { cancelKeyboardMove, currentKeyboardMove, keyboardMoveStore } from '../interaction/keyboardMove';
import { currentBackgroundEdit, backgroundEditStore } from '../pages/backgroundController';
import { currentPanelStyle, panelStyleStore } from '../panels/style';
import { cutPreviewStore } from '../panels/cutPanel';
import { localLayerBounds } from '../interaction/layerBounds';
import { rectHandle, resizedRect, resizeProject } from '../interaction/resize';
import { selectionRoots, selectionTransformBounds, transformSelectionDraft } from '../interaction/selectionTransform';
import { rotateAround, snappedRotation, unwrapStep, normalizeDegrees } from '../interaction/rotate';
import { constrainPanelGeometry, moveVertex } from '../panels/editGeometry';
import { beginPanelImageEdit } from '../images/editCommands';
import { collectMoveSnap, snapMove, type MoveSnap } from '../interaction/snap';
import { fitPage, panBy, pinchViewport, zoomAt } from '../interaction/viewport';
import { captureViewport, drawViewportBitmap, releaseViewportBitmap, type ViewportBitmap } from '../render/viewportBitmap';
import { DoubleTapRecognizer } from '../interaction/doubleTap';
import { vertexAngle, edgeDisplacement } from '../panels/geometryFeedback';
import { mangaEditStore, currentMangaEdit, cancelMangaEdit } from '../bubbles/mangaEditController';
import { MangaGeometryEditor } from '../bubbles/MangaGeometryEditor';
import { createAttachedTail } from '../bubbles/tailCommands';
import { prepareDialogue } from '../bubbles/dialogueGeometry';
import { editorGeometryTarget } from '../bubbles/editorTarget';

type Handle = { kind: 'vertex' | 'edge' | 'resize' | 'rotate' | 'tailTip' | 'tailBase'; index: number; point: Point };
type Gesture = { id: Id; ids: Id[]; pointerId: number; kind: 'move' | 'crop' | Handle['kind']; index: number; start: Point; project: Project; layer: ComicLayer; center: Point; shared?: Rect; singleNode?: boolean; assist?: {context:NodeAssistContext;state:NodeAssistState;guides:NodeGuide[]}; snap?: MoveSnap | null; rotation?: { pivotLocal: Point; pivotParent: Point; pointerAngle: number; delta: number; startAngle: number } };

function handles(project: Project, id: Id, vp: Viewport, mode: string): Handle[] {
  const layer = project.layers[id];
  const points = screenPolygon(project, id, vp);
  if (!points.length || !layer) return [];
  if (mode === 'geometry' && geometryPanel(layer)) {
    return points.flatMap((p, i) => [
      { kind: 'vertex' as const, index: i, point: p },
      { kind: 'edge' as const, index: i, point: { x: (p.x + points[(i + 1) % points.length].x) / 2, y: (p.y + points[(i + 1) % points.length].y) / 2 } },
    ]);
  }
  if (layer.type === 'pageBackground') return [];
  const parent = layer.parentId ? project.layers[layer.parentId] : null;
  if ((parent?.type === 'panel' && !(layer.type === 'image' && !layer.crop)) || parent?.type === 'bubble') return [];
  const box = localLayerBounds(project, id); if (!box) return [];
  const x0 = box.x, y0 = box.y, x1 = box.x + box.width, y1 = box.y + box.height;
  const locals = [{ x: x0, y: y0 }, { x: (x0 + x1) / 2, y: y0 }, { x: x1, y: y0 }, { x: x1, y: (y0 + y1) / 2 }, { x: x1, y: y1 }, { x: (x0 + x1) / 2, y: y1 }, { x: x0, y: y1 }, { x: x0, y: (y0 + y1) / 2 }];
  const world = worldMatrix(project, id);
  const result: Handle[] = locals.map((point, index) => ({ kind: 'resize', index, point: pageToScreen(apply(world, point), vp) }));
  const top = result[1].point;
  const bottom = result[5].point, length = Math.hypot(top.x - bottom.x, top.y - bottom.y);
  if (length > 0) result.push({ kind: 'rotate', index: 0, point: { x: top.x + (top.x - bottom.x) * 24 / length, y: top.y + (top.y - bottom.y) * 24 / length } });
  if (layer?.type === 'bubble' && layer.tail) {
    result.push({ kind: 'tailTip', index: 0, point: pageToScreen(apply(world, layer.tail.tip), vp) });
    const base = tailBasePoint(layer);
    if (base.ok) result.push({ kind: 'tailBase', index: 0, point: pageToScreen(apply(world, base.value), vp) });
  }
  return result;
}

function pointNear(a: Point, b: Point, radius: number): boolean { return Math.hypot(a.x - b.x, a.y - b.y) <= radius; }
function sharedHandles(project: Project, ids: Id[], vp: Viewport): Handle[] {
  const box = selectionTransformBounds(project, ids); if (!box || box.width <= 0 || box.height <= 0) return [];
  const result: Handle[] = Array.from({ length: 8 }, (_, index) => ({ kind: 'resize', index, point: pageToScreen(rectHandle(box, index), vp) }));
  result.push({ kind: 'rotate', index: 0, point: { x: result[1].point.x, y: result[1].point.y - 24 } }); return result;
}
function centerOf(points: Point[]): Point {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}
function movableRoots(project: Project, ids: Id[]): Id[] {
  return selectionRoots(project, ids);
}
export function fit(page: { width: number; height: number }, size: { width: number; height: number }): Viewport {
  return fitPage(page, { x: size.width, y: size.height });
}

export function CanvasView({ onEditText,areaDisabled=false }: { onEditText: (id: Id) => void;areaDisabled?:boolean }) {
  const project = useStore(documentStore, (s) => s.project);
  const pageId = useStore(sessionStore, (s) => s.activePageId);
  const selection = useStore(sessionStore, (s) => s.selection);
  const mode = useStore(sessionStore, (s) => s.toolMode);
  const cropTarget = useStore(sessionStore, (s) => s.cropTarget);
  const breakoutEditing = useStore(breakoutEditStore, s => s.active !== null);
  const breakoutRuns = useRef<GestureRuns | null>(null);
  const trimEditing = useStore(trimEditStore,s=>s.active!==null);
  const maskEditing = useStore(maskEditStore, s => s.active !== null);
  const maskRuns = useRef<GestureRuns | null>(null);
  const cropEditing = useStore(cropEditStore, (s) => s.active !== null);
  const textEditingId = useStore(sessionStore, (s) => s.textEditingId);
  const spacePan = useStore(sessionStore, (s) => s.spacePan);
  const keyboardMoving = useStore(keyboardMoveStore, (state) => state.active !== null);
  const nodeEditing = useStore(geometryNodeStore, s=>s.active!==null);
  const appearanceEditing=useStore(appearanceEditStore,s=>s.active!==null),appearanceRuns=useRef<GestureRuns|null>(null);
  useEffect(()=>{const off=appearanceEditStore.subscribe(()=>gestureLayer.current?.batchDraw());const blur=()=>cancelAppearanceEdit();window.addEventListener('blur',blur);return()=>{off();window.removeEventListener('blur',blur);disposeGestureRuns(appearanceRuns.current);};},[]);
  const styleEditing = useStore(panelStyleStore, (state) => state.active !== null);
  const backgroundEditing = useStore(backgroundEditStore, state => state.active !== null);
  const backgroundRuns = useRef<GestureRuns | null>(null);
  const mangaEditing=useStore(mangaEditStore,state=>state.active!==null),mangaRuns=useRef<GestureRuns|null>(null);
  const brushEditing = useStore(speedBrushStore, state => state.active !== null);
  const bubbleBrushEditing=useStore(bubbleBrushStore,s=>!!s.active?.valid),bubbleBrushRuns=useRef<GestureRuns|null>(null);
  useEffect(()=>{const off=bubbleBrushStore.subscribe(()=>{if(currentBubbleBrush()?.valid)gestureLayer.current?.batchDraw();});return()=>{off();disposeGestureRuns(bubbleBrushRuns.current);};},[]);
  useEffect(()=>{if(!appearanceEditing){disposeGestureRuns(appearanceRuns.current);appearanceRuns.current=null;}},[appearanceEditing]);
  const brushRuns = useRef<GestureRuns | null>(null);
  const renderFailure=useRef<string|null>(null);
  const paperDisplay = useRef<HTMLDivElement>(null);
  const contourEditing = useStore(drawingStore, state => state.active?.kind === 'edit');
  const contourRuns = useRef<GestureRuns | null>(null);
  const paintedContour = useRef<{ cache: GestureRuns; project: Project; id: Id; images: ImageResources; fontGeneration: number } | null>(null);
  const viewportByPage = useStore(sessionStore, (s) => s.viewportByPage);
  const page = project.pages[pageId];
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(()=>{const root=rootRef.current;if(!root)return;const preventNativeScroll=(event:WheelEvent)=>{if(!(event.target as Element)?.closest('.visible-input'))event.preventDefault();};root.addEventListener('wheel',preventNativeScroll,{passive:false,capture:true});return()=>root.removeEventListener('wheel',preventNativeScroll,true);},[]);
  const gestureLayer = useRef<Konva.Layer>(null);
  const overlayLayer = useRef<Konva.Layer>(null);
  const areaRef=useRef<AreaSelectionGesture|null>(null);
  const areaBoundsRef=useRef<DOMRect|null>(null);
  const cutToolPointer=useRef<ToolCutPointer|null>(null),cutToolBounds=useRef<DOMRect|null>(null),cutToolFrame=useRef<number|null>(null),cutToolPending=useRef<Point|null>(null);
  const cancelCutTool=()=>{const p=cutToolPointer.current;cutToolPointer.current=null;cutToolBounds.current=null;cutToolPending.current=null;if(cutToolFrame.current!==null)cancelAnimationFrame(cutToolFrame.current);cutToolFrame.current=null;if(p){cancelDrawing();if(rootRef.current?.hasPointerCapture(p.pointerId))rootRef.current.releasePointerCapture(p.pointerId);}};
  const flushCutTool=()=>{const p=cutToolPointer.current,q=cutToolPending.current;cutToolPending.current=null;if(p&&q){const r=updatePanelCutPointer(p,q);if(!r.ok){pushNotice('error',r.problems[0].message);cancelCutTool();}}};

  const finishArea=(commit=false)=>{
    const g=areaRef.current;if(!g)return;areaRef.current=null;areaBoundsRef.current=null;
    const doc=documentStore.getState(),s=sessionStore.getState();
    const current=doc.project===g.project&&doc.epoch===g.epoch&&s.activePageId===g.pageId&&s.scopeId===g.scopeId;
    if(commit&&current){
      if(g.shape.kind==='lasso'&&!validAreaShape(g))pushNotice('info','请圈出一个区域');
      else{const hits=validAreaShape(g)?areaHits(g.shape,g.candidates,g.options.match):[];const next=combineAreaSelection(g.baseSelection,hits,g.options.combination).filter(id=>doc.project.layers[id]?.pageId===g.pageId);setSelection(next,next[0]??null);}
    }else if(current&&(s.selectionAnchorId!==g.baseAnchor||s.selection.join('|')!==g.baseSelection.join('|')))setSelection(g.baseSelection,g.baseAnchor);
    runtimeStore.setState({gestureActive:false});overlayLayer.current?.batchDraw();
  };
  useEffect(()=>{const blur=()=>{finishArea(false);cancelCutTool();};window.addEventListener('blur',blur);return()=>window.removeEventListener('blur',blur);});

  const creationLayer = useRef<Konva.Layer>(null);
  const creationFrame = useRef<number | null>(null);
  const creationCache = useRef<{ project: Project; scopeId: Id | null; id: Id; runs: GestureRuns } | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const previewRef = useRef<Project | null>(null);
  const runCacheRef = useRef<GestureRuns | null>(null);
  const textRuns = useRef<GestureRuns | null>(null);
  const keyboardRuns = useRef<GestureRuns | null>(null);
  const nodeRuns = useRef<GestureRuns | null>(null);
  const hoverFrame = useRef<number|null>(null),hoverPending=useRef<{point:Point;client:Point}|null>(null);
  useEffect(()=>()=>{if(hoverFrame.current!==null)cancelAnimationFrame(hoverFrame.current);hideElementHint();},[]);
  useEffect(()=>{let frame:number|null=null;const unsub=geometryNodeStore.subscribe(()=>{if(frame===null)frame=requestAnimationFrame(()=>{frame=null;gestureLayer.current?.batchDraw();overlayLayer.current?.batchDraw();});});return()=>{unsub();if(frame!==null)cancelAnimationFrame(frame);disposeGestureRuns(nodeRuns.current);};},[]);
  const styleRuns = useRef<GestureRuns | null>(null);
  const cropRuns = useRef<GestureRuns | null>(null);
  const panRef = useRef<{ pointerId: number; start: Point; initial: Viewport; viewport: Viewport; bitmap: ViewportBitmap; pending: Point | null } | null>(null);
  const wheelRef = useRef<{ viewport: Viewport; bitmap: ViewportBitmap } | null>(null);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewFrame = useRef<number | null>(null);
  const touchPoints = useRef(new Map<number, Point>());
  const doubleTap = useRef(new DoubleTapRecognizer());
  const lastPointerType = useRef('mouse');
  const pinchRef = useRef<{ ids: number[]; initial: Viewport; midpoint: Point; distance: number; viewport: Viewport; bitmap: ViewportBitmap } | null>(null);
  const panFrame = useRef<number | null>(null);
  const pendingPointerRef = useRef<{ page: Point; screen: Point; altKey: boolean; shiftKey: boolean } | null>(null);
  const previewFrameRef = useRef<number | null>(null);
  const [previewActive, setPreviewActive] = useState(false);
  // Fit only after measuring the real viewport; a guessed first size permanently offsets the saved view.
  const [size, setSize] = useState({ width: 0, height: 0 });
  const images = useStore(runtimeStore, (s) => s.images) as ImageResources;
  const fontGeneration = useStore(runtimeStore, (s) => s.fontGeneration);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setSize({ width: node.clientWidth, height: node.clientHeight }));
    observer.observe(node);
    setSize({ width: node.clientWidth, height: node.clientHeight });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (page && !viewportByPage[pageId] && size.width > 100 && size.height > 100) setViewport(pageId, fit(page, size));
  }, [page, pageId, viewportByPage, size]);
  const vp = getViewport(pageId) ?? (page ? fit(page, size) : { zoom: 1, pan: { x: 0, y: 0 } });
  useEffect(() => {
    disposeGestureRuns(creationCache.current?.runs ?? null); creationCache.current = null;
    disposeGestureRuns(runCacheRef.current); runCacheRef.current = null;
    disposeGestureRuns(textRuns.current); textRuns.current = null;
    disposeGestureRuns(keyboardRuns.current); keyboardRuns.current = null;
    disposeGestureRuns(styleRuns.current); styleRuns.current = null;
    disposeGestureRuns(appearanceRuns.current);appearanceRuns.current=null;
    disposeGestureRuns(backgroundRuns.current); backgroundRuns.current = null;
    disposeGestureRuns(breakoutRuns.current); breakoutRuns.current = null;
    disposeGestureRuns(maskRuns.current); maskRuns.current = null;
    disposeGestureRuns(cropRuns.current); cropRuns.current = null;
    disposeGestureRuns(mangaRuns.current);mangaRuns.current=null;
    disposeGestureRuns(brushRuns.current); brushRuns.current = null;
    const gesture = gestureRef.current;
    if (gesture) runCacheRef.current = beginGestureRuns(gesture.project, pageId, gesture.ids, vp, size, images);
    gestureLayer.current?.batchDraw(); creationLayer.current?.batchDraw();
  }, [fontGeneration]);

  useEffect(() => {
    let frame: number | null = null;
    const unsubscribe = textEditStore.subscribe(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; gestureLayer.current?.batchDraw(); });
    });
    return () => { unsubscribe(); if (frame !== null) cancelAnimationFrame(frame); disposeGestureRuns(textRuns.current); textRuns.current = null; };
  }, []);
  useEffect(() => { disposeGestureRuns(textRuns.current); textRuns.current = null; }, [textEditingId]);
  useEffect(()=>{const off=mangaEditStore.subscribe(()=>{gestureLayer.current?.draw();overlayLayer.current?.draw();});return()=>{off();disposeGestureRuns(mangaRuns.current);mangaRuns.current=null;};},[]);
  useEffect(()=>{if(!mangaEditing){disposeGestureRuns(mangaRuns.current);mangaRuns.current=null;}},[mangaEditing]);
  useEffect(() => {
    const off = speedBrushStore.subscribe((state, old) => {
      if (state.active === old.active) return;
      // Sampling/geometry is already limited to one rAF by SpeedBrushSurface.
      // Konva batches this layer itself; a second scheduler adds a full frame.
      gestureLayer.current?.batchDraw();
    });
    return () => { off(); disposeGestureRuns(brushRuns.current); brushRuns.current = null; };
  }, []);
  useEffect(() => { if (!brushEditing) { disposeGestureRuns(brushRuns.current); brushRuns.current = null; } }, [brushEditing]);
  useEffect(() => {
    let frame: number | null = null;
    const unsubscribe = keyboardMoveStore.subscribe(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; gestureLayer.current?.batchDraw(); overlayLayer.current?.batchDraw(); });
    });
    return () => { unsubscribe(); if (frame !== null) cancelAnimationFrame(frame); disposeGestureRuns(keyboardRuns.current); keyboardRuns.current = null; };
  }, []);
  useEffect(() => { disposeGestureRuns(keyboardRuns.current); keyboardRuns.current = null; }, [keyboardMoving]);
  useEffect(() => {
    let frame: number | null = null;
    const unsubscribe = panelStyleStore.subscribe(() => { if (frame === null) frame = requestAnimationFrame(() => { frame = null; gestureLayer.current?.batchDraw(); overlayLayer.current?.batchDraw(); }); });
    return () => { unsubscribe(); if (frame !== null) cancelAnimationFrame(frame); disposeGestureRuns(styleRuns.current); styleRuns.current = null; };
  }, []);
  useEffect(() => {
    let frame: number | null = null;
    const off = backgroundEditStore.subscribe(() => { if (frame === null) frame = requestAnimationFrame(() => { frame = null; gestureLayer.current?.batchDraw(); }); });
    return () => { off(); if (frame !== null) cancelAnimationFrame(frame); disposeGestureRuns(backgroundRuns.current); backgroundRuns.current = null; };
  }, []);
  useEffect(() => { disposeGestureRuns(backgroundRuns.current); backgroundRuns.current = null; }, [backgroundEditing]);
  useEffect(() => { disposeGestureRuns(styleRuns.current); styleRuns.current = null; }, [styleEditing]);
  useEffect(() => {
    let frame: number | null = null;
    const unsubscribe = cropEditStore.subscribe(() => { if (frame === null) frame = requestAnimationFrame(() => { frame = null; gestureLayer.current?.batchDraw(); }); });
    return () => { unsubscribe(); if (frame !== null) cancelAnimationFrame(frame); disposeGestureRuns(cropRuns.current); cropRuns.current = null; };
  }, []);
  useEffect(() => { disposeGestureRuns(cropRuns.current); cropRuns.current = null; }, [cropEditing]);
  useEffect(() => {
    let frame: number | null = null;
    const unsubscribe = maskEditStore.subscribe(() => { if (frame === null) frame = requestAnimationFrame(() => { frame = null; gestureLayer.current?.batchDraw(); }); });
    return () => { unsubscribe(); if (frame !== null) cancelAnimationFrame(frame); disposeGestureRuns(maskRuns.current); maskRuns.current = null; };
  }, []);
  useEffect(() => { disposeGestureRuns(maskRuns.current); maskRuns.current = null; }, [maskEditing]);
  useEffect(() => {
    let frame: number | null = null;
    const off = breakoutEditStore.subscribe(() => { if (frame === null) frame = requestAnimationFrame(() => { frame = null; gestureLayer.current?.batchDraw(); }); });
    return () => { off(); if (frame !== null) cancelAnimationFrame(frame); disposeGestureRuns(breakoutRuns.current); breakoutRuns.current = null; };
  }, []);
  useEffect(() => { disposeGestureRuns(breakoutRuns.current); breakoutRuns.current = null; }, [breakoutEditing]);
  useEffect(() => {
    let frame: number | null = null;
    const unsubscribe = cutPreviewStore.subscribe(() => { if (frame === null) frame = requestAnimationFrame(() => { frame = null; overlayLayer.current?.batchDraw(); }); });
    return () => { unsubscribe(); if (frame !== null) cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    let frame: number | null = null;
    const off = drawingStore.subscribe(() => { if (frame === null) frame = requestAnimationFrame(() => { frame = null; gestureLayer.current?.batchDraw(); }); });
    return () => { off(); if (frame !== null) cancelAnimationFrame(frame); disposeGestureRuns(contourRuns.current); contourRuns.current = null; };
  }, []);
  useEffect(() => { if (!contourEditing) { disposeGestureRuns(contourRuns.current); contourRuns.current = null; paintedContour.current = null; } }, [contourEditing]);
  useEffect(() => { let frame: number | null = null; const off = sessionStore.subscribe((s, old) => {
    if (s.showPanelNumbers !== old.showPanelNumbers && frame === null) frame = requestAnimationFrame(() => { frame = null; overlayLayer.current?.batchDraw(); });
  }); return () => { off(); if (frame !== null) cancelAnimationFrame(frame); }; }, []);

  useEffect(() => { let frame: number | null = null; const off = associationStore.subscribe(() => { if (frame === null) frame = requestAnimationFrame(() => { frame = null; overlayLayer.current?.batchDraw(); }); }); return () => { off(); if (frame !== null) cancelAnimationFrame(frame); }; }, []);
  useEffect(() => subscribeCreation(() => {
    if (creationFrame.current !== null) return;
    creationFrame.current = requestAnimationFrame(() => {
      creationFrame.current = null;
      if (!currentCreation()) { disposeGestureRuns(creationCache.current?.runs ?? null); creationCache.current = null; }
      creationLayer.current?.batchDraw();
    });
  }), []);
  useEffect(() => () => { disposeGestureRuns(creationCache.current?.runs ?? null); if (creationFrame.current !== null) cancelAnimationFrame(creationFrame.current); }, []);
  useEffect(() => registerCreationDrop((drag, client) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || !page || drag.pageId !== pageId || client.x < rect.left || client.y < rect.top || client.x > rect.right || client.y > rect.bottom) return { ok: true, value: null };
    const p = clientToPage(client, rect, vp);
    if (p.x < 0 || p.y < 0 || p.x > page.width || p.y > page.height) return { ok: true, value: null };
    if(drag.draft.layer.type==='bubbleTail'&&!drag.altKey){const source=documentStore.getState().project,hit=hitLayer(source,pageId,p,null,[],true,vp.zoom),body=hit?source.layers[hit]:null;if(body?.type==='bubble')return createAttachedTail(body.id,drag.draft.layer.appearance,p);}
    const target = resolveComponentPlacement(documentStore.getState().project, drag.draft, pageId, p, sessionStore.getState().scopeId);
    return target.ok ? placeObjectDraft(drag.draft, pageId, target.value.origin, target.value.parentId) : target;
  }), [page, pageId, vp]);

  const syncPaper = (view: Viewport = vp) => { if (paperDisplay.current && page) Object.assign(paperDisplay.current.style, { left: `${view.pan.x}px`, top: `${view.pan.y}px`, width: `${page.width * view.zoom}px`, height: `${page.height * view.zoom}px` }); };
  const draw = (ctx: Konva.Context, source: Project) => {
    syncPaper();
    const raw = ctx._context;
    raw.save();
    raw.translate(vp.pan.x, vp.pan.y);
    raw.scale(vp.zoom, vp.zoom);
    try{drawPage(raw, source, pageId, images);renderFailure.current=null;}catch(error){const message=(error as Error).message;if(renderFailure.current!==message){renderFailure.current=message;queueMicrotask(()=>pushNotice('error',message));}}finally{raw.restore();}
  };

  const drawGesture = (ctx: Konva.Context) => {
    syncPaper((panRef.current ?? wheelRef.current ?? pinchRef.current)?.viewport ?? vp);
    const contour = currentDrawing();
    if (contour?.kind === 'edit' && contour.targetId && contour.pageId === pageId) {
      const cache = contourRuns.current;
      if (!cache || cache.base !== contour.base || cache.viewport !== vp || cache.width !== size.width || cache.height !== size.height) { disposeGestureRuns(cache); contourRuns.current = beginGestureRuns(contour.base, pageId, [contour.targetId], vp, size, images); }
      const runs = contourRuns.current!, previous = paintedContour.current, raw = ctx._context;
      const fontGeneration = runtimeStore.getState().fontGeneration;
      const damage = previous?.cache === runs && previous.id === contour.targetId && previous.images === images && previous.fontGeneration === fontGeneration
        ? contourDamage(previous.project, contour.preview, contour.targetId, vp, size, gestureLayer.current?.getCanvas().getPixelRatio() ?? 1) : undefined;
      raw.save();
      if (damage === undefined) raw.clearRect(0, 0, size.width, size.height);
      else if (damage) { raw.beginPath(); raw.rect(damage.x, damage.y, damage.width, damage.height); raw.clip(); raw.clearRect(damage.x, damage.y, damage.width, damage.height); }
      if (damage !== null) { drawGestureRuns(raw, runs, contour.preview, images); addGestureDraws(1); }
      raw.restore();
      paintedContour.current = { cache: runs, project: contour.preview, id: contour.targetId, images, fontGeneration }; return;
    }
    // Retain pixels only during contour correction. All other preview modes
    // keep the original complete-clear behavior on this same independent layer.
    paintedContour.current = null; ctx._context.clearRect(0, 0, size.width, size.height);
    const appearance=currentAppearanceEdit();if(appearance?.pageId===pageId){const cache=appearanceRuns.current;if(!cache||cache.base!==appearance.base||cache.viewport!==vp||cache.width!==size.width||cache.height!==size.height){disposeGestureRuns(cache);appearanceRuns.current=beginGestureRuns(appearance.base,pageId,appearance.ids,vp,size,images);}const started=performance.now();drawGestureRuns(ctx._context,appearanceRuns.current!,appearance.preview,images);addGestureDraws(1);recordDrawingFrame(started);return;}
    const bubbleBrush=currentBubbleBrush();if(bubbleBrush?.valid){const started=performance.now(),cache=bubbleBrushRuns.current;if(!cache||cache.base!==bubbleBrush.sceneBase||cache.viewport!==vp){disposeGestureRuns(cache);bubbleBrushRuns.current=beginGestureRuns(bubbleBrush.sceneBase,pageId,[bubbleBrush.layerId],vp,size,images);}drawGestureRuns(ctx._context,bubbleBrushRuns.current!,bubbleBrush.preview,images);addGestureDraws(1);recordDrawingFrame(started);return;}
    const brush = currentSpeedStroke();
    if (brush?.pageId === pageId) {
      const cache = brushRuns.current;
      if (!cache || cache.base !== brush.sceneBase || cache.viewport !== vp || cache.width !== size.width || cache.height !== size.height) {
        disposeGestureRuns(cache); brushRuns.current = beginGestureRuns(brush.sceneBase, pageId, [brush.layer.id], vp, size, images);
      }
      drawGestureRuns(ctx._context, brushRuns.current!, brush.preview, images); addGestureDraws(1); return;
    }
    const manga=currentMangaEdit();
    if(manga?.pageId===pageId){const cache=mangaRuns.current;if(!cache||cache.base!==manga.base||cache.viewport!==vp||cache.width!==size.width||cache.height!==size.height){disposeGestureRuns(cache);mangaRuns.current=beginGestureRuns(manga.base,pageId,[manga.id],vp,size,images);}drawGestureRuns(ctx._context,mangaRuns.current!,manga.preview,images);addGestureDraws(1);return;}
    const breakout = currentBreakoutEdit();
    if (breakout && breakout.preview.layers[breakout.imageId].pageId === pageId) {
      const cache = breakoutRuns.current;
      if (!cache || cache.base !== breakout.base || cache.viewport !== vp || cache.width !== size.width || cache.height !== size.height) { disposeGestureRuns(cache); breakoutRuns.current = beginGestureRuns(breakout.base, pageId, [breakout.imageId], vp, size, images); }
      drawGestureRuns(ctx._context, breakoutRuns.current!, breakout.preview, images); addGestureDraws(1); return;
    }
    const background = currentBackgroundEdit();
    if (background?.pageId === pageId) {
      const cache = backgroundRuns.current;
      if (!cache || cache.base !== background.base || cache.viewport !== vp || cache.width !== size.width || cache.height !== size.height) { disposeGestureRuns(cache); backgroundRuns.current = beginGestureRuns(background.base, pageId, [background.id], vp, size, images); }
      drawGestureRuns(ctx._context, backgroundRuns.current!, background.preview, images); addGestureDraws(1); return;
    }
    const style = currentPanelStyle();
    if (style && style.pageId === pageId) {
      const cache = styleRuns.current;
      if (!cache || cache.base !== style.base || cache.viewport !== vp || cache.width !== size.width || cache.height !== size.height) {
        disposeGestureRuns(cache); styleRuns.current = beginGestureRuns(style.base, pageId, style.ids, vp, size, images);
      }
      drawGestureRuns(ctx._context, styleRuns.current!, style.preview, images); addGestureDraws(1); return;
    }
    const view = panRef.current ?? wheelRef.current ?? pinchRef.current;
    if (view) {
      drawViewportBitmap(ctx._context, view.bitmap, view.viewport); addGestureDraws(1); return;
    }
    const trimming=currentImageTrim();if(trimming){draw(ctx,trimming.display);return;}
    const masking = currentMaskEdit();
    if (masking && masking.pageId === pageId) {
      const cache = maskRuns.current;
      if (!cache || cache.base !== masking.base || cache.viewport !== vp || cache.width !== size.width || cache.height !== size.height) {
        disposeGestureRuns(cache); maskRuns.current = beginGestureRuns(masking.base, pageId, [masking.imageId], vp, size, images);
      }
      drawGestureRuns(ctx._context, maskRuns.current!, masking.preview, images, undefined, masking.imageId); addGestureDraws(1); return;
    }
    const crop = currentCropEdit();
    if (crop && crop.pageId === pageId) {
      const cache = cropRuns.current;
      if (!cache || cache.base !== crop.base || cache.viewport !== vp || cache.width !== size.width || cache.height !== size.height) {
        disposeGestureRuns(cache); cropRuns.current = beginGestureRuns(crop.base, pageId, [crop.panelId], vp, size, images);
      }
      drawGestureRuns(ctx._context, cropRuns.current!, crop.preview, images, undefined, crop.imageId); addGestureDraws(1); return;
    }
    const node=currentNodeEdit();
    if(node&&node.target.pageId===pageId){const cache=nodeRuns.current;if(!cache||cache.base!==node.base||cache.viewport!==vp||cache.width!==size.width||cache.height!==size.height){disposeGestureRuns(cache);nodeRuns.current=beginGestureRuns(node.base,pageId,[node.target.panelId],vp,size,images);}drawGestureRuns(ctx._context,nodeRuns.current!,node.preview,images);addGestureDraws(1);return;}
    const move = currentKeyboardMove();
    if (move && move.pageId === pageId) {
      const cache = keyboardRuns.current;
      if (!cache || cache.base !== move.base || cache.viewport !== vp || cache.width !== size.width || cache.height !== size.height) {
        disposeGestureRuns(cache); keyboardRuns.current = beginGestureRuns(move.base, pageId, move.ids, vp, size, images);
      }
      drawGestureRuns(ctx._context, keyboardRuns.current!, move.preview, images); addGestureDraws(1); return;
    }
    const edit = currentTextEdit();
    if (edit && edit.base.layers[edit.layerId].pageId === pageId) {
      const cache = textRuns.current;
      if (!cache || cache.base !== edit.base || cache.viewport !== vp || cache.width !== size.width || cache.height !== size.height) {
        disposeGestureRuns(cache); textRuns.current = beginGestureRuns(edit.base, pageId, [edit.layerId], vp, size, images);
      }
      drawGestureRuns(ctx._context, textRuns.current!, edit.preview, images); addGestureDraws(1); return;
    }
    const source = previewRef.current ?? project;
    const cache = runCacheRef.current;
    if (cache && cache.pageId === pageId && cache.width === size.width && cache.height === size.height) drawGestureRuns(ctx._context, cache, source, images);
    else draw(ctx, source);
  };

  const drawCreation = (ctx: Konva.Context) => {
    const drag = currentCreation();
    const rect = rootRef.current?.getBoundingClientRect();
    if (!drag || !rect || !page || drag.pageId !== pageId || drag.client.x < rect.left || drag.client.y < rect.top || drag.client.x > rect.right || drag.client.y > rect.bottom) return;
    const p = clientToPage(drag.client, rect, vp);
    if (p.x < 0 || p.y < 0 || p.x > page.width || p.y > page.height) return;
    addGestureDraws(1);
    const target = resolveComponentPlacement(project, drag.draft, pageId, p, sessionStore.getState().scopeId);
    if (!target.ok) return;
    const parentId = target.value.parentId;
    const layer = { ...drag.draft.layer, parentId, matrix: translation(target.value.origin.x, target.value.origin.y) } as ComicLayer;
    const scene = componentSceneDraft(layer, drag.draft.descendants, drag.draft.independentRoots); if (!scene.ok) return;
    const ghost: Project = { ...project, layers: { ...project.layers }, pages: { ...project.pages } };
    for (const child of scene.value.layers) ghost.layers[child.id] = child;
    if (parentId) {
      const parent = ghost.layers[parentId];
      if (parent.type === 'group') ghost.layers[parentId] = { ...parent, children: [...parent.children, ...scene.value.roots] };
    } else ghost.pages[pageId] = { ...page, roots: [...page.roots, ...scene.value.roots] };
    const cached = creationCache.current;
    if (!cached || cached.project !== project || cached.scopeId !== parentId || cached.id !== layer.id || cached.runs.viewport !== vp || cached.runs.width !== size.width || cached.runs.height !== size.height) {
      disposeGestureRuns(cached?.runs ?? null);
      creationCache.current = { project, scopeId: parentId, id: layer.id, runs: beginGestureRuns(ghost, pageId, scene.value.roots, vp, size, images) };
    }
    drawGestureRuns(ctx._context, creationCache.current!.runs, ghost, images, new Map(scene.value.roots.map(id => [id, 0.55])));
  };

  const endGesture = (commit: boolean, ctrlBind = false) => {
    if (commit) flushPreview();
    if (previewFrameRef.current !== null) cancelAnimationFrame(previewFrameRef.current);
    previewFrameRef.current = null;
    pendingPointerRef.current = null;
    const g = gestureRef.current;
    const preview = previewRef.current;
    if (commit && g && g.kind !== 'crop' && documentStore.getState().project !== g.project) { commit = false; pushNotice('error', '作品已变化，拖动取消'); }
    clearAssociation(); gestureRef.current = null;
    runtimeStore.setState({ gestureActive: false, previewProject: null });
    if (g?.kind === 'crop') {
      if (!commit && currentCropEdit() && g.layer.type === 'image' && g.layer.crop) previewCropParams(g.layer.crop);
      previewRef.current = null;
      setPreviewActive(false);
      disposeGestureRuns(runCacheRef.current); runCacheRef.current = null;
      return;
    }
    disposeGestureRuns(runCacheRef.current);
    runCacheRef.current = null;
    previewRef.current = null;
    if (commit && g && preview && (g.shared || g.kind === 'move' && g.ids.length > 1)) {
      const result = execute({ label: g.kind === 'rotate' ? '旋转多个图层' : g.kind === 'resize' ? '缩放多个图层' : '移动多个图层', context: { pageId, selection: g.ids }, afterSelection: g.ids, mutate(draft) {
        for (const [id, layer] of Object.entries(preview.layers)) if (layer !== g.project.layers[id]) draft.layers[id] = layer;
        draft.schemaVersion = preview.schemaVersion; draft.libraryAssetIds = preview.libraryAssetIds;
      } });
      if (!result.ok) pushNotice('error', result.problems[0].message);
    } else if (commit && g && preview && (!(g.kind === 'tailTip' || g.kind === 'tailBase') || JSON.stringify(preview.layers[g.id]) !== JSON.stringify(g.layer))) {
      const candidate = ctrlBind && g.kind === 'move' && g.layer.type === 'image' && !g.layer.crop ? rankPanelOverlaps(preview, g.id)[0]?.panelId : null;
      const result = changeLayer(g.id, `调整${g.layer.name}`, (_target, draft) => {
        const copy = (id: Id) => {
          draft.layers[id] = preview.layers[id];
          const layer = g.project.layers[id];
          if (layer && 'children' in layer) for (const child of layer.children) copy(child);
        };
        copy(g.id);
        if (candidate) { const r = bindImagesDraft(draft, [g.id], candidate); if (!r.ok) throw Error(r.problems[0].message); }
      });
      if (!result.ok) pushNotice('error', result.problems[0].message);
      else if (!candidate && g.kind === 'move' && g.layer.type === 'image' && !g.layer.crop) suggestAssociation(documentStore.getState().project, g.id, 'recommend');
      if (candidate) sessionStore.setState({ scopeId: null });
    }
    setPreviewActive(false);
  };

  const finishCrop = (commit: boolean) => {
    if (commit) flushPreview();
    if (previewFrameRef.current !== null) cancelAnimationFrame(previewFrameRef.current);
    previewFrameRef.current = null;
    pendingPointerRef.current = null;
    gestureRef.current = null;
    previewRef.current = null;
    runtimeStore.setState({ gestureActive: false, previewProject: null });
    disposeGestureRuns(runCacheRef.current);
    runCacheRef.current = null;
    setPreviewActive(false);
    if (commit) { const result = commitCropEdit(); if (!result.ok) pushNotice('error', result.problems[0].message); }
    else cancelCropEdit();
  };

  const updatePan = () => {
    const pan = panRef.current;
    if (!pan?.pending) return;
    pan.viewport = { ...pan.initial, pan: { x: pan.initial.pan.x + pan.pending.x - pan.start.x, y: pan.initial.pan.y + pan.pending.y - pan.start.y } };
    pan.pending = null; syncPaper(pan.viewport);
    gestureLayer.current?.batchDraw(); overlayLayer.current?.batchDraw();
  };
  const finishPan = (commit: boolean) => {
    if (commit) updatePan();
    if (panFrame.current !== null) cancelAnimationFrame(panFrame.current); panFrame.current = null;
    const pan = panRef.current; panRef.current = null; if (pan && !commit) syncPaper();
    if (!pan) return;
    releaseViewportBitmap(pan.bitmap);
    if (commit) setViewport(pageId, pan.viewport);
    if (commit) { disposeGestureRuns(runCacheRef.current); runCacheRef.current = null; }
    previewRef.current = null;
    runtimeStore.setState({ gestureActive: false }); setPreviewActive(false);
  };
  const scheduleViewDraw = () => {
    if (viewFrame.current !== null) return;
    viewFrame.current = requestAnimationFrame(() => { viewFrame.current = null;
      const view = panRef.current ?? wheelRef.current ?? pinchRef.current;
      if (paperDisplay.current && view && page) Object.assign(paperDisplay.current.style, { left: `${view.viewport.pan.x}px`, top: `${view.viewport.pan.y}px`, width: `${page.width * view.viewport.zoom}px`, height: `${page.height * view.viewport.zoom}px` }); gestureLayer.current?.batchDraw(); overlayLayer.current?.batchDraw(); });
  };
  const finishWheel = (commit: boolean) => {
    if (wheelTimer.current !== null) clearTimeout(wheelTimer.current); wheelTimer.current = null;
    const wheel = wheelRef.current; wheelRef.current = null; if (wheel && !commit) syncPaper();
    if (!wheel) return;
    releaseViewportBitmap(wheel.bitmap); if (commit) setViewport(pageId, wheel.viewport);
    runtimeStore.setState({ gestureActive: false }); setPreviewActive(false);
  };
  const finishPinch = (commit: boolean) => {
    const pinch = pinchRef.current; pinchRef.current = null; if (pinch && !commit) syncPaper();
    if (!pinch) return;
    releaseViewportBitmap(pinch.bitmap); if (commit) setViewport(pageId, pinch.viewport);
    runtimeStore.setState({ gestureActive: false }); setPreviewActive(false);
  };
  const bitmap = (initial: Viewport = vp) => captureViewport(currentCropEdit()?.preview ?? documentStore.getState().project, pageId, initial, { x: size.width, y: size.height }, images);
  useEffect(()=>{
    const g=areaRef.current;if(!g)return;const before=areaBoundsRef.current,now=rootRef.current?.getBoundingClientRect();
    const changed=areaDisabled||g.project!==project||g.pageId!==pageId||g.scopeId!==sessionStore.getState().scopeId||g.shape.kind!==mode||g.viewport.zoom!==vp.zoom||g.viewport.pan.x!==vp.pan.x||g.viewport.pan.y!==vp.pan.y||before&&now&&(['x','y','width','height']as const).some(key=>Math.abs(before[key]-now[key])>.01);
    if(changed)finishArea(false);
  },[areaDisabled,project,pageId,mode,sessionStore.getState().scopeId,vp.zoom,vp.pan.x,vp.pan.y,size.width,size.height]);
  useEffect(()=>{const p=cutToolPointer.current;if(!p)return;const before=cutToolBounds.current,now=rootRef.current?.getBoundingClientRect();const changed=areaDisabled||p.base!==project||p.pageId!==pageId||mode!=='panel-cut'||p.viewport.zoom!==vp.zoom||p.viewport.pan.x!==vp.pan.x||p.viewport.pan.y!==vp.pan.y||before&&now&&(['x','y','width','height']as const).some(key=>Math.abs(before[key]-now[key])>.01);if(changed)cancelCutTool();},[areaDisabled,project,pageId,mode,vp.zoom,vp.pan.x,vp.pan.y,size.width,size.height]);
  const assistViewport=useRef(vp);
  useEffect(()=>{const old=assistViewport.current;if(gestureRef.current?.assist&&(old.zoom!==vp.zoom||old.pan.x!==vp.pan.x||old.pan.y!==vp.pan.y))endGesture(false);assistViewport.current=vp;},[vp.zoom,vp.pan.x,vp.pan.y]);
  useEffect(() => registerGestureCanceller(() => { doubleTap.current.cancel(); cancelCutTool(); finishArea(false); finishPan(false); finishWheel(false); finishPinch(false); if (mode === 'crop') finishCrop(false); else endGesture(false); }));
  useEffect(() => () => {
    // Unmount is cancellation, never a delayed commit. StrictMode also runs
    // this cleanup during effect replay, when there is no owned gesture.
    const owned = cutToolPointer.current !== null || areaRef.current !== null || gestureRef.current !== null || panRef.current !== null || wheelRef.current !== null || pinchRef.current !== null;
    if (previewFrameRef.current !== null) cancelAnimationFrame(previewFrameRef.current);
    previewFrameRef.current = null; pendingPointerRef.current = null;
    disposeGestureRuns(runCacheRef.current); runCacheRef.current = null;
    cancelCutTool(); areaRef.current = null; gestureRef.current = null; previewRef.current = null;
    if (panFrame.current !== null) cancelAnimationFrame(panFrame.current); if (viewFrame.current !== null) cancelAnimationFrame(viewFrame.current); if (wheelTimer.current !== null) clearTimeout(wheelTimer.current);
    panFrame.current = null; viewFrame.current = null; wheelTimer.current = null;
    releaseViewportBitmap(panRef.current?.bitmap ?? null); releaseViewportBitmap(wheelRef.current?.bitmap ?? null); releaseViewportBitmap(pinchRef.current?.bitmap ?? null);
    panRef.current = null; wheelRef.current = null; pinchRef.current = null;
    touchPoints.current.clear(); doubleTap.current.cancel();
    if (owned) runtimeStore.setState({ gestureActive: false, previewProject: null });
  }, []);
  useEffect(() => {
    if (mode !== 'crop') return;
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); finishCrop(false); }
      else if (event.key === 'Enter' && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); finishCrop(true); }
    };
    window.addEventListener('keydown', key, true);
    const outside = (event: PointerEvent) => {
      if (event.button !== 0 || rootRef.current?.contains(event.target as Node) || !currentCropEdit()) return;
      finishCrop(true);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => { window.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', outside, true); };
  });

  const pointerPoint = (e: React.PointerEvent<HTMLDivElement>, viewport: Viewport = vp): { screen: Point; page: Point } => {
    const rect = e.currentTarget.getBoundingClientRect();
    const client = { x: e.clientX, y: e.clientY };
    return { screen: { x: e.clientX - rect.left, y: e.clientY - rect.top }, page: clientToPage(client, rect, viewport) };
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!page || e.button !== 0 || (isAreaTool(mode)||mode==='panel-cut'||(mode==='image-crop'||mode==='image-mask'))&&areaDisabled) return;
    if((e.target as Element).closest('.manga-geometry-overlay'))return;
    if(currentMangaEdit())cancelMangaEdit();
    if (currentImageTrim() || currentBreakoutEdit() || currentMaskEdit() || (e.target as HTMLElement).closest('.canvas-text-editor, .crop-actions, .mask-editor-controls, .mask-editor-surface')) return;
    const owner = cutToolPointer.current?.pointerId ?? areaRef.current?.pointerId ?? gestureRef.current?.pointerId ?? panRef.current?.pointerId;
    // A second touch may take over a first touch as the defined pinch gesture;
    // a mouse/pen, or a touch arriving during a mouse drag, cannot replace it.
    const secondTouch = e.pointerType === 'touch' && owner !== undefined && e.pointerId !== owner && touchPoints.current.has(owner);
    if ((pinchRef.current && e.pointerType !== 'touch') || (owner !== undefined && !secondTouch)) { e.preventDefault(); return; }
    lastPointerType.current = e.pointerType;
    const vp = wheelRef.current?.viewport ?? getViewport(pageId) ?? fit(page, size), project = documentStore.getState().project;
    if (wheelRef.current) finishWheel(true);
    const { screen, page: p } = pointerPoint(e, vp);
    if (e.pointerType === 'touch') {
      touchPoints.current.set(e.pointerId, screen);
      if (touchPoints.current.size >= 2) {
        doubleTap.current.cancel();
        const result = commitTextEdit(); if (!result.ok) { touchPoints.current.delete(e.pointerId); pushNotice('error', result.problems[0].message); return; }
        if (pinchRef.current) { e.currentTarget.setPointerCapture(e.pointerId); return; }
        cancelCutTool(); finishArea(false); finishPan(false); finishWheel(false); endGesture(false);
        const entries = [...touchPoints.current.entries()].slice(0, 2), a = entries[0][1], b = entries[1][1];
        pinchRef.current = { ids: entries.map(([id]) => id), initial: vp, viewport: vp, midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(a.x - b.x, a.y - b.y), bitmap: bitmap(vp) };
        e.currentTarget.setPointerCapture(e.pointerId); runtimeStore.setState({ gestureActive: true }); setPreviewActive(true); return;
      }
      if (!isAreaTool(mode) && !spacePan && !currentTextEdit() && !currentCropEdit()) doubleTap.current.down(e.pointerId, screen, e.timeStamp, `${pageId}:${sessionStore.getState().scopeId ?? ''}`);
    }
    if (currentKeyboardMove()) cancelKeyboardMove();
    if (spacePan) {
      const result = commitTextEdit(); if (!result.ok) { pushNotice('error', result.problems[0].message); return; }
      endGesture(false);
      previewRef.current = null;
      panRef.current = { pointerId: e.pointerId, start: screen, initial: vp, viewport: vp, bitmap: bitmap(vp), pending: null };
      e.currentTarget.focus({ preventScroll: true });
      e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); runtimeStore.setState({ gestureActive: true }); setPreviewActive(true); return;
    }
    if(mode==='panel-cut'||(mode==='image-crop'||mode==='image-mask')){
      if(document.querySelector('[role=dialog][aria-modal=true]'))return;
      const text=commitTextEdit();if(!text.ok){pushNotice('error',text.problems[0].message);return;}
      const doc=documentStore.getState(),s=sessionStore.getState();
      if((mode==='image-crop'||mode==='image-mask')){const id=hitVisibleImage(doc.project,pageId,p,s.scopeId);if(!id){pushNotice('info','此处没有可编辑的素材图片');return;}const r=mode==='image-mask'?beginImageMaskTarget(id):beginImageCropTarget(id);if(!r.ok)pushNotice('error',r.problems[0].message);return;}
      const id=hitLayer(doc.project,pageId,p,s.scopeId,[],false,vp.zoom),layer=id?doc.project.layers[id]:null;
      if(layer?.type!=='panel'){pushNotice('info','请从可编辑的分镜上开始拖动切割线');return;}
      const r=beginPanelCutPointer(layer.id,e.pointerId,p,vp);if(!r.ok){pushNotice('error',r.problems[0].message);return;}
      cutToolPointer.current=r.value;cutToolBounds.current=e.currentTarget.getBoundingClientRect();doubleTap.current.cancel();e.preventDefault();e.currentTarget.focus({preventScroll:true});e.currentTarget.setPointerCapture(e.pointerId);return;
    }
    if(isAreaTool(mode)){
      if(document.querySelector('[role=dialog][aria-modal=true]'))return;
      const text=commitTextEdit();if(!text.ok){pushNotice('error',text.problems[0].message);return;}
      const doc=documentStore.getState(),s=sessionStore.getState();
      const r=beginAreaSelection(doc.project,doc.epoch,pageId,s.scopeId,vp,s.areaSelectionOptions,s.selection,s.selectionAnchorId,mode,e.pointerId,screen,e.shiftKey,e.altKey);
      if(!r.ok){pushNotice('error',r.problems[0].message);return;}
      areaRef.current=r.value;areaBoundsRef.current=e.currentTarget.getBoundingClientRect();doubleTap.current.cancel();hideElementHint();e.currentTarget.focus({preventScroll:true});e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);runtimeStore.setState({gestureActive:true});overlayLayer.current?.batchDraw();return;
    }
    const edit = currentTextEdit();
    if (edit) {
      const layer = edit.preview.layers[edit.layerId];
      const inv = inverse(worldMatrix(edit.preview, edit.layerId));
      const local = inv.ok ? apply(inv.value, p) : null;
      if (layer.type === 'text' && local && local.x >= layer.box.x && local.x <= layer.box.x + layer.box.width && local.y >= layer.box.y && local.y <= layer.box.y + layer.box.height) {
        e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); textPointer({ phase: 'down', point: local, pointerId: e.pointerId, shift: e.shiftKey }); return;
      }
      const result = commitTextEdit(); if (!result.ok) { pushNotice('error', result.problems[0].message); return; }
      const fresh = documentStore.getState().project, hit = hitLayer(fresh, pageId, p, sessionStore.getState().scopeId);
      setSelection(hit ? [hit] : [], hit); return;
    }
    e.currentTarget.focus({ preventScroll: true });
    if (mode === 'crop' && cropTarget) {
      const activeProject = currentCropEdit()?.preview ?? project;
      const panel = activeProject.layers[cropTarget.panelId];
      const image = activeProject.layers[cropTarget.imageId];
      if (panel?.type !== 'panel' || image?.type !== 'image') return;
      if (!pointInsidePanelClips(activeProject, panel.id, p)) {
        finishCrop(true); const hit = hitLayer(documentStore.getState().project, pageId, p, sessionStore.getState().scopeId); setSelection(hit ? [hit] : [], hit); return;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      gestureRef.current = { id: image.id, ids: [image.id], pointerId: e.pointerId, kind: 'crop', index: 0, start: p, project: activeProject, layer: image, center: screen };
      runtimeStore.setState({ gestureActive: true });
      return;
    }
    const current = selection[0];
    let handle = current ? (selection.length === 1 ? handles(project, current, vp, mode) : sharedHandles(project, selection, vp)).reverse().find((h) => pointNear(h.point, screen, e.pointerType === 'touch' ? 14 : 8)) : undefined;
    const directVertex=(e.ctrlKey||e.metaKey)&&current&&selection.length===1?pickPanelVertex(project,current,screen,vp):null;
    if(directVertex!==null)handle={kind:'vertex',index:directVertex,point:screen};
    if(handle?.kind==='vertex')selectGeometryNode(current,handle.index);
    let materialHit:Id|null=null;
    if(e.altKey&&!(handle?.kind==='vertex'&&project.layers[current]?.type==='panel')&&(!handle||selection.length===1&&project.layers[current]?.type==='panel')){const image=hitVisibleImage(project,pageId,p,sessionStore.getState().scopeId),layer=image?project.layers[image]:null;
      if(image&&selection.length===1&&selection[0]===image&&layer?.type==='image'&&!layer.crop&&!e.shiftKey)materialHit=image;
      else{if(image)setSelection(e.shiftKey?(selection.includes(image)?selection.filter(id=>id!==image):[...selection,image]):[image],image);else pushNotice('info','此处没有可选中的素材');return;}}
    if (handle?.kind === 'edge' && sessionStore.getState().geometryConstraint === 'parallelogram') {
      if (!window.confirm('推动单边将退出平行四边形约束，继续？')) return;
      sessionStore.setState({ geometryConstraint: 'freeConvex' });
    }
    const hit = materialHit ?? (handle ? current : hitLayer(project, pageId, p, sessionStore.getState().scopeId, e.shiftKey || e.ctrlKey || e.metaKey ? [] : selection,e.altKey,vp.zoom));
    if (!hit) { setSelection([]); return; }
    if ((e.shiftKey || e.ctrlKey || e.metaKey) && !handle) { setSelection(selection.includes(hit) ? selection.filter((id) => id !== hit) : [...selection, hit], hit); return; }
    const movingIds = selection.includes(hit) ? movableRoots(project, selection) : [hit];
    if (!selection.includes(hit)) setSelection([hit], hit);
    const layer = project.layers[hit];
    if (!layer || !effectiveLayerFlags(project, hit).visible || effectiveLayerFlags(project, hit).locked) return;
    if(layer.type==='bubbleTail'&&layer.attachment.mode==='bubble'&&movingIds.includes(hit))return;
    if (movingIds.some(id => project.layers[id]?.type === 'pageBackground')) { pushNotice('error', '页面背景不能移动，请先单独选择内容图层'); return; }
    for (const id of movingIds) {
      if (effectiveLayerFlags(project, id).locked) { pushNotice('error', '选区包含有效锁定图层，不能整体变换'); return; }
      const locked = hasLockedDescendant(project, id);
      if (locked) { pushNotice('error', `锁定图层“${locked}”阻止整体变换`); return; }
    }
    if(handle?.kind==='vertex'&&geometryPanel(layer)&&!inverse(worldMatrix(project,hit)).ok){pushNotice('error','节点所在坐标系不可逆，不能编辑');return;}
    e.currentTarget.setPointerCapture(e.pointerId);
    const center = centerOf(screenPolygon(project, hit, vp));
    const geometryLayer=geometryPanel(layer);
    const assist=handle?.kind==='vertex'&&geometryLayer&&(directVertex!==null||sessionStore.getState().geometryConstraint!=='parallelogram')?{
      context:{originPage:apply(worldMatrix(project,hit),geometryLayer.geometry[handle.index]),pointerDownPage:p,zoom:vp.zoom,neighbors:[(handle.index+geometryLayer.geometry.length-1)%geometryLayer.geometry.length,(handle.index+1)%geometryLayer.geometry.length].map(index=>({vertexIndex:index,page:apply(worldMatrix(project,hit),geometryLayer.geometry[index])}))},state:emptyNodeAssist(),guides:[] as NodeGuide[]
    }:undefined;
    gestureRef.current = { id: hit, ids: movingIds, pointerId: e.pointerId, kind: handle?.kind ?? 'move', index: handle?.index ?? 0, start: p, project, layer, center, singleNode:directVertex!==null,assist };
    if (handle && selection.length > 1) {
      const check = transformSelectionDraft(project, movingIds, [1, 0, 0, 1, 0, 0]), box = selectionTransformBounds(project, movingIds);
      if (!check.ok || !box) { if (!check.ok) pushNotice('error', check.problems[0].message); gestureRef.current = null; e.currentTarget.releasePointerCapture(e.pointerId); return; }
      gestureRef.current.shared = box;
    }
    if (!handle) gestureRef.current.snap = collectMoveSnap(project, pageId, movingIds);
    if (handle?.kind === 'rotate') {
      const box = gestureRef.current.shared ?? localLayerBounds(project, hit), parentWorld = gestureRef.current.shared ? [1, 0, 0, 1, 0, 0] as const : layer.parentId ? worldMatrix(project, layer.parentId) : [1, 0, 0, 1, 0, 0] as const;
      const inv = inverse(parentWorld);
      if (!box || !inv.ok) { gestureRef.current = null; return; }
      const anchor=gestureRef.current.shared?{x:.5,y:.5}:propertyAnchor(hit),pivotLocal = { x: box.x + box.width * anchor.x, y: box.y + box.height * anchor.y }, pivotParent = gestureRef.current.shared ? pivotLocal : apply(layer.matrix, pivotLocal), q = apply(inv.value, p);
      gestureRef.current.rotation = { pivotLocal, pivotParent, pointerAngle: Math.atan2(q.y - pivotParent.y, q.x - pivotParent.x), delta: 0, startAngle: gestureRef.current.shared ? 0 : decompose(layer.matrix).thetaRad };
    }
    runtimeStore.setState({ gestureActive: true });
  };

  const computePreview = (p: Point, screen: Point, altKey: boolean, shiftKey: boolean) => {
    const g = gestureRef.current;
    if (!g) return;
    let dx = p.x - g.start.x, dy = p.y - g.start.y;
    if (!previewRef.current && Math.hypot(screen.x - pageToScreen(g.start, vp).x, screen.y - pageToScreen(g.start, vp).y) < 3) return;
    if (g.kind === 'crop' && g.layer.type === 'image' && cropTarget) {
      const panel = g.project.layers[cropTarget.panelId], inv = inverse(worldMatrix(g.project, cropTarget.panelId));
      if (panel?.type !== 'panel' || !inv.ok || !g.layer.crop) return;
      const start = apply(inv.value, g.start), end = apply(inv.value, p);
      previewCropParams(panCrop(panel.geometry, { x: g.layer.width, y: g.layer.height }, g.layer.crop, { x: end.x - start.x, y: end.y - start.y })); return;
    }
    if (g.kind !== 'crop' && !runCacheRef.current) runCacheRef.current = beginGestureRuns(g.project, pageId, g.ids, vp, size, images);
    const shallow=!!g.shared||['move','vertex','edge'].includes(g.kind);
    let preview = shallow ? { ...g.project, layers: { ...g.project.layers } } : structuredClone(g.project) as Project;
    if (shallow) for (const id of g.ids) preview.layers[id] = { ...g.project.layers[id] };
    const target = preview.layers[g.id];
    if (g.shared && (g.kind === 'resize' || g.kind === 'rotate')) {
      let transform;
      if (g.kind === 'resize') {
        const next = resizedRect(g.shared, g.index, p, { proportional: shiftKey, snap16: !altKey && sessionStore.getState().snap16 }); if (!next.ok) return;
        transform = multiply(multiply(translation(next.value.x, next.value.y), scaling(next.value.width / g.shared.width, next.value.height / g.shared.height)), translation(-g.shared.x, -g.shared.y));
      } else {
        const r = g.rotation!; const angle = Math.atan2(p.y - r.pivotParent.y, p.x - r.pivotParent.x); r.delta += unwrapStep(r.pointerAngle, angle); r.pointerAngle = angle;
        transform = multiply(multiply(translation(r.pivotParent.x, r.pivotParent.y), rotationRad(snappedRotation(0, r.delta, altKey))), translation(-r.pivotParent.x, -r.pivotParent.y));
      }
      const result = transformSelectionDraft(g.project, g.ids, transform); if (!result.ok) return; preview = result.value;
    } else if (g.kind === 'move') {
      if (g.snap) {
        if (altKey) { g.snap.locks = {}; g.snap.guides = []; }
        else { const snapped = snapMove(g.snap.bounds, { x: dx, y: dy }, g.snap.candidates, vp.zoom, g.snap.locks); dx = snapped.delta.x; dy = snapped.delta.y; g.snap.locks = snapped.locks; g.snap.guides = snapped.guides; }
      }
      if (g.ids.length > 1) {
        const result = transformSelectionDraft(g.project, g.ids, translation(dx, dy)); if (!result.ok) return; preview = result.value;
      } else for (const id of g.ids) {
        const original = g.project.layers[id];
        const parent = original.parentId ? worldMatrix(g.project, original.parentId) : ([1, 0, 0, 1, 0, 0] as const);
        const inv = inverse(parent);
        if (!inv.ok) return;
        const a = inv.value;
        preview.layers[id].matrix = [...original.matrix.slice(0, 4), original.matrix[4] + a[0] * dx + a[2] * dy, original.matrix[5] + a[1] * dx + a[3] * dy] as unknown as typeof target.matrix;
      }
    } else if ((g.kind === 'tailTip' || g.kind === 'tailBase') && target.type === 'bubble' && g.layer.type === 'bubble' && g.layer.tail) {
      const inv = inverse(worldMatrix(g.project, g.id));
      if (!inv.ok) return;
      const from = previewRef.current?.layers[g.id];
      const prior = from?.type === 'bubble' ? from : g.layer;
      const candidate = g.kind === 'tailTip' ? moveTailTip(prior, apply(inv.value, p)) : moveTailBase(prior, apply(inv.value, p));
      if (!candidate.ok) return;
      target.tail = candidate.value;
    } else if (g.kind === 'vertex' && geometryPanel(target) && geometryPanel(g.layer)) {
      const original=geometryPanel(g.layer)!;
      const inv = inverse(worldMatrix(g.project, g.id));
      if (!inv.ok) return;
      let pageTarget=p;
      if(g.assist){const assisted=assistNodeDrag(g.assist.context,p,altKey,g.assist.state);if(!assisted.ok){pushNotice('error',assisted.problems[0].message);return;}pageTarget=assisted.value.pagePoint;g.assist.state=assisted.value.state;g.assist.guides=assisted.value.guides;}
      const local = apply(inv.value, pageTarget);
      const candidate = sessionStore.getState().geometryConstraint==='rectangle'&&!g.singleNode?rectangleVertex(original.geometry,g.index,local):moveVertex(original.geometry, g.index, local, sessionStore.getState().geometryConstraint === 'parallelogram' && !g.singleNode);
      const previous=geometryPanel(previewRef.current?.layers[g.id]);setGeometry(target,constrainNodeGeometry(g.project, g.id, candidate,previous?.geometry));
    } else if (g.kind === 'edge' && geometryPanel(target) && geometryPanel(g.layer)) {
      const inv = inverse(worldMatrix(g.project, g.id));
      if (!inv.ok) return;
      const q0 = apply(inv.value, g.start), q1 = apply(inv.value, p);
      const vertices = geometryPanel(g.layer)!.geometry;
      const a = vertices[g.index], b = vertices[(g.index + 1) % vertices.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const nx = (b.y - a.y) / length, ny = (a.x - b.x) / length;
      const amount = (q1.x - q0.x) * nx + (q1.y - q0.y) * ny;
      const candidate = vertices.map((v, i) => i === g.index || i === (g.index + 1) % vertices.length ? { x: v.x + amount * nx, y: v.y + amount * ny } : { ...v });
      setGeometry(target,constrainPanelGeometry(g.project, g.id, candidate));
    } else if (g.kind === 'rotate' && g.rotation) {
      if (Math.hypot(screen.x - g.center.x, screen.y - g.center.y) < 4) return;
      const parent = g.layer.parentId ? worldMatrix(g.project, g.layer.parentId) : [1, 0, 0, 1, 0, 0] as const;
      const inv = inverse(parent); if (!inv.ok) return;
      const q = apply(inv.value, p), rotation = g.rotation;
      const angle = Math.atan2(q.y - rotation.pivotParent.y, q.x - rotation.pivotParent.x);
      rotation.delta += unwrapStep(rotation.pointerAngle, angle); rotation.pointerAngle = angle;
      const final = snappedRotation(rotation.startAngle, rotation.delta, altKey);
      target.matrix = rotateAround(g.project, g.id, rotation.pivotLocal, final - rotation.startAngle);
    } else if (g.kind === 'resize') {
      const inv = inverse(worldMatrix(g.project, g.id)), box = localLayerBounds(g.project, g.id);
      if (!inv.ok || !box) return;
      const proportional = shiftKey || (g.layer.type === 'image' && !altKey) || (g.layer.type === 'bubble' && g.layer.shape === 'circle');
      const next = resizedRect(box, g.index, apply(inv.value, p), { proportional, snap16: sessionStore.getState().snap16 });
      if (!next.ok) return;
      const resized = resizeProject(g.project, g.id, next.value); if (!resized.ok) return;
      preview = resized.value;
    }
    if ((g.kind === 'vertex' || g.kind === 'edge') && target.type === 'panel') {
      for (const childId of target.children) {
        const child = preview.layers[childId];
        if (child.type === 'image' && child.crop) preview.layers[childId]={...child,crop:reflowCrop(target.geometry, { x: child.width, y: child.height }, child.crop)};
      }
    }
    preserveUnlinkedMasks(g.project, preview);
    const dialogueIds=new Set(g.ids.flatMap(id=>{const layer=preview.layers[id],parent=layer.parentId?preview.layers[layer.parentId]:null;return layer.type==='group'&&layer.dialogue?[id]:parent?.type==='group'&&parent.dialogue?[parent.id]:[];}));
    for(const id of dialogueIds){const checked=prepareDialogue(preview,id,editorGeometryTarget(preview,id));if(!checked.ok)return;}
    previewRef.current = preview;
    if (g.kind === 'move' && g.ids.length === 1 && g.layer.type === 'image' && !g.layer.crop) suggestAssociation(preview, g.id, 'move');
    runtimeStore.setState({ previewProject: preview });
    if (!previewActive) setPreviewActive(true);
    gestureLayer.current?.batchDraw();
    overlayLayer.current?.batchDraw();
    addGestureDraws(1);
  };

  const flushPreview = () => {
    const next = pendingPointerRef.current;
    pendingPointerRef.current = null;
    if (next) computePreview(next.page, next.screen, next.altKey, next.shiftKey);
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if(cutToolPointer.current?.pointerId===e.pointerId){cutToolPending.current=pointerPoint(e,cutToolPointer.current.viewport).page;if(cutToolFrame.current===null)cutToolFrame.current=requestAnimationFrame(()=>{cutToolFrame.current=null;flushCutTool();});return;}
    if(areaRef.current?.pointerId===e.pointerId){const r=appendAreaPoint(areaRef.current,pointerPoint(e).screen);if(!r.ok){pushNotice('info',r.problems[0].message);finishArea(false);}else overlayLayer.current?.batchDraw();return;}
    if(!e.buttons&&!runtimeStore.getState().gestureActive&&!currentTextEdit()&&!currentDrawing()&&!currentMangaEdit()&&!document.querySelector('[role=dialog][aria-modal=true]')){
      hoverPending.current={point:pointerPoint(e).page,client:{x:e.clientX,y:e.clientY}};
      if(hoverFrame.current===null)hoverFrame.current=requestAnimationFrame(()=>{hoverFrame.current=null;const next=hoverPending.current;hoverPending.current=null;if(!next||runtimeStore.getState().gestureActive||documentStore.getState().project!==project)return;const hovered=hitLayer(project,pageId,next.point,sessionStore.getState().scopeId,selection,false,vp.zoom);
        if(hovered){let containedImageId:Id|undefined;const candidate=project.layers[hovered]?.type==='panel'?hitVisibleImage(project,pageId,next.point,sessionStore.getState().scopeId):null;if(candidate){for(let id=project.layers[candidate].parentId;id;id=project.layers[id].parentId)if(id===hovered){containedImageId=candidate;break;}}requestElementHint({kind:'canvas',projectId:project.id,layerId:hovered,containedImageId},next.client);}else leaveElementHint();});
    }else hideElementHint();
    if (gestureRef.current?.pointerId !== e.pointerId) return;
    const point = pointerPoint(e);
    pendingPointerRef.current = { ...point, altKey: e.altKey, shiftKey: e.shiftKey };
    if (previewFrameRef.current !== null) return;
    previewFrameRef.current = requestAnimationFrame(() => {
      previewFrameRef.current = null;
      flushPreview();
    });
  };

  const cancelPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if(cutToolPointer.current?.pointerId===e.pointerId)cancelCutTool();
    if(areaRef.current?.pointerId===e.pointerId)finishArea(false);
    if (touchPoints.current.delete(e.pointerId)) doubleTap.current.cancel();
    if (pinchRef.current?.ids.includes(e.pointerId)) finishPinch(false);
    if (panRef.current?.pointerId === e.pointerId) finishPan(false);
    textPointer({ phase: 'cancel', point: { x: 0, y: 0 }, pointerId: e.pointerId });
    if (gestureRef.current?.pointerId === e.pointerId) { doubleTap.current.cancel(); endGesture(false); }
  };

  const selected = mode !== 'crop' && selection[0] && project.layers[selection[0]]?.pageId === pageId &&
    effectiveLayerFlags(project, selection[0]).visible && !effectiveLayerFlags(project, selection[0]).locked ? selection[0] : null;
  return <div ref={rootRef} tabIndex={0} role="application" aria-disabled={isAreaTool(mode)&&areaDisabled} aria-label="页面编辑画布" aria-controls="panel-content-hints" className={`canvas-viewport${spacePan ? ' space-pan' : ''}${isAreaTool(mode)?' area-selecting':''}`} onPointerLeave={()=>{hoverPending.current=null;leaveElementHint();}} onPointerDown={onDown} onPointerMove={(event) => {
    if (event.pointerType === 'touch') doubleTap.current.move(event.pointerId, pointerPoint(event).screen);
    if (event.pointerType === 'touch' && touchPoints.current.has(event.pointerId)) touchPoints.current.set(event.pointerId, pointerPoint(event).screen);
    const pinch = pinchRef.current;
    if (pinch) {
      if (!pinch.ids.includes(event.pointerId)) return;
      const a = touchPoints.current.get(pinch.ids[0]), b = touchPoints.current.get(pinch.ids[1]);
      if (a && b) {
        const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.distance < 4) { if (distance >= 4) { pinch.distance = distance; pinch.midpoint = midpoint; } return; }
        pinch.viewport = pinchViewport(pinch.initial, pinch.midpoint, pinch.distance, midpoint, distance); scheduleViewDraw();
      }
      return;
    }
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current.pending = pointerPoint(event).screen;
      if (panFrame.current === null) panFrame.current = requestAnimationFrame(() => { panFrame.current = null; updatePan(); });
      return;
    }
    const edit = currentTextEdit();
    if (edit && event.currentTarget.hasPointerCapture(event.pointerId)) {
      const inv = inverse(worldMatrix(edit.preview, edit.layerId));
      if (inv.ok) textPointer({ phase: 'move', point: apply(inv.value, pointerPoint(event).page), pointerId: event.pointerId });
      return;
    }
    onMove(event);
  }}
    onDoubleClick={(e) => {
      if(isAreaTool(mode)||mode==='panel-cut'||(mode==='image-crop'||mode==='image-mask'))return;
      // Touch compatibility dblclick follows the browser/OS interval, which can exceed our 300ms contract.
      // Only the explicit tap recognizer may activate touch double-click actions.
      if (lastPointerType.current === 'touch') return;
      if((e.target as Element).closest('.manga-geometry-overlay'))return;
      if ((e.target as HTMLElement).closest('.crop-actions') || currentCropEdit() || currentMaskEdit() || currentBreakoutEdit() || currentDrawing()) return;
      if (currentTextEdit()) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const point = clientToPage({ x: e.clientX, y: e.clientY }, rect, vp);
      const target = hitLayer(project, pageId, point, sessionStore.getState().scopeId, sessionStore.getState().selection,true,vp.zoom);
      const layer = target ? project.layers[target] : null;
      if (layer?.type === 'group') { sessionStore.setState({ scopeId: layer.id, selection: [] }); }
      else if (layer?.type === 'bubble') { const result = beginBubbleTextEdit(layer.id); if (!result.ok) pushNotice('error', result.problems[0].message); }
      else if (layer?.type === 'text') onEditText(layer.id);
      else if (layer?.type === 'image') { const result = beginMaskEdit(layer.id); if (!result.ok) pushNotice('error', result.problems[0].message); }
      else if (layer?.type === 'panel') { const result = beginPanelImageEdit(layer.id, point); if (!result.ok) pushNotice('error', result.problems[0].message); }
    }}
    onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
    onDrop={async (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files); if (!files.length) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const point = clientToPage({ x: e.clientX, y: e.clientY }, rect, vp);
      const hit = hitLayer(project, pageId, point);
      const target = hit && project.layers[hit]?.type === 'panel' ? hit : null;
      const token = makeAsyncToken(target);
      const decoded = [];
      const controller = new AbortController();
      for (const file of files) {
        const result = await decodeImage(file, controller.signal);
        if (!result.ok) {
          for (const asset of decoded) asset.bitmap.close();
          pushNotice('error', `${file.name}：${result.problems[0].message}；本批图片均未导入`);
          return;
        }
        decoded.push(result.value);
      }
      if (!isTokenCurrent(token)) { for (const asset of decoded) asset.bitmap.close(); pushNotice('error', '页面或目标已变化，导入取消'); return; }
      const placed = placeImages(decoded, pageId, point, target);
      if (!placed.ok) { for (const asset of decoded) asset.bitmap.close(); pushNotice('error', placed.problems[0].message); }
    }}
    onPointerUp={(e) => {
      if(cutToolPointer.current?.pointerId===e.pointerId){const p=cutToolPointer.current;cutToolPointer.current=null;cutToolBounds.current=null;if(cutToolFrame.current!==null)cancelAnimationFrame(cutToolFrame.current);cutToolFrame.current=null;cutToolPending.current=null;const r=finishPanelCutPointer(p,pointerPoint(e,p.viewport).page);if(!r.ok)pushNotice('error',r.problems[0].message);touchPoints.current.delete(e.pointerId);doubleTap.current.cancel();return;}
      if(areaRef.current?.pointerId===e.pointerId){const r=appendAreaPoint(areaRef.current,pointerPoint(e).screen,true);if(!r.ok)pushNotice('info',r.problems[0].message);finishArea(r.ok);touchPoints.current.delete(e.pointerId);doubleTap.current.cancel();return;}
      const double = e.pointerType === 'touch' && doubleTap.current.up(e.pointerId, pointerPoint(e).screen, e.timeStamp);
      touchPoints.current.delete(e.pointerId);
      if (pinchRef.current?.ids.includes(e.pointerId)) { doubleTap.current.cancel(); finishPinch(true); return; }
      if (panRef.current?.pointerId === e.pointerId) { doubleTap.current.cancel(); panRef.current.pending = pointerPoint(e).screen; finishPan(true); return; }
      textPointer({ phase: 'up', point: { x: 0, y: 0 }, pointerId: e.pointerId });
      if (gestureRef.current?.pointerId === e.pointerId) { pendingPointerRef.current = { ...pointerPoint(e), altKey: e.altKey, shiftKey: e.shiftKey }; endGesture(true, e.ctrlKey); }
      if (double && !currentTextEdit() && !currentCropEdit() && !currentMaskEdit() && !currentBreakoutEdit() && !currentDrawing()) {
        const fresh = documentStore.getState().project, target = hitLayer(fresh, pageId, pointerPoint(e).page, sessionStore.getState().scopeId, sessionStore.getState().selection,true,vp.zoom), layer = target ? fresh.layers[target] : null;
        if (layer?.type === 'group') sessionStore.setState({ scopeId: layer.id, selection: [] });
        else if (layer?.type === 'bubble') { const result = beginBubbleTextEdit(layer.id); if (!result.ok) pushNotice('error', result.problems[0].message); }
        else if (layer?.type === 'text') onEditText(layer.id);
        else if (layer?.type === 'image') { const result = beginMaskEdit(layer.id); if (!result.ok) pushNotice('error', result.problems[0].message); }
        else if (layer?.type === 'panel') { const result = beginPanelImageEdit(layer.id, pointerPoint(e).page); if (!result.ok) pushNotice('error', result.problems[0].message); }
      }
    }}
    onPointerCancel={cancelPointer} onLostPointerCapture={cancelPointer}
    onWheel={(e) => {
      if(cutToolPointer.current){e.preventDefault();cancelCutTool();return;}
      if(areaRef.current){e.preventDefault();return;}
      if (currentMangaEdit() || currentImageTrim() || currentBreakoutEdit() || currentMaskEdit() || (e.target as HTMLElement).closest('.visible-input')) return;
      e.preventDefault();
      if (panRef.current) finishPan(false);
      if (currentKeyboardMove()) cancelKeyboardMove();
      if (mode === 'crop' && cropTarget) {
        const activeProject = currentCropEdit()?.preview ?? project;
        const image = activeProject.layers[cropTarget.imageId];
        const panel = activeProject.layers[cropTarget.panelId];
        const rect = e.currentTarget.getBoundingClientRect();
        const at = clientToPage({ x: e.clientX, y: e.clientY }, rect, vp);
        const inv = inverse(worldMatrix(activeProject, cropTarget.panelId));
        if (image?.type !== 'image' || panel?.type !== 'panel' || !image.crop || !inv.ok) return;
        previewCropZoom(image.crop.zoom * Math.exp(-e.deltaY * 0.001), apply(inv.value, at));
        return;
      }
      const result = commitTextEdit(); if (!result.ok) { pushNotice('error', result.problems[0].message); return; }
      if (!wheelRef.current) { endGesture(false); wheelRef.current = { viewport: vp, bitmap: bitmap() }; runtimeStore.setState({ gestureActive: true }); setPreviewActive(true); }
      const rect = e.currentTarget.getBoundingClientRect();
      const at = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const multiplier = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? size.height : 1;
      wheelRef.current.viewport = e.ctrlKey || e.metaKey ? zoomAt(wheelRef.current.viewport, at, Math.exp(-e.deltaY * multiplier * .001)) : panBy(wheelRef.current.viewport, { x: -e.deltaX * multiplier, y: -e.deltaY * multiplier });
      scheduleViewDraw(); if (wheelTimer.current !== null) clearTimeout(wheelTimer.current); wheelTimer.current = setTimeout(() => finishWheel(true), 150);
    }}>
    <div ref={paperDisplay} className="page-transparency" aria-hidden="true" style={{ left: vp.pan.x, top: vp.pan.y, width: (page?.width ?? 0) * vp.zoom, height: (page?.height ?? 0) * vp.zoom }} />
    <Stage width={size.width} height={size.height}>
      <Layer listening={false} visible={!appearanceEditing && !previewActive && !textEditingId && !keyboardMoving && !nodeEditing && !styleEditing && !backgroundEditing && !cropEditing && !contourEditing && !trimEditing && !maskEditing && !breakoutEditing && !mangaEditing && !brushEditing && !bubbleBrushEditing}>
        <Shape sceneFunc={(ctx) => { if (currentAppearanceEdit() || previewActive || previewRef.current || currentBubbleBrush()?.valid || currentSpeedStroke() || currentMangaEdit() || currentImageTrim() || currentBreakoutEdit() || currentBackgroundEdit() || currentMaskEdit() || currentPanelStyle() || currentCropEdit() || currentDrawing()?.kind === 'edit') return; draw(ctx, project); addMainDraws(1); }} />
      </Layer>
      <Layer ref={gestureLayer} listening={false} clearBeforeDraw={false} visible={appearanceEditing || previewActive || Boolean(textEditingId) || keyboardMoving || nodeEditing || styleEditing || backgroundEditing || cropEditing || contourEditing || trimEditing || maskEditing || breakoutEditing || mangaEditing || brushEditing || bubbleBrushEditing}>
        <Shape sceneFunc={drawGesture} />
      </Layer>
      <Layer ref={creationLayer} listening={false}>
        <Shape sceneFunc={drawCreation} />
      </Layer>
      <Layer ref={overlayLayer} listening={false}>
        <Shape sceneFunc={(ctx) => {
          addOverlayDraws(1);
          if(areaRef.current)drawAreaSelection(ctx._context,areaRef.current);
          if (sessionStore.getState().showPanelNumbers) {
            const source = currentDrawing()?.kind === 'edit' ? currentDrawing()!.preview : currentPanelStyle()?.preview ?? currentNodeEdit()?.preview ?? currentKeyboardMove()?.preview ?? previewRef.current ?? project;
            const viewport = (panRef.current ?? wheelRef.current ?? pinchRef.current)?.viewport ?? vp, raw = ctx._context;
            raw.save(); raw.font = '12px sans-serif'; raw.textAlign = 'center'; raw.textBaseline = 'middle';
            for (const label of getPanelNumberLabels(source, pageId)) {
              const p = pageToScreen(label.pageTopLeft, viewport), text = String(label.number), width = Math.max(20, raw.measureText(text).width + 10);
              const x=p.x+6,y=p.y+6;if(x>size.width||y>size.height||x+width<0||y+20<0)continue;
              raw.fillStyle = '#33333399'; raw.beginPath(); raw.roundRect(x,y,width,20,5); raw.fill(); raw.fillStyle = '#FFFFFFFF'; raw.fillText(text,x+width/2,y+10);
            } raw.restore();
          }
          const hint = associationStore.getState().hint;
          if (hint?.pageId === pageId && hint.project.id === project.id) {
            const raw = ctx._context; raw.save(); raw.lineWidth = 2; raw.strokeStyle = '#3276b8'; raw.fillStyle = '#3276b8'; raw.font = '13px sans-serif';
            let label = '自由放置', position = { x: vp.pan.x + 12, y: vp.pan.y + 20 };
            if (hint.panelId) { const panel = hint.project.layers[hint.panelId]; if (panel?.type === 'panel') {
              raw.save(); raw.translate(vp.pan.x, vp.pan.y); raw.scale(vp.zoom, vp.zoom); raw.transform(...worldMatrix(hint.project, panel.id)); raw.lineWidth = 2 / vp.zoom; raw.setLineDash([5 / vp.zoom, 3 / vp.zoom]); tracePath(raw, buildRoundedPolygon(panel.geometry, panel.style.borderRadius)); raw.stroke(); raw.restore();
              const box = screenPolygon(hint.project, panel.id, vp); position = { x: Math.min(...box.map(p => p.x)) + 6, y: Math.max(16, Math.min(...box.map(p => p.y)) - 8) };
              label = `${hint.kind === 'library' ? '松开关联到' : hint.kind === 'move' ? 'Ctrl 松开关联到' : '可关联到'}分镜 ${panel.editorNumber ?? ""} · ${panel.name}`;
            } } raw.fillText(label, position.x, position.y); raw.restore();
          }
          if(selection.length>1&&mode!=='speed-brush'&&!textEditingId&&!maskEditing&&!breakoutEditing&&!currentMangaEdit()){const source=currentPanelStyle()?.preview??currentNodeEdit()?.preview??currentKeyboardMove()?.preview??previewRef.current??project;const viewport=(panRef.current??wheelRef.current??pinchRef.current)?.viewport??vp;drawSelectionOutlines(ctx._context,selectionOutlines(source,pageId,selection,viewport));}
          if(isAreaTool(mode)||mode==='panel-cut'||(mode==='image-crop'||mode==='image-mask')){if(selection.length===1)drawSelectionOutlines(ctx._context,selectionOutlines(project,pageId,selection,vp));return;}
          if (!selected || (mode === 'speed-brush'||mode==='bubble-brush') || textEditingId || trimEditing || maskEditing || breakoutEditing || currentMangaEdit() || selection.length===1&&project.layers[selected]?.type==='bubbleTail') return;
          if (project.layers[selected]?.type === 'pageBackground') {
            if(selection.length>1)return;
            const raw = ctx._context; raw.save(); raw.strokeStyle = '#e47651'; raw.lineWidth = 1; raw.setLineDash([5, 3]); raw.strokeRect(vp.pan.x, vp.pan.y, page!.width * vp.zoom, page!.height * vp.zoom); raw.restore(); return;
          }
          const preview = currentAppearanceEdit()?.preview ?? currentPanelStyle()?.preview ?? currentNodeEdit()?.preview ?? currentKeyboardMove()?.preview ?? previewRef.current;
          const overlayVp = (panRef.current ?? wheelRef.current ?? pinchRef.current)?.viewport ?? vp;
          const raw = ctx._context;
          const cut = cutPreviewStore.getState().active;
          if (cut?.project === project && cut.project.layers[cut.id]?.pageId === pageId) {
            const matrix = worldMatrix(project, cut.id);
            raw.save(); raw.lineWidth = 1.5; raw.setLineDash([5, 3]);
            for (const [index, polygon] of cut.result.polygons.entries()) {
              raw.fillStyle = index ? '#faab3724' : '#3388dd24'; raw.strokeStyle = index ? '#c77d14' : '#3388dd'; raw.beginPath();
              for (const [vertex, point] of polygon.entries()) { const screen = pageToScreen({ x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] }, overlayVp); if (vertex) raw.lineTo(screen.x, screen.y); else raw.moveTo(screen.x, screen.y); }
              raw.closePath(); raw.fill(); raw.stroke();
            }
            raw.restore();
          }
          const points = screenPolygon(preview ?? project, selected, overlayVp);
          if (!points.length) return;
          raw.save(); raw.strokeStyle = '#f17848'; raw.lineWidth = 1.5; raw.setLineDash([5, 4]);
          if(selection.length===1){raw.beginPath();points.forEach((p,i)=>i?raw.lineTo(p.x,p.y):raw.moveTo(p.x,p.y));raw.closePath();raw.stroke();}raw.setLineDash([]);
          if(selection.length>1){const b=selectionTransformBounds(preview??project,selection);if(b){const q=pageToScreen({x:b.x,y:b.y},overlayVp);raw.strokeRect(q.x,q.y,b.width*overlayVp.zoom,b.height*overlayVp.zoom);}}
          for (const h of selection.length === 1 ? handles(preview ?? project, selected, overlayVp, mode) : sharedHandles(preview ?? project, selection, overlayVp)) {
            raw.beginPath(); raw.arc(h.point.x, h.point.y, h.kind === 'rotate' ? 6 : 5, 0, 2 * Math.PI);
            raw.fillStyle = h.kind === 'tailBase' ? '#eaf4ff' : '#fffdf9'; raw.fill(); raw.strokeStyle = h.kind === 'tailBase' ? '#3276b8' : '#ec7044'; raw.stroke();
          }
          const nodeTarget=geometryNodeStore.getState().target;
          if(selection.length===1&&nodeTarget?.panelId===selected&&project.layers[selected].type==='panel'){
            const layer=geometryPanel((preview??project).layers[selected]);if(layer){const point=pageToScreen(apply(worldMatrix(preview??project,selected),layer.geometry[nodeTarget.vertexIndex]),overlayVp);raw.beginPath();raw.arc(point.x,point.y,6,0,2*Math.PI);raw.fillStyle='#ec7044';raw.fill();raw.strokeStyle='#ffffff';raw.stroke();}
          }
          const gesture = gestureRef.current, source = preview ?? project, layer = source.layers[selected], box = localLayerBounds(source, selected);
          if (gesture && preview && box && gesture.kind !== 'move' && gesture.kind !== 'crop') {
            let caption = '';
            if (gesture.kind === 'rotate') caption = `${normalizeDegrees(decompose(layer.matrix).thetaRad * 180 / Math.PI).toFixed(1)}°`;
            else if (gesture.kind === 'resize') { const scale = layer.type === 'group' || layer.type === 'image' ? decompose(layer.matrix) : { sx: 1, sy: 1 }; caption = `${(box.width * scale.sx).toFixed(1)} × ${(box.height * scale.sy).toFixed(1)} px`; }
            else if (gesture.kind === 'vertex' && layer.type === 'panel') { const local=layer.geometry[gesture.index],point=apply(worldMatrix(source,selected),local);caption=`页面 X ${point.x.toFixed(1)} · Y ${point.y.toFixed(1)} · ${gesture.assist?.state.axis==='x'?'横向吸附':gesture.assist?.state.axis==='y'?'纵向吸附':'自由'} · 夹角 ${vertexAngle(layer.geometry, gesture.index).toFixed(1)}°`;
              if(gesture.assist){const context=gesture.assist.context,origin=pageToScreen(context.originPage,overlayVp);raw.save();raw.lineWidth=1;raw.setLineDash([4,4]);raw.strokeStyle='#8a999c80';raw.beginPath();raw.moveTo(0,origin.y);raw.lineTo(size.width,origin.y);raw.moveTo(origin.x,0);raw.lineTo(origin.x,size.height);raw.stroke();
                for(const guide of gesture.assist.guides){if(overlayVp.zoom*Math.abs(point[guide.coordinate]-guide.value)>.5)continue;const q=pageToScreen(point,overlayVp);raw.strokeStyle=guide.kind==='axis'?'#e76b36':'#269b91';raw.beginPath();if(guide.kind==='neighbor'){const neighbor=context.neighbors.find(n=>n.vertexIndex===guide.vertexIndex);if(neighbor){const b=pageToScreen(neighbor.page,overlayVp);raw.moveTo(q.x,q.y);raw.lineTo(b.x,b.y);}}else if(guide.coordinate==='x'){raw.moveTo(q.x,0);raw.lineTo(q.x,size.height);}else{raw.moveTo(0,q.y);raw.lineTo(size.width,q.y);}raw.stroke();}raw.restore();}
            }
            else if (gesture.kind === 'edge' && layer.type === 'panel' && gesture.layer.type === 'panel') { const a = layer.geometry[gesture.index], b = layer.geometry[(gesture.index + 1) % layer.geometry.length]; caption = `h ${edgeDisplacement(gesture.layer.geometry, layer.geometry, gesture.index).toFixed(1)} px · 边角 ${(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI).toFixed(1)}°`; }
            if (caption) { const left = Math.min(size.width - 180, Math.max(5, points[0].x)), top = Math.max(20, points[0].y - 20); raw.font = '12px sans-serif'; const width = raw.measureText(caption).width + 16; raw.fillStyle = '#213c30ee'; raw.fillRect(left, top - 14, width, 22); raw.fillStyle = '#fff'; raw.fillText(caption, left + 8, top + 2); }
          }
          raw.restore();
          const snap = gestureRef.current?.snap;
          if (snap?.guides.length && preview) {
            const delta = { x: preview.layers[selected].matrix[4] - project.layers[selected].matrix[4], y: preview.layers[selected].matrix[5] - project.layers[selected].matrix[5] };
            const parent = project.layers[selected].parentId, parentWorld = parent ? worldMatrix(project, parent) : [1, 0, 0, 1, 0, 0] as const;
            const moved = { ...snap.bounds, x: snap.bounds.x + parentWorld[0] * delta.x + parentWorld[2] * delta.y, y: snap.bounds.y + parentWorld[1] * delta.x + parentWorld[3] * delta.y };
            raw.save(); raw.strokeStyle = '#e44899'; raw.lineWidth = 1; raw.setLineDash([4, 3]);
            for (const guide of snap.guides) {
              const a = guide.axis === 'x' ? { x: guide.value, y: Math.min(moved.y, guide.bounds.y) } : { x: Math.min(moved.x, guide.bounds.x), y: guide.value };
              const b = guide.axis === 'x' ? { x: guide.value, y: Math.max(moved.y + moved.height, guide.bounds.y + guide.bounds.height) } : { x: Math.max(moved.x + moved.width, guide.bounds.x + guide.bounds.width), y: guide.value };
              const start = pageToScreen(a, overlayVp), end = pageToScreen(b, overlayVp); raw.beginPath(); raw.moveTo(start.x, start.y); raw.lineTo(end.x, end.y); raw.stroke();
            }
            raw.restore();
          }
        }} />
      </Layer>
    </Stage>
    <DrawingSurface viewport={vp} />
    {mode === 'speed-brush' && !textEditingId && <SpeedBrushSurface viewport={vp} />}
    {mode==='bubble-brush'&&!textEditingId&&<BubbleBrushSurface viewport={vp}/>}
    <MangaEditPanel />
    {selection.length===1&&selected&&!isAreaTool(mode)&&mode!=='panel-cut'&&mode!=='image-crop'&&mode!=='image-mask'&&mode!=='bubble-brush'&&mode!=='speed-brush'&&!maskEditing&&!breakoutEditing&&!textEditingId&&(project.layers[selected]?.type==='bubbleTail'||mangaEditing&&currentMangaEdit()?.kind==='shape'?[selected]:!mangaEditing&&project.layers[selected]?.type==='bubble'?(project.layers[selected] as import('../domain/types').BubbleLayer).children.filter(cid=>project.layers[cid]?.type==='bubbleTail'):[]).map(id=><MangaGeometryEditor key={id} id={id} project={project} viewport={vp}/>)}
    <CanvasContextMenu viewport={vp} pageId={pageId} />
    {breakoutEditing && <BreakoutEditor viewport={vp} />}
    {trimEditing && <TrimEditor viewport={vp}/> }
    {maskEditing && <MaskEditor viewport={vp} />}
    {textEditingId && (currentTextEdit()?.preview ?? project).layers[textEditingId]?.type === 'text' && (currentTextEdit()?.preview ?? project).layers[textEditingId]?.pageId === pageId && <TextEditor key={textEditingId} project={currentTextEdit()?.preview ?? project} id={textEditingId} viewport={vp} size={size} />}
    {cropEditing && <CropControls finish={finishCrop} />}
    {selected&&selection.length===1&&project.layers[selected]?.type==='text'&&!maskEditing&&!breakoutEditing&&!cropEditing&&mode==='select'&&<BubbleTextFrameEditor id={selected} project={project} viewport={vp}/>}
    <span className="zoom-readout">{Math.round(vp.zoom * 100)}%</span>
  </div>;
}
