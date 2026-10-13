import { paintStyledOps } from '../appearance/compositor';
import { paintFill, paintStroke, paintBorderRegion, customStroke } from '../appearance/paint';
import { compositeMode,presentation } from '../appearance/model';
import { paintImageWindow } from '../images/paintImageWindow';
import { bubbleFrameBounds } from '../text/bubbleFrameBounds';
import { maskContains, traceImageMask } from '../images/maskGeometry';
import { speedBrushContains } from '../library/speedBrushGeometry';
import { drawBackground } from '../pages/drawBackground';
import { buildPaintOps, type ScenePaintOp } from './paintOps';
import { applyPanelClipPolicy, imageVisibleAt } from './clipPolicy';
import type { Id, Layer, Mat, Point, Project, Rect } from '../domain/types';
import type { ShapePath } from '../geometry/types';
import { apply, inverse, multiply, worldMatrix } from '../geometry/matrix';
import { buildRoundedPolygon } from '../geometry/roundedPolygon';
import { snapshotSceneFonts } from '../text/fonts';
import { runtimeStore } from '../state/runtimeStore';
import { compileScene, type SceneTextResources } from './compileScene';
import { applyCanvasTextPolicy } from '../text/canvasStyle';
import { composeBubble } from '../bubbles/composeBubble';
import { buildTailAppearance } from '../bubbles/tailGeometry';
import { regionContains } from '../geometry/pathRegion';
import { flattenForRender } from '../geometry/flattenForBoolean';
import { distanceToSegment, containsSimplePolygon } from '../geometry/simplePolygon';
import { prepareDialogue } from '../bubbles/dialogueGeometry';
import { effectGeometryFor } from '../text/effectBounds';
import { regionToPath } from '../geometry/renderRegion';
import { drawOverlapSurface } from '../bubbles/overlapRaster';
import { prepareTailPaint } from '../bubbles/tailPaint';
import type { Region } from '../geometry/pathRegion';
import { drawBubbleInk, bubbleInkContains } from '../bubbles/inkPaint';

export type ImageResources = Map<string, CanvasImageSource>;
const I: Mat = [1, 0, 0, 1, 0, 0];

export function tracePath(ctx: CanvasRenderingContext2D, path: ShapePath, begin = true): void {
  if (begin) ctx.beginPath();
  for (const op of path.ops) {
    if (op.op === 'M') ctx.moveTo(op.p.x, op.p.y);
    else if (op.op === 'L') ctx.lineTo(op.p.x, op.p.y);
    else if (op.op === 'Q') ctx.quadraticCurveTo(op.control.x, op.control.y, op.p.x, op.p.y);
    else if (op.op === 'C') ctx.bezierCurveTo(op.c1.x, op.c1.y, op.c2.x, op.c2.y, op.p.x, op.p.y);
    else ctx.closePath();
  }
}

