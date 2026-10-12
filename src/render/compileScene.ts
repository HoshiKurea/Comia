import type { Id, Layer, Project, Rect } from '../domain/types';
import type { ShapePath } from '../geometry/types';
import { buildRoundedPolygon } from '../geometry/roundedPolygon';
import { type BubbleGeometry } from '../bubbles/geometry';
import { buildDecoration } from '../library/decorations';
import { resolveCrop } from '../images/crop';
import { cachedLayout } from '../state/runtimeStore';
import type { FontResolution, TextLayout } from '../text/types';
import { layoutHorizontal, layoutVertical } from '../text/layout';
import { resolveVerticalGlyph } from '../text/verticalGlyphs';
import { fontStyle } from '../text/fontStyle';
import { applyCanvasTextPolicy } from '../text/canvasStyle';
import { buildPaintOps, type ScenePaintOp } from './paintOps';
import { composeBubble, type MangaBubbleGeometry } from '../bubbles/composeBubble';
import type { PreparedTail } from '../bubbles/tailGeometry';
import { LOCAL_TARGET, type GeometryTarget } from '../geometry/flattenForBoolean';
import { multiply, worldMatrix } from '../geometry/matrix';
import { prepareDialogue, type PreparedDialogue } from '../bubbles/dialogueGeometry';
import { compileEffectText, type PreparedEffectText } from '../text/effects';
import { prepareTailPaint, type TailPaint } from '../bubbles/tailPaint';
import { resolveBubbleTextFrame } from '../text/bubbleTextFrame';

export interface PreparedText {
  readonly font: string;
  readonly layout: TextLayout;
  readonly glyphFonts: ReadonlyMap<string, string>;
}
export interface PreparedImage extends Rect { source?: Rect }
export interface SceneTextResources {
  readonly paintOps: readonly ScenePaintOp[];
  readonly text: ReadonlyMap<Id, PreparedText>;
  readonly sfx: ReadonlyMap<Id, string>;
  readonly panels: ReadonlyMap<Id, ShapePath>;
  readonly bubbles: ReadonlyMap<Id, MangaBubbleGeometry>;
  readonly tails: ReadonlyMap<Id, PreparedTail>;
  readonly dialogues: ReadonlyMap<Id, PreparedDialogue>;
  readonly effectTexts: ReadonlyMap<Id, PreparedEffectText>;
  readonly tailPaints: ReadonlyMap<Id,TailPaint>;
  readonly decorations: ReadonlyMap<Id, readonly ShapePath[]>;
  readonly images: ReadonlyMap<Id, PreparedImage>;
}
export interface RenderPlan {
  readonly project: Project;
  readonly pageId: Id;
  readonly text: SceneTextResources;
}

export interface CompileOptions {
  target?: GeometryTarget;
  /** Interactive callers hold an immutable document/draft; asynchronous jobs must keep the default copy. */
  snapshot?: boolean;
  roots?: readonly Id[];
  /** Only interactive plans reuse the bounded layout cache; asynchronous jobs have independent resources. */
  fontGeneration?: number;
}
const geometryCache = new WeakMap<Layer, ShapePath | BubbleGeometry | readonly ShapePath[]>();
const effectCache=new WeakMap<Layer,{key:string;value:PreparedEffectText}>();

