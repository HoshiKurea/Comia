import type { ComponentPreset, Id, Layer, Project, Result, ScenePresetRecipe } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { newId } from '../domain/id';
import { execute } from '../history/commandBus';
import { getProject } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { multiply, translation, worldMatrix } from '../geometry/matrix';
import { componentSceneDraft } from '../panels/instantiate';
import { libraryNameKey, normalizedLibraryName, validLibraryName } from '../assets/folderModel';
import { convertLegacyTemplate, instantiateScene, presetObjectDraft, recipeFromLayers, sceneBounds, validateComponentPreset } from './presetModel';
import { detachTailDraft } from '../bubbles/tailCommands';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import {freezeBubbleText} from '../text/freezeBubbleText';
import { migrateProject } from '../storage/migrateProject';
import type { ObjectDraft } from '../app/actions';

export interface PresetCapture { recipe: ScenePresetRecipe; excludedImages: number }
export function describePresetCapture(project: Project, ids: readonly Id[]): Result<PresetCapture> {
  const selected = new Set(ids), snapshot = structuredClone(project), first = project.layers[ids[0]];
  if (!first || !ids.length || ids.some(id => !project.layers[id] || project.layers[id].pageId !== first.pageId)) return fail(problem('preset/selection', '请选择同页组件保存为预设'));
  const rootIds = ids.filter(id => { for (let p = project.layers[id].parentId; p; p = project.layers[p].parentId) if (selected.has(p)) return false; return true; });
  if (rootIds.some(id => !effectiveLayerFlags(project, id).visible)) return fail(problem('preset/hidden', '请先显示需要保存的组件'));
  const order = new Map<Id, number>();
  const scan = (id: Id) => { const l = project.layers[id]; order.set(id, order.size); if ('children' in l) l.children.forEach(scan); };
  project.pages[first.pageId].roots.forEach(scan); rootIds.sort((a, b) => order.get(a)! - order.get(b)!);
  let excludedImages = 0; const roots: Id[] = [], captured: Layer[] = [];
  for (const id of rootIds) {
    const original = snapshot.layers[id];
    if (original.type === 'bubbleTail' && original.attachment.mode === 'bubble') { const detached = detachTailDraft(snapshot, id, true); if (!detached.ok) return detached; }
    const visited: Layer[] = [];
    const copy = (cid: Id) => {
      const source = snapshot.layers[cid];
      if (source.type === 'image') { excludedImages++; return; }
      if (source.type === 'pageBackground') return;
      const layer = structuredClone(source); visited.push(layer);
      if ('children' in layer && 'children' in source) { layer.children = layer.children.filter(child => snapshot.layers[child].type !== 'image' && snapshot.layers[child].type !== 'pageBackground'); source.children.forEach(copy); }
    };
    copy(id); if (!visited.length) continue;
    const root = visited[0]; root.matrix = worldMatrix(snapshot, id); root.parentId = null;
    if (root.type === 'text') {const frozen=freezeBubbleText(snapshot,id);root.box=frozen.box;root.text=frozen.text;delete root.bubbleFrame;}
    const scene = componentSceneDraft(root, visited.slice(1)); if (!scene.ok) return scene;
    roots.push(...scene.value.roots); captured.push(...scene.value.layers);
  }
  if (!captured.length) return fail(problem('preset/empty', '图片请放入素材库；请选择分镜、气泡、文字或装饰组件'));
  let recipe = recipeFromLayers(roots, captured); const bounds = sceneBounds(recipe);
  if (!bounds) return fail(problem('preset/bounds', '选区没有可保存的可见组件'));
  for (const id of roots) recipe.nodes[id].matrix = multiply(translation(-bounds.x, -bounds.y), recipe.nodes[id].matrix);
  const fresh = instantiateScene(recipe, first.pageId); recipe = recipeFromLayers(fresh.roots, fresh.layers);
  return ok({ recipe, excludedImages });
}
export function saveComponentRecipe(name: string, recipe: ComponentPreset['recipe'], replaceId?: Id): Result<Id> {
  const project = getProject(), value = normalizedLibraryName(name);
  if (!validLibraryName(value)) return fail(problem('preset/name', '预设名称须为1～80个字符'));
  if (Object.values(project.templates).some(t => t.id !== replaceId && libraryNameKey(t.name) === libraryNameKey(value))) return fail(problem('preset/name', '已有同名预设，请使用其他名称'));
  if (replaceId && !project.templates[replaceId]) return fail(problem('preset/missing', '预设已不存在'));
  const id = replaceId ?? newId(), checked = validateComponentPreset({ id, name: value, recipe }); if (!checked.ok) return checked;
  const result = execute({ label: replaceId ? '更新组件预设' : '保存组件预设', context: { pageId: sessionStore.getState().activePageId, selection: sessionStore.getState().selection }, mutate(draft) {
    if (draft.schemaVersion < 9) { const next = migrateProject(draft); if (!next.ok) throw Error(next.problems[0].message); Object.assign(draft, next.value); }
    draft.templates[id] = checked.value;
  } }); return result.ok ? ok(id) : result;
}
export function captureComponentPreset(ids: readonly Id[], name: string): Result<Id> {
  const result = describePresetCapture(getProject(), ids); return result.ok ? saveComponentRecipe(name, result.value.recipe) : result;
}
export function capturePanelTemplate(panelId: Id, name: string): Result<Id> {
  if (getProject().layers[panelId]?.type !== 'panel') return fail(problem('template/panel', '请选择分镜保存为组件'));
  return captureComponentPreset([panelId], name);
}
export function renameUserTemplate(id: Id, name: string): Result<Id> {
  const t = getProject().templates[id]; if (!t) return fail(problem('preset/missing', '预设已不存在'));
  const p = 'recipe' in t ? ok(t) : convertLegacyTemplate(t); return p.ok ? saveComponentRecipe(name, p.value.recipe, id) : p;
}
export function deleteUserTemplate(id: Id): Result<void> {
  if (!getProject().templates[id]) return fail(problem('template/missing', '组件已不存在'));
  const result = execute({ label: '删除自定义组件', context: { pageId: sessionStore.getState().activePageId, selection: sessionStore.getState().selection }, mutate(draft) { delete draft.templates[id]; } }); return result.ok ? ok(undefined) : result;
}
export function instantiateTemplate(id: Id, pageId: Id, _preview = false): Result<ObjectDraft> {
  const t = getProject().templates[id]; if (!t) return fail(problem('template/missing', '未知或已删除的组件'));
  const preset = 'recipe' in t ? ok(t) : convertLegacyTemplate(t); return preset.ok ? presetObjectDraft(preset.value, pageId) : preset;
}
