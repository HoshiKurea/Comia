import { fail, ok, problem, type ComponentPreset, type Id, type Layer, type LegacyUserTemplate, type PresetNode, type Project, type Result, type ScenePresetRecipe } from '../domain/types';
import { createLayer, createProject } from '../domain/factories';
import { newId } from '../domain/id';
import { validateProject } from '../domain/validate';
import { validLibraryName } from '../assets/folderModel';
import {parseBubbleBrushOptions} from '../bubbles/brushOptions';
import { validBrushOptions } from './speedBrushGeometry';
import { componentSceneDraft, instantiatePanelTree } from '../panels/instantiate';
import { layerWorldBounds } from '../interaction/layerBounds';
import { unionBounds } from '../geometry/bounds';
import { completeExtensionProject } from '../domain/extensionDefaults';

export const PRESET_LIMITS = { count: 256, nodes: 512 } as const;
export function sceneProject(recipe: ScenePresetRecipe, pageId = newId()): Project {
  const p = createProject({ background: false });
  const page = p.pages[p.pageOrder[0]]; p.pageOrder = [pageId]; p.pages = { [pageId]: { ...page, id: pageId, width: 16384, height: 16384, roots: [...recipe.roots] } };
  let number = 1;
  for (const [id, raw] of Object.entries(recipe.nodes)) {
    const layer = { ...structuredClone(raw), id, pageId, locked: false } as Layer;
    if (layer.type === 'panel' && layer.role === 'leaf') layer.editorNumber = number++;
    p.layers[id] = layer;
  }
  p.nextPanelNumber = number; completeExtensionProject(p); return p;
}
export function sceneBounds(recipe: ScenePresetRecipe) {
  const p = sceneProject(recipe);
  return unionBounds(recipe.roots.map(id => layerWorldBounds(p, id)).filter((b): b is NonNullable<typeof b> => !!b));
}
export function validateComponentPreset(value: unknown): Result<ComponentPreset> {
  const bad = (message: string) => fail(problem('preset/invalid', message));
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('组件预设格式无效');
  const preset = value as ComponentPreset;
  if (!validLibraryName(preset.name) || !preset.recipe || typeof preset.recipe !== 'object') return bad('预设名称或配方无效');
  if (preset.recipe.kind === 'speed-brush') {
    const o=preset.recipe.options;return validBrushOptions(o) ? ok({id:preset.id,name:preset.name,recipe:{kind:'speed-brush',options:{radius:o.radius,density:o.density,strokeWidth:o.strokeWidth,irregularity:o.irregularity,color:o.color}}}) : bad('速度线笔刷参数超出有效范围');
  }
  if(preset.recipe.kind==='bubble-brush'){const parsed=parseBubbleBrushOptions(preset.recipe.options);return parsed.ok?ok({id:preset.id,name:preset.name,recipe:{kind:'bubble-brush',options:parsed.value}}):parsed;}
  if (preset.recipe.kind !== 'scene') return bad('不支持的组件预设类型');
  const r = preset.recipe;
  if (!Array.isArray(r.roots) || !r.roots.length || !r.nodes || typeof r.nodes !== 'object' || Array.isArray(r.nodes) || Object.keys(r.nodes).length > PRESET_LIMITS.nodes) return bad('场景预设需要1～512个完整节点');
  for (const [id, node] of Object.entries(r.nodes)) {
    if (!node || typeof node !== 'object' || node.id !== id || ['image', 'pageBackground'].includes(node.type) || 'pageId' in node || 'editorNumber' in node || 'locked' in node) return bad('预设节点不能保存原页面、素材、锁定状态或分镜序号');
  }
  const checked = validateProject(sceneProject(r)); if (!checked.ok) return checked;
  const bounds = sceneBounds(r);
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return bad('预设没有可用的可见外观范围');
  const cleaned=recipeFromLayers(r.roots,Object.values(checked.value.layers));
  return ok({ id: preset.id, name: preset.name, recipe: {...cleaned,bounds} });
}
export function recipeFromLayers(roots: readonly Id[], layers: readonly Layer[]): ScenePresetRecipe {
  const nodes: Record<Id, PresetNode> = {};
  for (const item of layers) {
    if (item.type === 'image' || item.type === 'pageBackground') continue;
    const { pageId: _page, locked: _locked, ...data } = structuredClone(item);
    if (data.type === 'panel') delete data.editorNumber;
    nodes[item.id] = data as PresetNode;
  }
  const recipe: ScenePresetRecipe = { kind: 'scene', roots: [...roots], nodes, bounds: { x: 0, y: 0, width: 1, height: 1 } };
  recipe.bounds = sceneBounds(recipe) ?? recipe.bounds; return recipe;
}
export function convertLegacyTemplate(template: LegacyUserTemplate): Result<ComponentPreset> {
  const draft = instantiatePanelTree(template.root, newId(), true), scene = componentSceneDraft(draft.layer, draft.descendants);
  if (!scene.ok) return scene;
  return validateComponentPreset({ id: template.id, name: template.name, recipe: recipeFromLayers(scene.value.roots, scene.value.layers) });
}
export function instantiateScene(recipe: ScenePresetRecipe, pageId: Id) {
  const mapping = new Map(Object.keys(recipe.nodes).map(id => [id, newId()]));
  const layers: Layer[] = Object.values(recipe.nodes).map(node => {
    const layer = { ...structuredClone(node), id: mapping.get(node.id)!, pageId, locked: false, parentId: node.parentId ? mapping.get(node.parentId)! : null } as Layer;
    if ('children' in layer) layer.children = layer.children.map(id => mapping.get(id)!);
    if (layer.type === 'group' && layer.dialogue) layer.dialogue.links = layer.dialogue.links.map(link => ({ ...link, from: mapping.get(link.from)!, to: mapping.get(link.to)! }));
    return layer;
  });
  return { layers, roots: recipe.roots.map(id => mapping.get(id)!) };
}
export function presetObjectDraft(preset: ComponentPreset, pageId: Id) {
  if (preset.recipe.kind !== 'scene') return fail(problem('preset/brush', '这是笔刷参数预设，请单击启用笔刷'));
  const scene = instantiateScene(preset.recipe, pageId), wrapper = createLayer('group', pageId, '组件预设');
  if (wrapper.type !== 'group') throw Error('group factory');
  wrapper.children = scene.roots;
  for (const item of scene.layers) if (scene.roots.includes(item.id)) item.parentId = wrapper.id;
  const defaultNamedPanelIds = scene.layers.filter(l => l.type === 'panel' && l.role === 'leaf' && (l.nameMode === 'automatic' || !l.nameMode && /^分镜\s+\d+$/.test(l.name))).map(l => l.id);
  return ok({ layer: wrapper, descendants: scene.layers, independentRoots: true, defaultNamedPanelIds });
}