/** Prepares paths, crop mappings, fonts and layout before paint, preserving the ordered container tree. */
export function compileScene(project: Project, pageId: Id, resolutions: readonly FontResolution[], options: CompileOptions = {}): RenderPlan {
  const page = project.pages[pageId];
  if (!page) throw new Error('渲染页面不存在');
  const copy = options.snapshot !== false;
  const snapshot: Project = copy ? { ...project, pageOrder: [pageId], pages: { [pageId]: structuredClone(page) }, layers: {}, assets: {}, templates: {} } : project;
  const fonts = new Map(resolutions.map(({ requested, actual }) => [requested, actual]));
  const family = (requested: string): string => {
    const actual = fonts.get(requested);
    if (!actual) throw new Error(`字体“${requested}”未包含在渲染任务的已加载资源中`);
    return actual;
  };
  const text = new Map<Id, PreparedText>(), sfx = new Map<Id, string>();
  const panels = new Map<Id, ShapePath>(), bubbles = new Map<Id, MangaBubbleGeometry>(), tails = new Map<Id, PreparedTail>(), decorations = new Map<Id, readonly ShapePath[]>(), images = new Map<Id, PreparedImage>();
  const dialogues=new Map<Id,PreparedDialogue>();
  const effectTexts=new Map<Id,PreparedEffectText>();
  const tailPaints=new Map<Id,TailPaint>();
  const measurement: { canvas?: HTMLCanvasElement; context?: CanvasRenderingContext2D } = {};
  const targetFor=(id:Id):GeometryTarget=>{const target=options.target??LOCAL_TARGET,m=multiply(target.localToOutput,worldMatrix(project,id));return{localToOutput:[m[0],m[1],m[2],m[3],0,0],tolerancePx:target.tolerancePx};};
  const visit = (id: Id, visible: boolean): void => {
    const source = project.layers[id];
    if (!source) throw new Error(`渲染图层 ${id} 不存在`);
    const layer = copy ? structuredClone(source) : source;
    if (copy) snapshot.layers[id] = layer;
    visible &&= layer.visible;
    if (layer.type === 'image') {
      const asset = project.assets[layer.assetId];
      if (!asset) throw new Error(`图片“${layer.name}”缺少资源记录`);
      if (copy) snapshot.assets[asset.id] = structuredClone(asset);
      if (visible) {
        const parent = layer.parentId ? project.layers[layer.parentId] : undefined;
        if (parent?.type === 'panel' && layer.crop) {
          const { scale, tx, ty } = resolveCrop(parent.geometry, { x: layer.width, y: layer.height }, layer.crop);
          images.set(id, { x: tx, y: ty, width: layer.width * scale, height: layer.height * scale, ...(layer.sourceRect ? {source: structuredClone(layer.sourceRect)} : {}) });
        } else images.set(id, { x: 0, y: 0, width: layer.width, height: layer.height, ...(layer.sourceRect ? {source: structuredClone(layer.sourceRect)} : {}) });
      }
    }
    if (visible && (layer.type === 'panel' || layer.type === 'bubble' || (layer.type === 'decoration' && layer.spec.kind !== 'sfx'))) {
      let geometry = !copy && !(layer.type === 'bubble' && project.schemaVersion >= 6) ? geometryCache.get(source) : undefined;
      if (!geometry) {
        if (layer.type === 'panel') geometry = buildRoundedPolygon(layer.geometry, layer.style.borderRadius);
        else if (layer.type === 'bubble') {
          const result = composeBubble(project,id,targetFor(id));
          if (!result.ok) throw new Error(`气泡“${layer.name}”无法编译：${result.problems.map((p) => p.message).join('；')}`);
          geometry = result.value;
        } else geometry = buildDecoration(layer.spec);
        if (!copy) geometryCache.set(source, geometry);
      }
      if (layer.type === 'panel') panels.set(id, geometry as ShapePath);
      else if (layer.type === 'bubble') bubbles.set(id, geometry as MangaBubbleGeometry);
      else decorations.set(id, geometry as readonly ShapePath[]);
    }
    if(visible&&layer.type==='bubbleTail'&&(layer.attachment.mode==='free'||options.roots?.includes(id))) { const result=prepareTailPaint(project,id,targetFor(id));if(!result.ok)throw Error(`尾巴“${layer.name}”无法编译：${result.problems.map(p=>p.message).join('；')}`);tails.set(id,result.value.geometry);tailPaints.set(id,result.value); }
    if (visible && layer.type === 'text') {
      const actual = family(layer.text.font.family), style = layer.text.font;
      const font = fontStyle(actual, style.size, style.bold, style.italic);
      const computeLayout = (): TextLayout => {
        if (layer.bubbleFrame?.placement === 'center') {
          measurement.canvas ??= document.createElement('canvas'); measurement.context ??= measurement.canvas.getContext('2d') ?? undefined;
          if (!measurement.context) throw new Error('无法创建对白测量画布'); applyCanvasTextPolicy(measurement.context); measurement.context.font = font;
          const frame=resolveBubbleTextFrame(project,id,measurement.context,actual);if(!frame.ok)throw Error(frame.problems.map(p=>p.message).join('；'));return frame.value.layout;
        }
        if (layer.text.direction === 'vertical') return layoutVertical(layer.text, layer.box, (glyph) => resolveVerticalGlyph(glyph, actual));
        measurement.canvas ??= document.createElement('canvas');
        measurement.context ??= measurement.canvas.getContext('2d') ?? undefined;
        if (!measurement.context) throw new Error('无法创建文字测量画布');
        applyCanvasTextPolicy(measurement.context);
        measurement.context.font = font; return layoutHorizontal(layer.text, layer.box, measurement.context,{wordWrap:layer.text.wrapMode==='word'});
      };
      const layout = options.fontGeneration === undefined ? computeLayout() : cachedLayout(id,
        JSON.stringify([layer.text, layer.box, layer.bubbleFrame, layer.bubbleFrame ? project.layers[layer.parentId!] : null, options.fontGeneration, font, [...fonts]]), computeLayout);
      const glyphFonts = new Map<string, string>();
      for (const run of layout.runs) for (const cell of run.cells) if (cell.fontFamily) {
        glyphFonts.set(cell.fontFamily, fontStyle(family(cell.fontFamily), style.size, style.bold, style.italic));
      }
      text.set(id, { font, layout, glyphFonts });
      if(layer.role==='sfx'&&layer.effects){
        const key=JSON.stringify([options.fontGeneration,font,[...glyphFonts]]),cached=!copy?effectCache.get(source):undefined;
        if(cached?.key===key)effectTexts.set(id,cached.value);
        else{measurement.canvas??=document.createElement('canvas');measurement.context??=measurement.canvas.getContext('2d')??undefined;if(!measurement.context)throw Error('无法测量声效');applyCanvasTextPolicy(measurement.context);const value=compileEffectText(layer,layout,font,glyphFonts,measurement.context);effectTexts.set(id,value);if(!copy)effectCache.set(source,{key,value});}
      }
    }
    if (visible && layer.type === 'decoration' && layer.spec.kind === 'sfx') {
      sfx.set(id, fontStyle(family(layer.spec.fontFamily), layer.spec.fontSize, true));
    }
    if ('children' in layer) for (const child of layer.children) visit(child, visible);
    if(visible&&layer.type==='group'&&layer.dialogue){const result=prepareDialogue(project,id,targetFor(id),bubbles);if(!result.ok)throw Error(`对白组“${layer.name}”无法编译：${result.problems.map(p=>p.message).join('；')}`);dialogues.set(id,result.value);}
  };
  try { for (const id of options.roots ?? page.roots) visit(id, true); }
  finally { if (measurement.canvas) { measurement.canvas.width = 0; measurement.canvas.height = 0; } }
  return { project: snapshot, pageId, text: { text, sfx, panels, bubbles, tails, dialogues, effectTexts, tailPaints, decorations, images, paintOps: buildPaintOps(copy ? snapshot : project, pageId, panels, options.roots ? [...options.roots] : undefined) } };
}
