import {freezeBubbleText} from '../text/freezeBubbleText';
import {migrateProject} from '../storage/migrateProject';
import type { AssetMeta, Id, Layer, Point, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { newId } from '../domain/id';
import { multiply, scaling, translation, worldMatrix } from '../geometry/matrix';
import { resolveCrop } from '../images/crop';
import { execute } from '../history/commandBus';
import { getProject } from '../state/documentStore';
import { runtimeStore } from '../state/runtimeStore';
import { sessionStore } from '../state/sessionStore';
import { retainResources } from '../storage/blobRepository';
import { detachTailDraft } from '../bubbles/tailCommands';

export interface ClipboardTree { version: 1; roots: Id[]; layers: Record<Id, Layer>; assets: AssetMeta[] }

let clipboard: ClipboardTree | null = null;
let clipboardBlobs = new Map<string, Blob>();
let clipboardImages = new Map<string, ImageBitmap | HTMLImageElement>();
let pasteCount = 0;
let releaseClipboard: (() => void) | null = null;
const listeners = new Set<() => void>();
export function subscribeClipboard(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }

function minimalRoots(project: Project, ids: Id[]): Id[] {
  const selected = new Set(ids);
  return ids.filter((id) => {
    for (let parent = project.layers[id]?.parentId; parent; parent = project.layers[parent]?.parentId ?? null) if (selected.has(parent)) return false;
    return true;
  });
}

export function copyLayers(ids: Id[]): Result<ClipboardTree> {
  const project = getProject();
  if (!ids.length) return fail(problem('clipboard/empty', '没有选中图层'));
  if (ids.some((id) => !project.layers[id])) return fail(problem('clipboard/missing', '选区包含不存在的图层'));
  if (ids.some(id => project.layers[id].type === 'pageBackground')) return fail(problem('background/copy', '页面背景请使用背景模板替换；本次选区没有复制或剪切'));
  const pageId = project.layers[ids[0]].pageId;
  if (ids.some((id) => project.layers[id].pageId !== pageId)) return fail(problem('clipboard/cross-page', '只能复制同一页面的图层'));
  const rootSet = new Set(minimalRoots(project, [...new Set(ids)]));
  const roots: Id[] = [];
  const output: Record<Id, Layer> = {};
  const visit = (id: Id) => {
    const layer = structuredClone(project.layers[id]);
    output[id] = layer;
    if ('children' in layer) for (const child of layer.children) visit(child);
  };
  const walkOrder = (id: Id) => {
    if (rootSet.has(id)) { roots.push(id); visit(id); return; }
    const layer = project.layers[id];
    if (layer && 'children' in layer) for (const child of layer.children) walkOrder(child);
  };
  for (const id of project.pages[pageId].roots) walkOrder(id);
  for (const id of roots) {
    let layer = output[id];if(layer.type==='text'&&layer.bubbleFrame){layer=freezeBubbleText(project,id);output[id]=layer;}
    if(layer.type==='bubbleTail'&&layer.attachment.mode==='bubble'){
      const snapshot=structuredClone(project),result=detachTailDraft(snapshot,id,true);if(!result.ok)return result;
      output[id]=structuredClone(snapshot.layers[id]);
      output[id].matrix=worldMatrix(project,id);output[id].parentId=null;continue;
    }
    const parent = layer.parentId ? project.layers[layer.parentId] : null;
    if (layer.type === 'image' && parent?.type === 'panel' && layer.crop) {
      const mapping = resolveCrop(parent.geometry, { x: layer.width, y: layer.height }, layer.crop);
      layer.matrix = multiply(worldMatrix(project, parent.id), multiply(translation(mapping.tx, mapping.ty), scaling(mapping.scale, mapping.scale)));
      layer.crop = null;
    } else layer.matrix = worldMatrix(project, id);
    layer.parentId = null;
  }
  const assetIds = new Set(Object.values(output).filter((layer) => layer.type === 'image').map((layer) => layer.assetId));
  return ok({ version: 1, roots, layers: output, assets: [...assetIds].map((id) => project.assets[id]).filter(Boolean).map((asset) => structuredClone(asset)) });
}

export function copyToClipboard(ids: Id[]): Result<void> {
  const result = copyLayers(ids);
  if (!result.ok) return result;
  const runtime = runtimeStore.getState();
  const nextBlobs = new Map<string, Blob>();
  const nextImages = new Map<string, ImageBitmap | HTMLImageElement>();
  for (const asset of result.value.assets) {
    for (const hash of [asset.originalHash, asset.renderHash]) {
      const blob = runtime.blobs.get(hash);
      if (!blob) return fail(problem('clipboard/blob-missing', `素材 ${asset.name} 的数据缺失`));
      nextBlobs.set(hash, blob);
    }
    const image = runtime.images.get(asset.renderHash);
    if (!image) return fail(problem('clipboard/image-missing', `素材 ${asset.name} 尚未解码`));
    nextImages.set(asset.renderHash, image);
  }
  clipboardBlobs = nextBlobs;
  clipboardImages = nextImages;
  clipboard = result.value;
  const previous = releaseClipboard;
  releaseClipboard = retainResources({ ...getProject(), libraryAssetIds: [], layers: result.value.layers, assets: Object.fromEntries(result.value.assets.map((asset) => [asset.id, asset])) }, nextBlobs, nextImages);
  previous?.();
  pasteCount = 0;
  for (const listener of listeners) listener();
  return ok(undefined);
}

export function hasClipboard(): boolean { return clipboard !== null; }
export function clearClipboard(): void {
  clipboard = null; clipboardBlobs = new Map(); clipboardImages = new Map(); pasteCount = 0;
  const release = releaseClipboard; releaseClipboard = null; release?.(); for (const listener of listeners) listener();
}

export function pasteLayers(data: ClipboardTree, pageId: Id, offset: Point): Result<Id[]> {
  const project = getProject();
  if (data.version !== 1 || !Array.isArray(data.roots) || !project.pages[pageId]) return fail(problem('clipboard/invalid', '剪贴板内容或目标页面无效'));
  const ids = Object.keys(data.layers);
  if (ids.length === 0 || data.roots.some((id) => !data.layers[id])) return fail(problem('clipboard/invalid', '剪贴板图层树不完整'));
  const idMap = new Map(ids.map((id) => [id, newId()]));
  const assetMap = new Map<Id, Id>();
  const additions: AssetMeta[] = [];
  for (const asset of data.assets) {
    const existing = Object.values(project.assets).find((meta) => meta.originalHash === asset.originalHash && meta.renderHash === asset.renderHash);
    const targetId = existing?.id ?? newId();
    assetMap.set(asset.id, targetId);
    if (!existing) additions.push({ ...structuredClone(asset), id: targetId });
  }
  const layers: Record<Id, Layer> = {};
  for (const [oldId, original] of Object.entries(data.layers)) {
    const layer = structuredClone(original);
    layer.id = idMap.get(oldId)!;
    layer.pageId = pageId;
    layer.parentId = layer.parentId ? idMap.get(layer.parentId) ?? null : null;
    if ('children' in layer) layer.children = layer.children.map((id) => idMap.get(id)!).filter(Boolean);
    if(layer.type==='group'&&layer.dialogue){
      if(layer.dialogue.links.some(edge=>!idMap.has(edge.from)||!idMap.has(edge.to)))return fail(problem('clipboard/dialogue-reference','剪贴板对白关系引用不完整'));
      layer.dialogue.links=layer.dialogue.links.map(edge=>({...edge,from:idMap.get(edge.from)!,to:idMap.get(edge.to)!}));
    }
    if (layer.type === 'image') {
      const mapped = assetMap.get(layer.assetId);
      if (!mapped) return fail(problem('clipboard/asset', '剪贴板素材缺失'));
      layer.assetId = mapped;
    }
    if (data.roots.includes(oldId)) layer.matrix = multiply(translation(offset.x, offset.y), layer.matrix);
    layers[layer.id] = layer;
  }
  const roots = data.roots.map((id) => idMap.get(id)!);
  const result = execute({ label: '粘贴图层', context: { pageId, selection: sessionStore.getState().selection }, afterSelection: roots, mutate(draft) {
    const needs9=Object.values(layers).some(l=>l.type==='text'&&(l.bubbleFrame||l.text.wrapMode)||l.type==='image'&&l.sourceRect||l.type==='bubble'&&(l.edgeStyle?.wobble||l.style.innerStroke?.enabled||l.style.outerStroke?.enabled));
    if(needs9&&draft.schemaVersion<9){const next=migrateProject(draft);if(!next.ok)throw Error(next.problems[0].message);Object.assign(draft,next.value);}
    for (const asset of additions) draft.assets[asset.id] = asset;
    Object.assign(draft.layers, layers);
    draft.pages[pageId].roots.push(...roots);
  } });
  return result.ok ? ok(roots) : result;
}

export function pasteFromClipboard(pageId: Id): Result<Id[]> {
  if (!clipboard) return fail(problem('clipboard/empty', '剪贴板为空'));
  for (const asset of clipboard.assets) {
    if (!clipboardBlobs.has(asset.originalHash) || !clipboardBlobs.has(asset.renderHash) || !clipboardImages.has(asset.renderHash)) return fail(problem('clipboard/blob-missing', '剪贴板图片素材已失效'));
  }
  const result = pasteLayers(clipboard, pageId, { x: 16 * (pasteCount + 1), y: 16 * (pasteCount + 1) });
  if (!result.ok) return result;
  pasteCount++;
  const runtime = runtimeStore.getState();
  for (const [hash, blob] of clipboardBlobs) if (!runtime.blobs.has(hash)) runtime.blobs.set(hash, blob);
  for (const [hash, image] of clipboardImages) if (!runtime.images.has(hash)) runtime.images.set(hash, image);
  runtimeStore.setState({ blobs: new Map(runtime.blobs), images: new Map(runtime.images) });
  return result;
}