function drawShape(ctx: CanvasRenderingContext2D, path: ShapePath, fill: string, stroke: string, width: number): void {
  tracePath(ctx, path);
  ctx.fillStyle = fill;
  ctx.fill();
  if (width > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

function drawText(ctx: CanvasRenderingContext2D, layer: Extract<Layer, { type: 'text' }>, prepared: SceneTextResources): void {
  const { text } = layer;
  const resource = prepared.text.get(layer.id);
  if (!resource) throw new Error(`文字“${layer.name}”缺少预编译资源`);
  const box=resource.layout.frameBox??layer.box;
  if (layer.role === 'sfx' && layer.effects?.recipe === 'legacy-sfx-v5') {
    ctx.save(); ctx.font = resource.font; ctx.fillStyle = text.font.color;
    ctx.strokeStyle = layer.effects.outlineColor; ctx.lineWidth = layer.effects.outlineWidth;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'miter'; ctx.miterLimit = 10;
    if (layer.effects.outlineWidth > 0) ctx.strokeText(text.content, 0, text.font.size);
    ctx.fillText(text.content, 0, text.font.size); ctx.restore(); return;
  }
  if(layer.role==='sfx'&&layer.effects&&(layer.effects.shearDeg!==0||layer.effects.deformation!=='none')){
    const effect=prepared.effectTexts.get(layer.id);if(!effect)throw Error('声效缺少变形资源');
    ctx.save();ctx.fillStyle=text.font.color;ctx.strokeStyle=layer.effects.outlineColor;ctx.lineWidth=layer.effects.outlineWidth;ctx.lineJoin='round';ctx.miterLimit=2;
    for(const glyph of effect.glyphs){ctx.save();ctx.transform(...glyph.localMatrix);ctx.font=glyph.font;ctx.textAlign=glyph.alignment==='left-baseline'?'left':'center';ctx.textBaseline=glyph.alignment==='left-baseline'?'alphabetic':'middle';if(layer.effects.outlineWidth)ctx.strokeText(glyph.glyph,glyph.drawOrigin.x,glyph.drawOrigin.y);ctx.fillText(glyph.glyph,glyph.drawOrigin.x,glyph.drawOrigin.y);ctx.restore();}ctx.restore();return;
  }
  ctx.save();
  if(layer.role!=='sfx'){const safe=resource.layout.safeClipBox;if(safe){ctx.beginPath();ctx.rect(safe.x,safe.y,safe.width,safe.height);ctx.clip();}ctx.beginPath();ctx.rect(box.x, box.y, box.width, box.height);ctx.clip();}
  ctx.fillStyle = text.font.color;
  ctx.font = resource.font;
  if(layer.role==='sfx'&&layer.effects){ctx.strokeStyle=layer.effects.outlineColor;ctx.lineWidth=layer.effects.outlineWidth;ctx.lineJoin='round';ctx.miterLimit=2;}
  const layout = resource.layout;
  if (text.direction === 'horizontal') {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (const run of layout.runs) {
      if (text.letterSpacing === 0) {if(layer.role==='sfx'&&layer.effects?.outlineWidth)ctx.strokeText(run.paintText??run.text,run.origin.x,run.baseline);ctx.fillText(run.paintText??run.text, run.origin.x, run.baseline);}
      else for (const cell of run.cells) {if(layer.role==='sfx'&&layer.effects?.outlineWidth)ctx.strokeText(cell.glyph,cell.box.x,run.baseline);ctx.fillText(cell.glyph, cell.box.x, run.baseline);}
    }
  } else {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const baseFont = ctx.font;
    for (const run of layout.runs) for (const cell of run.cells) {
      ctx.font = cell.fontFamily ? resource.glyphFonts.get(cell.fontFamily)! : baseFont;
      const x = cell.box.x + cell.box.width / 2, y = cell.box.y + cell.box.height / 2;
      if (cell.rotation) { ctx.save(); ctx.translate(x, y); ctx.rotate(cell.rotation);if(layer.role==='sfx'&&layer.effects?.outlineWidth)ctx.strokeText(cell.glyph,0,0); ctx.fillText(cell.glyph, 0, 0); ctx.restore(); }
      else {if(layer.role==='sfx'&&layer.effects?.outlineWidth)ctx.strokeText(cell.glyph,x,y);ctx.fillText(cell.glyph, x, y);}
    }
  }
  ctx.restore();
}

function drawOp(ctx: CanvasRenderingContext2D, project: Project, op: ScenePaintOp, images: ImageResources, prepared: SceneTextResources, opacity?: ReadonlyMap<Id, number>, cropGhostId?: Id): void {
  const id = op.layerId;
  const layer = project.layers[id];
  if (!layer || !layer.visible) return;
  ctx.save();
  try{
  for (const parent of op.lineage) ctx.globalAlpha *= opacity?.get(parent) ?? 1;
  applyPanelClipPolicy(ctx, project, op);
  ctx.transform(...op.worldMatrix);
  if(layer.type==='group'&&layer.dialogue&&op.kind==='dialogueSurface'){
    const geometry=prepared.dialogues.get(id);if(!geometry)throw Error('对白组缺少预编译资源');
    const spec=layer.dialogue;
    const fillRegion=(region:Parameters<typeof regionToPath>[0],color:string)=>{if(region.length)drawShape(ctx,regionToPath(region),color,'transparent',0);};
    if(spec.mode==='connector')fillRegion(geometry.lines,spec.fusionStyle.borderColor);
    if(spec.mode==='fused') {fillRegion(geometry.outer??[],spec.fusionStyle.outerStroke?.color??'transparent');if(geometry.fusionRegion)paintFill(ctx,regionToPath(geometry.fusionRegion),spec.fusionStyle.fill,layer);fillRegion(geometry.inner??[],spec.fusionStyle.innerStroke?.color??'transparent');if(customStroke(layer)&&geometry.fusionRegion)paintStroke(ctx,regionToPath(geometry.fusionRegion),spec.fusionStyle.borderColor,spec.fusionStyle.borderWidth,layer);else paintBorderRegion(ctx,regionToPath(geometry.border),spec.fusionStyle.borderColor,layer);fillRegion(geometry.lines,spec.fusionStyle.borderColor);}
    if(spec.mode==='overlap'){
      ctx.save();ctx.globalCompositeOperation=compositeMode(presentation(layer).fillBlendMode);
      drawOverlapSurface(ctx,geometry,project,spec.overlapOpacity);
      ctx.restore();
    }
    if(spec.mode!=='fused')for(const cid of geometry.memberIds){const member=project.layers[cid],g=prepared.bubbles.get(cid);if(member.type!=='bubble'||!g)continue;const paintMember=layer.presentation?{...member,presentation:layer.presentation}:member;ctx.save();ctx.transform(...member.matrix);
      fillRegion(g.outerRegion??[],member.style.outerStroke?.color??'transparent');
      if(spec.mode==='connector'){paintFill(ctx,g.outline,member.style.fill,paintMember);if(g.borderRegion===undefined||customStroke(paintMember))paintStroke(ctx,g.outline,member.style.borderColor,member.style.borderWidth,paintMember);}
      else if(g.borderRegion===undefined){tracePath(ctx,g.outline);ctx.strokeStyle=member.style.borderColor;ctx.lineWidth=member.style.borderWidth;ctx.lineJoin='round';if(member.style.borderWidth)ctx.stroke();}
      fillRegion(g.innerRegion??[],member.style.innerStroke?.color??'transparent');
      if(g.borderRegion!==undefined&&!customStroke(paintMember))paintBorderRegion(ctx,regionToPath(g.borderRegion),member.style.borderColor,paintMember);
      if(g.tailLine){tracePath(ctx,g.tailLine);ctx.strokeStyle=member.style.borderColor;ctx.lineWidth=member.style.borderWidth;ctx.lineCap='round';if(member.style.borderWidth)ctx.stroke();}ctx.restore();
    }
    for (const cid of geometry.memberIds) { const member=project.layers[cid]; if(member.type==='bubble'){ctx.save();ctx.transform(...member.matrix);drawBubbleInk(ctx,member);ctx.restore();} }
  }
  else if (layer.type === 'pageBackground') drawBackground(ctx, project.pages[layer.pageId], layer);
  else if (layer.type === 'panel') {
    const path = prepared.panels.get(id);
    if (!path) throw new Error(`分镜“${layer.name}”缺少预编译轮廓`);
    const ghost = cropGhostId ? project.layers[cropGhostId] : null;
    if (op.kind === 'panelFill' && ghost?.type === 'image' && ghost.parentId === layer.id && ghost.crop) {
      const source = images.get(project.assets[ghost.assetId]?.renderHash), mapping = prepared.images.get(ghost.id);
      if (source && mapping) {
        // Subtract the real rounded mask. Ancestor clips and sibling paint order remain active.
        ctx.save(); ctx.beginPath(); ctx.rect(mapping.x, mapping.y, mapping.width, mapping.height); tracePath(ctx, path, false); ctx.clip('evenodd');
        ctx.globalAlpha *= .35; paintImageWindow(ctx, source, mapping);
        ctx.fillStyle = '#000000'; ctx.globalAlpha *= .3; ctx.fillRect(mapping.x, mapping.y, mapping.width, mapping.height); ctx.restore();
      }
    }
    if (op.kind === 'panelFill') paintFill(ctx,path,layer.style.fill,layer);
    if(op.kind==='panelBorder')paintStroke(ctx,path,layer.style.borderColor,layer.style.borderWidth,layer,layer.geometry);
  } else if (layer.type === 'image') {
    const meta = project.assets[layer.assetId];
    const image = meta ? images.get(meta.renderHash) : undefined;
    if (image) {
      const rect = prepared.images.get(id);
      if (!rect) throw new Error(`图片“${layer.name}”缺少预编译映射`);
      if (layer.mask?.enabled) {
        if (cropGhostId === layer.id) {
          ctx.save(); ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.width, rect.height); traceImageMask(ctx, layer.mask, false); ctx.clip('evenodd'); ctx.globalAlpha *= .3;
          paintImageWindow(ctx, image, rect); ctx.restore();
        }
        traceImageMask(ctx, layer.mask); ctx.clip();
      }
      paintImageWindow(ctx, image, rect);
    }
  } else if (layer.type === 'bubble') {
    const geometry = prepared.bubbles.get(id);
    if (!geometry) throw new Error(`气泡“${layer.name}”缺少预编译轮廓`);
    if(geometry.outerRegion?.length)drawShape(ctx,regionToPath(geometry.outerRegion),layer.style.outerStroke!.color,'transparent',0);
    paintFill(ctx,geometry.outline,layer.style.fill,layer);
    if(geometry.borderRegion===undefined || customStroke(layer))paintStroke(ctx,geometry.outline,layer.style.borderColor,layer.style.borderWidth,layer);
    if(geometry.innerRegion?.length)drawShape(ctx,regionToPath(geometry.innerRegion),layer.style.innerStroke!.color,'transparent',0);
    if(geometry.borderRegion!==undefined&&!customStroke(layer))paintBorderRegion(ctx,regionToPath(geometry.borderRegion),layer.style.borderColor,layer);
    if (geometry.tailLine) {
      tracePath(ctx, geometry.tailLine);
      ctx.strokeStyle = layer.style.borderColor;
      ctx.lineWidth = layer.style.borderWidth;
      ctx.stroke();
    }
    drawBubbleInk(ctx, layer);
  } else if(layer.type==='bubbleTail'){
    const geometry=prepared.tailPaints.get(id);if(!geometry)throw Error(`尾巴“${layer.name}”缺少预编译几何`);
    if(geometry.outer?.length)drawShape(ctx,regionToPath(geometry.outer),geometry.style.outerStroke!.color,'transparent',0);
    drawShape(ctx,regionToPath(geometry.fill),geometry.style.fill,'transparent',0);if(geometry.inner?.length)drawShape(ctx,regionToPath(geometry.inner),geometry.style.innerStroke!.color,'transparent',0);drawShape(ctx,regionToPath(geometry.border),geometry.style.borderColor,'transparent',0);
  } else if (layer.type === 'text') drawText(ctx, layer, prepared);
  else if (layer.type === 'decoration') {
    const spec = layer.spec;
    if (spec.kind === 'shape') {
      const path=prepared.decorations.get(id)?.[0];if(!path)throw Error('形状缺少预编译轮廓');paintFill(ctx,path,spec.style.fill,layer);paintStroke(ctx,path,spec.style.borderColor,spec.style.borderWidth,layer,spec.geometry);
    } else if (spec.kind === 'sfx') {
      ctx.fillStyle = spec.color;
      ctx.strokeStyle = spec.outline;
      ctx.lineWidth = spec.outlineWidth;
      const font = prepared.sfx.get(layer.id);
      if (!font) throw new Error(`音效“${layer.name}”缺少预编译字体`);
      ctx.font = font;
      if (spec.outlineWidth) ctx.strokeText(spec.content, 0, spec.fontSize);
      ctx.fillText(spec.content, 0, spec.fontSize);
    } else if (spec.kind === 'speed-brush') {
      const paths = prepared.decorations.get(id);
      if (!paths) throw new Error(`笔刷“${layer.name}”缺少预编译轮廓`);
      ctx.fillStyle = spec.color;
      for (const path of paths) { tracePath(ctx, path); ctx.fill('nonzero'); }
    } else {
      ctx.strokeStyle = spec.color;
      ctx.lineWidth = spec.strokeWidth;
      const paths = prepared.decorations.get(id);
      if (!paths) throw new Error(`装饰“${layer.name}”缺少预编译轮廓`);
      for (const path of paths) {
        tracePath(ctx, path);
        ctx.stroke();
      }
    }
  }
  }finally{ctx.restore();}
}

export function drawPage(ctx: CanvasRenderingContext2D, project: Project, pageId: Id, images: ImageResources, roots?: Id[], paintBackground = true, opacity?: ReadonlyMap<Id, number>, cropGhostId?: Id, prepared?: SceneTextResources): void {
  applyCanvasTextPolicy(ctx);
  const page = project.pages[pageId];
  if (!page) return;
  if(!prepared){const t=ctx.getTransform();prepared=compileScene(project, pageId, snapshotSceneFonts(project, pageId, roots), { snapshot: false, roots, fontGeneration: runtimeStore.getState().fontGeneration,target:{localToOutput:[t.a,t.b,t.c,t.d,0,0],tolerancePx:.25} }).text;}
  ctx.save();
  try{
  ctx.beginPath();
  ctx.rect(0, 0, page.width, page.height);
  ctx.clip();
  if (paintBackground && project.schemaVersion < 4) { ctx.fillStyle = page.background ?? '#FFFFFFFF'; ctx.fillRect(0, 0, page.width, page.height); }
  paintStyledOps(ctx,project,prepared.paintOps,(target,op)=>drawOp(target,project,op,images,prepared!,opacity,cropGhostId));
  }finally{ctx.restore();}
}

/** Panel previews keep the same subtree painter and ancestor clipping, without painting other siblings or paper. */
export function drawLayerFragment(ctx: CanvasRenderingContext2D, project: Project, id: Id, images: ImageResources): void {
  applyCanvasTextPolicy(ctx);
  const layer = project.layers[id]; if (!layer) return;
  const source = { ...project, layers: { ...project.layers, [id]: { ...layer, visible: true } } };
  const prepared = compileScene(source, layer.pageId, snapshotSceneFonts(source, layer.pageId, [id]), { snapshot: false, roots: [id], fontGeneration: runtimeStore.getState().fontGeneration }).text;
  drawPage(ctx, source, layer.pageId, images, [id], false, undefined, undefined, prepared);
}

function containsRect(rect: Rect, p: Point): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
}

