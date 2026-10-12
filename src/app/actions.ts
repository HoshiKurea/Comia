import { makePanelPreset, makeLayoutPreset, type PanelPresetKind, type LayoutPresetKind } from '../panels/presets';
import { instantiatePanelTree, independentPanelDraft, firstReadingPanel, componentSceneDraft } from '../panels/instantiate';
import type { BubbleLayer, BubbleTailLayer, Id, Layer, Point, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { createLayer } from '../domain/factories';
import { execute, undo, redo } from '../history/commandBus';
import { sessionStore } from '../state/sessionStore';
import { getProject } from '../state/documentStore';
import { translation } from '../geometry/matrix';
import { commitCut } from '../panels/cutPanel';
import { hasLockedDescendant } from '../layers/group';
import { buildBubble } from '../bubbles/geometry';
import { instantiateTemplate } from '../library/templates';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { preflightDialogueRemoval } from '../bubbles/ownership';
import { handDrawnPreset } from '../bubbles/handDrawn';
import { SFX_PRESETS } from '../text/sfxPresets';
import { promoteMangaDraft } from '../bubbles/mangaDraft';

export { undo, redo };

export type CreateKind = PanelPresetKind | `layout:${LayoutPresetKind}` | 'bubble' | 'bubble-rect' | 'bubble-circle' | 'bubble-cloud' | 'bubble-spiky' | 'bubble-soft' | 'bubble-rough' | 'bubble-hand-polygon' | 'bubble-wave' | `tail:${BubbleTailLayer['appearance']}` | `sfx:${string}` | 'text' | 'speed' | 'focus' | 'sfx' | `template:${string}`;

export interface ObjectDraft { layer: Layer; descendants: Layer[]; defaultNamedPanelIds?: readonly Id[]; independentRoots?: boolean }

export function createObjectDraft(kind: CreateKind, pageId: Id, preview = false): Result<ObjectDraft> {
  if(kind.startsWith('tail:')){const tail=createLayer('bubbleTail',pageId,preview?'预览尾巴':undefined) as BubbleTailLayer;tail.appearance=kind.slice(5) as BubbleTailLayer['appearance'];if(tail.appearance==='curved'){tail.tip={x:12,y:140};tail.route={kind:'spline',c1:{x:12,y:40},c2:{x:60,y:90}};}return ok({layer:tail,descendants:[]});}
  if(kind.startsWith('sfx:')){const preset=SFX_PRESETS.find(p=>p.id===kind.slice(4));if(!preset)return fail(problem('sfx/preset','声效模板不存在'));const result=createObjectDraft('sfx',pageId,preview);if(!result.ok)return result;const layer=result.value.layer;if(layer.type==='text'){layer.effects=structuredClone(preset.effects);layer.text.content=preset.sample;}return result;}
  if (kind.startsWith('template:')) return instantiateTemplate(kind.slice('template:'.length), pageId, preview);
  if (kind.startsWith('layout:')) { const node = makeLayoutPreset(kind.slice(7) as LayoutPresetKind, { x: 0, y: 0, width: 600, height: 800 }); return node.ok ? ok(instantiatePanelTree(node.value, pageId, preview)) : node; }
  if (!kind.startsWith('bubble') && !['text', 'speed', 'focus', 'sfx'].includes(kind)) { const node = makePanelPreset(kind as PanelPresetKind); return node.ok ? ok(instantiatePanelTree(node.value, pageId, preview)) : node; }
  const layer = createLayer(kind.startsWith('bubble') ? 'bubble' : kind === 'text' || kind === 'sfx' ? 'text' : ['speed', 'focus'].includes(kind) ? 'decoration' : 'panel', pageId, preview ? '预览' : undefined);
  if(kind==='sfx'&&layer.type==='text'){
    layer.role='sfx';layer.box={x:0,y:0,width:400,height:240};layer.text={...layer.text,content:'砰！',font:{...layer.text.font,size:96,bold:true},lineHeight:1};
    layer.effects={outlineColor:'#FFFFFFFF',outlineWidth:3,shearDeg:0,deformation:'none',amount:0,cycles:1,recipe:'layout'};
  }
  let text: Layer | null = null;
  if (layer.type === 'panel') {
    if (kind === 'trapezoid') layer.geometry = [{ x: 80, y: 0 }, { x: 520, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }];
    if (kind === 'parallelogram') layer.geometry = [{ x: 80, y: 0 }, { x: 600, y: 0 }, { x: 520, y: 400 }, { x: 0, y: 400 }];
  }
  if (layer.type === 'bubble') {
    layer.shape = kind === 'bubble-rect' ? 'rect' : kind === 'bubble-circle' ? 'circle' : kind === 'bubble-cloud' ? 'cloud' : kind === 'bubble-spiky' ? 'spiky' : 'roundRect';
    if (layer.shape === 'circle') { layer.width = 240; layer.height = 240; }
    if(kind==='bubble-soft') {layer.shape='handOval';layer.handDrawn=handDrawnPreset('soft');}
    if(kind==='bubble-rough') {layer.shape='handPolygon';layer.handDrawn=handDrawnPreset('rough');}
    if(kind==='bubble-hand-polygon') {layer.shape='handPolygon';layer.handDrawn=handDrawnPreset('soft');}
    if(kind==='bubble-wave') {layer.shape='wave';layer.handDrawn=handDrawnPreset('soft');}
    text = createLayer('text', pageId, preview ? '预览对白' : undefined);
    text.parentId = layer.id;
    if (text.type === 'text') {
      text.text.content = '';
      text.text.font.size = 28;
      text.text.align = 'center';
      const geometry = buildBubble(layer.shape, layer.width, layer.height, layer.style, null,layer);
      if (!geometry.ok) return fail(...geometry.problems);
      text.box = geometry.value.textBox;
    }
    (layer as BubbleLayer).children.push(text.id);
  }
  if (layer.type === 'decoration') {
    // Built-in components use the same initial pattern as their library thumbnail.
    // The seed remains in the document for deterministic edits, undo and export.
    if (kind === 'focus') layer.spec = { kind: 'focus', width: 400, height: 400, count: 48, innerRatio: 0.25, seed: 42, strokeWidth: 2, color: '#000000FF' };
    if (layer.spec.kind === 'speed') layer.spec.seed = 42;
  }
  return ok({ layer, descendants: text ? [text] : [], ...(layer.type === 'panel' ? { defaultNamedPanelIds: [layer.id] } : {}) });
}

export function placeObjectDraft(object: ObjectDraft, pageId: Id, origin: Point, parentId: Id | null = null): Result<Id> {
  const { layer, descendants } = object;
  const project = getProject();
  if (!project.pages[pageId] || layer.pageId !== pageId) return fail(problem('creation/page', '目标页面已变化，放置已取消'));
  if (parentId) {
    const parent = project.layers[parentId], flags = effectiveLayerFlags(project, parentId);
    if (parent?.type !== 'group' || parent.dialogue && layer.type!=='bubble' || parent.pageId !== pageId || flags.locked || !flags.visible) return fail(problem('creation/parent', '目标编组不存在、已锁定或隐藏，或不接受此组件'));
  }
  layer.parentId = parentId;
  layer.matrix = translation(origin.x, origin.y);
  if (object.independentRoots) {
    const scene = componentSceneDraft(layer, descendants, true); if (!scene.ok) return scene;
    const result = execute({ label: '放置组件预设', defaultNamedPanelIds: object.defaultNamedPanelIds, context: { pageId, selection: sessionStore.getState().selection }, afterSelection: scene.value.roots, mutate(draft) {
      for (const item of scene.value.layers) draft.layers[item.id] = item;
      const parent = parentId ? draft.layers[parentId] : null;
      (parent?.type === 'group' ? parent.children : draft.pages[pageId].roots).push(...scene.value.roots);
    } }); return result.ok ? ok(scene.value.roots[0]) : result;
  }
  if (layer.type === 'panel' && layer.role === 'split') {
    const independent = independentPanelDraft(layer, descendants, parentId); if (!independent.ok) return independent;
    const { panels, contents } = independent.value;
    const first = firstReadingPanel(project, panels); if (!first.ok) return first;
    const result = execute({ label: '创建独立分格版式', defaultNamedPanelIds: object.defaultNamedPanelIds, context: { pageId, selection: sessionStore.getState().selection }, afterSelection: [first.value], mutate(draft) {
      for (const item of [...panels, ...contents]) draft.layers[item.id] = item;
      const parent = parentId ? draft.layers[parentId] : null;
      (parent?.type === 'group' ? parent.children : draft.pages[pageId].roots).push(...panels.map(panel => panel.id));
    } });
    return result.ok ? ok(first.value) : result;
  }
  const requiresManga=layer.type==='bubbleTail'||layer.type==='text'&&layer.role==='sfx'||layer.type==='bubble'&&(!!layer.handDrawn||!!layer.contour||['handOval','handPolygon','wave'].includes(layer.shape));
  if (project.schemaVersion < 6&&!requiresManga) for (const item of [layer, ...descendants]) {
    if (item.type === 'bubble') { item.tail = null; delete item.handDrawn; delete item.contour; }
  }
  const result = execute({
    label: layer.type === 'panel' && object.defaultNamedPanelIds?.includes(layer.id) ? '创建分镜' : `创建${layer.name}`,
    defaultNamedPanelIds: object.defaultNamedPanelIds,
    context: { pageId, selection: sessionStore.getState().selection },
    afterSelection: [layer.id],
    mutate(draft) {
      if(requiresManga)promoteMangaDraft(draft);
      draft.layers[layer.id] = layer;
      for (const child of descendants) draft.layers[child.id] = child;
      const parent = parentId ? draft.layers[parentId] : null;
      if (parent?.type === 'group') parent.children.push(layer.id);
      else draft.pages[pageId].roots.push(layer.id);
    },
  });
  return result.ok ? ok(layer.id) : result;
}

export function addObject(kind: CreateKind, pageId: Id, origin: Point): Result<Id> {
  const draft = createObjectDraft(kind, pageId);
  return draft.ok ? placeObjectDraft(draft.value, pageId, origin) : draft;
}

export function changeLayer(id: Id, label: string, mutate: (layer: Layer, draft: Project) => void): Result<void> {
  const project = getProject();
  const layer = project.layers[id];
  if (!layer) return fail(problem('layer/missing', '目标图层不存在'));
  const locked = hasLockedDescendant(project, id);
  if (locked) return fail(problem('layer/locked', `锁定图层“${locked}”阻止编辑`));
  const result = execute({
    label,
    context: { pageId: layer.pageId, selection: sessionStore.getState().selection },
    mutate(draft) { mutate(draft.layers[id], draft); },
  });
  return result.ok ? ok(undefined) : result;
}

export function deleteSelected(): Result<void> {
  const project = getProject();
  const pageId = sessionStore.getState().activePageId;
  const selected = sessionStore.getState().selection;
  if (!selected.length) return fail(problem('selection/empty', '没有选中对象'));
  for (const id of selected) {
    if (!project.layers[id]) return fail(problem('layer/missing', '选区包含缺失图层'));
    if(effectiveLayerFlags(project,id).locked)return fail(problem('layer/locked','自身或祖先锁定的图层不能删除'));
    const locked = hasLockedDescendant(project, id);
    if (locked) return fail(problem('layer/locked', `锁定图层“${locked}”阻止删除`));
  }
  const relationCheck=preflightDialogueRemoval(project,selected);if(!relationCheck.ok)return relationCheck;
  const result = execute({
    label: '删除图层',
    context: { pageId, selection: selected },
    afterSelection: [],
    mutate(draft) {
      const remove = (id: Id) => {
        const layer = draft.layers[id];
        if (!layer) return;
        if ('children' in layer) for (const child of layer.children) remove(child);
        const owner = layer.parentId ? draft.layers[layer.parentId] : draft.pages[layer.pageId];
        if (owner && 'children' in owner) owner.children = owner.children.filter((c) => c !== id);
        else if (owner && 'roots' in owner) owner.roots = owner.roots.filter((c) => c !== id);
        delete draft.layers[id];
      };
      for (const id of selected) remove(id);
    },
  });
  return result.ok ? ok(undefined) : result;
}

export function createPanelCut(panelId: Id, axis: 'horizontal' | 'vertical'): Result<void> {
  const result = commitCut(panelId, { axis, ratio: .5, gap: 16 });
  return result.ok ? ok(undefined) : result;
}