let panelHitContext: CanvasRenderingContext2D | null = null;
function containsPanelPath(layer: Extract<Layer, { type: 'panel' }>, local: Point): boolean {
  panelHitContext ??= document.createElement('canvas').getContext('2d');
  if (!panelHitContext) return false;
  tracePath(panelHitContext, buildRoundedPolygon(layer.geometry, layer.style.borderRadius));
  return panelHitContext.isPointInPath(local.x, local.y);
}
/** Crop interaction uses the same rounded paths as rendering, including every owning panel. */
export function pointInsidePanelClips(project: Project, panelId: Id, pagePoint: Point): boolean {
  const panel = project.layers[panelId], page = panel && project.pages[panel.pageId];
  if (panel?.type !== 'panel' || !page || !containsRect({ x: 0, y: 0, width: page.width, height: page.height }, pagePoint)) return false;
  panelHitContext ??= document.createElement('canvas').getContext('2d'); if (!panelHitContext) return false;
  for (let layer: Layer | undefined = panel; layer; layer = layer.parentId ? project.layers[layer.parentId] : undefined) {
    if (!layer.visible || layer.locked) return false;
    if (layer.type === 'panel') {
      const inv = inverse(worldMatrix(project, layer.id)); if (!inv.ok) return false;
      if (!containsPanelPath(layer, apply(inv.value, pagePoint))) return false;
    }
  }
  return true;
}

export function hitVisibleImage(project:Project,pageId:Id,pagePoint:Point,scopeId:Id|null=null):Id|null {
  const page=project.pages[pageId];if(!page||!containsRect({x:0,y:0,width:page.width,height:page.height},pagePoint))return null;
  const ops=buildPaintOps(project,pageId,new Map());
  for(let i=ops.length-1;i>=0;i--){const op=ops[i],image=project.layers[op.layerId];if(image?.type!=='image'||scopeId&&!op.lineage.includes(scopeId)||op.lineage.some(id=>!project.layers[id]?.visible||project.layers[id].locked))continue;if(imageVisibleAt(project,image,pagePoint,op.panelClips))return image.id;}return null;
}

export function hitLayer(project: Project, pageId: Id, pagePoint: Point, scopeId: Id | null = null, preferredSelection: readonly Id[] = [],members=false,zoom=1): Id | null {
  const nearRegion=(region:Region,world:Mat):boolean=>region.some(polygon=>polygon.some(ring=>ring.slice(1).some((p,i)=>distanceToSegment(pagePoint,apply(world,{x:ring[i][0],y:ring[i][1]}),apply(world,{x:p[0],y:p[1]}))*zoom<=6)));
  const selected = new Set(preferredSelection);
  const page = project.pages[pageId];
  if (!page || !containsRect({ x: 0, y: 0, width: page.width, height: page.height }, pagePoint)) return null;
  const visit = (id: Id, parentMatrix: Mat): Id | null => {
    const layer = project.layers[id];
    if (!layer || !layer.visible || layer.locked) return null;
    if (layer.type === 'pageBackground') return null;
    const world = multiply(parentMatrix, layer.matrix);
    const inv = inverse(world);
    if (!inv.ok) return null;
    const local = apply(inv.value, pagePoint);
    if (layer.type === 'group') {
      for (let i = layer.children.length - 1; i >= 0; i--) {
        const hit = visit(layer.children[i], world);
        // Keep the topmost painted branch. A descendant explicitly selected in
        // the layer list may start a move without changing the group scope.
        // Selected ancestors still take precedence, avoiding a double move.
        if (hit) return members && layer.dialogue ? hit : selected.has(id) ? id : selected.has(hit) ? hit : id;
      }
      if(layer.dialogue){const geometry=prepareDialogue(project,id);if(geometry.ok&&(regionContains(geometry.value.outer??[],local)||regionContains(geometry.value.fusionRegion??[],local)||regionContains(geometry.value.lines,local)||nearRegion(geometry.value.lines,world)))return id;}
      return null;
    }
    if (layer.type === 'panel') {
      // Breakout changes clipping, not the default owner of an overlap click.
      // Inside the frame keep normal panel selection (or an explicitly picked image).
      if (containsPanelPath(layer, local)) {
        for (const childId of [...layer.children].reverse()) {
          const child = project.layers[childId];
          if (child?.type === 'image' && !child.crop && selected.has(childId)) { const hit = visit(childId, world); if (hit) return hit; }
        }
        return id;
      }
      const breakout = buildPaintOps(project, pageId, new Map(), [id]).filter(op => op.phase === 'breakout');
      for (const op of breakout.reverse()) {
        const image = project.layers[op.layerId];
        if (image?.type === 'image' && op.lineage.every(ancestor => project.layers[ancestor].visible && !project.layers[ancestor].locked) && imageVisibleAt(project, image, pagePoint, op.panelClips)) return image.id;
      }
      return null;
    }
    if (layer.type === 'bubble') {
      if (bubbleInkContains(layer, local)) return id;
      for(const child of [...layer.children].reverse())if(project.layers[child]?.type==='bubbleTail'){const hit=visit(child,world);if(hit)return hit;}
      const geometry=composeBubble(project,id);if(!geometry.ok)return null;
      if(regionContains(geometry.value.fillRegion,local)||regionContains(geometry.value.outerRegion??[],local)||regionContains(geometry.value.borderRegion??[],local))return id;
      if(geometry.value.borderRegion===undefined&&layer.style.borderWidth){const f=flattenForRender(geometry.value.outline);if(f.ok&&f.value.some(s=>s.points.some((p,i)=>i<s.points.length-1||s.closed?distanceToSegment(local,p,s.points[(i+1)%s.points.length])<=layer.style.borderWidth/2:false)))return id;}return null;
    }
    if (layer.type === 'text') {
      if(layer.role==='sfx'&&layer.effects){const geometry=effectGeometryFor(layer);if(geometry)return(geometry.legacy||!geometry.glyphs.length?containsRect(geometry.bounds,local):geometry.glyphs.some(g=>containsSimplePolygon(g.inkPolygon,local)))?id:null;}
      const frame=bubbleFrameBounds(project,id);return containsRect(frame?.box??layer.box,local)&&(!frame||containsRect(frame.safe,local))?id:null;
    }
    if (layer.type === 'image') return containsRect({ x: 0, y: 0, width: layer.width, height: layer.height }, local) && (!layer.mask || maskContains(layer.mask, local)) ? id : null;
    if (layer.type === 'bubbleTail') {const geometry=buildTailAppearance(project,id);if(!geometry.ok)return null;if(geometry.value.fillRegions.some(r=>regionContains(r,local)))return id;const point=apply(world,local);
      for(const path of geometry.value.linePaths){const flat=flattenForRender(path);if(!flat.ok)continue;for(const sub of flat.value)for(let i=1;i<sub.points.length;i++)if(distanceToSegment(point,apply(world,sub.points[i-1]),apply(world,sub.points[i]))*zoom<=6)return id;}
      // Solid contours remain selectable within a 6 CSS-pixel border tolerance.
      const paint=prepareTailPaint(project,id);if(paint.ok&&(regionContains(paint.value.outer??[],local)||regionContains(paint.value.border,local)||nearRegion(paint.value.border,world)))return id;
      const tolerance=6/zoom;
      for(const region of geometry.value.fillRegions)for(const polygon of region)for(const ring of polygon)for(let i=0;i+1<ring.length;i++)if(distanceToSegment(point,apply(world,{x:ring[i][0],y:ring[i][1]}),apply(world,{x:ring[i+1][0],y:ring[i+1][1]}))<=tolerance)return id;
      return null;}
    if(layer.spec.kind==='shape')return containsSimplePolygon(layer.spec.geometry,local)?id:null;
    if (layer.spec.kind === 'speed-brush') return speedBrushContains(layer.spec, local) ? id : null;
    return containsRect({ x: 0, y: 0, width: layer.spec.width, height: layer.spec.height }, local) ? id : null;
  };
  if (scopeId) {
    const scope = project.layers[scopeId];
    if (!scope || scope.pageId !== pageId || scope.type !== 'group') return null;
    let scopeWorld: Mat = I;
    const ancestors: Layer[] = [];
    for (let current: Layer | undefined = scope; current; current = current.parentId ? project.layers[current.parentId] : undefined) {
      if (!current.visible || current.locked) return null;
      ancestors.unshift(current);
    }
    for (const ancestor of ancestors) {
      scopeWorld = multiply(scopeWorld, ancestor.matrix);
      if (ancestor.type === 'panel') {
        const inv = inverse(scopeWorld);
        if (!inv.ok || !containsPanelPath(ancestor, apply(inv.value, pagePoint))) return null;
      }
    }
    for (let i = scope.children.length - 1; i >= 0; i--) {
      const hit = visit(scope.children[i], scopeWorld);
      if (hit) return hit;
    }
    return null;
  }
  for (let i = page.roots.length - 1; i >= 0; i--) {
    const hit = visit(page.roots[i], I);
    if (hit) return hit;
  }
  return null;
}
