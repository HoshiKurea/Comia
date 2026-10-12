import { assetReferences } from '../assets/references';
import type { Id, Project } from '../domain/types';
import { documentStore, getDocument } from '../state/documentStore';
import { runtimeStore } from '../state/runtimeStore';

type Images = Map<string, ImageBitmap | HTMLImageElement | CanvasImageSource>;
interface Owner { hashes: Set<string>; images: Images; blobs: Map<string, Blob> }
const owners = new Set<Owner>();
const retired = new Set<CanvasImageSource>();
let persistentReferences: (() => Promise<Set<string>>) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
export function projectResourceHashes(project: Project): Set<string> {
  const result = new Set<string>();
  for (const id of assetReferences(project)) { const asset = project.assets[id]; if (asset) { result.add(asset.originalHash); result.add(asset.renderHash); } }
  return result;
}
export function registerRecoveryReferences(provider: () => Promise<Set<string>>): void { persistentReferences = provider; }
function protectedBitmap(bitmap: CanvasImageSource): boolean { return [...owners].some((owner) => [...owner.images.values()].includes(bitmap)); }
function close(bitmap: CanvasImageSource): void { if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close(); }
/** Retains source identities as well as hashes, so replacing a project cannot close clipboard/snapshot sources. */
export function retainResources(project: Project, blobs: Map<string, Blob> = runtimeStore.getState().blobs, images: Images = runtimeStore.getState().images): () => void {
  const hashes = projectResourceHashes(project), owner: Owner = { hashes, blobs: new Map([...blobs].filter(([hash]) => hashes.has(hash))), images: new Map([...images].filter(([hash]) => hashes.has(hash))) }; owners.add(owner);
  return () => {
    if (!owners.delete(owner)) return;
    const live = new Set<CanvasImageSource>(runtimeStore.getState().images.values());
    for (const image of new Set(owner.images.values())) if (retired.has(image)) { if (live.has(image)) retired.delete(image); else if (!protectedBitmap(image)) { retired.delete(image); close(image); } }
    scheduleBlobCollection();
  };
}
/** Inactive workspaces own all their runtime resources, including undo-only images. */
export function retainWorkspaceResources(blobs: Map<string, Blob>, images: Images): () => void {
  const owner: Owner = { hashes: new Set([...blobs.keys(), ...images.keys()]), blobs, images };
  owners.add(owner);
  return () => {
    if (!owners.delete(owner)) return;
    const live = new Set<CanvasImageSource>(runtimeStore.getState().images.values());
    for (const bitmap of new Set(images.values())) if (retired.has(bitmap)) {
      // Resumed resources are live again; retaining their retirement marker would
      // keep closed bitmap wrappers reachable after a later ordinary collection.
      if (live.has(bitmap)) retired.delete(bitmap);
      else if (!protectedBitmap(bitmap)) { retired.delete(bitmap); close(bitmap); }
    }
    scheduleBlobCollection();
  };
}
export function replaceRuntimeResources(blobs: Map<string, Blob>, images: Map<string, ImageBitmap | HTMLImageElement>): void {
  const old = runtimeStore.getState().images, next = new Set(images.values());
  runtimeStore.setState({ blobs, images });
  for (const image of new Set(old.values())) if (!next.has(image)) { if (protectedBitmap(image)) retired.add(image); else close(image); }
  scheduleBlobCollection();
}
export interface CollectionResult { blobs: number; bitmaps: number; skipped: boolean }
export async function collectUnreferencedBlobs(): Promise<CollectionResult> {
  let persistent = new Set<string>();
  try { if (persistentReferences) persistent = await persistentReferences(); }
  catch { return { blobs: 0, bitmaps: 0, skipped: true }; } // Unknown recovery ownership is never treated as zero.
  // Take current state after the asynchronous recovery scan, not before it.
  const doc = getDocument(), runtime = runtimeStore.getState(), keep = projectResourceHashes(doc.project);
  for (const entry of [...doc.history.past, ...doc.history.future]) {
    if (entry.resourceHashes) for (const hash of entry.resourceHashes) keep.add(hash);
    else for (const id of entry.assetRefs) { const asset = doc.project.assets[id]; if (asset) { keep.add(asset.originalHash); keep.add(asset.renderHash); } }
  }
  for (const owner of owners) for (const hash of owner.hashes) keep.add(hash);
  for (const hash of persistent) keep.add(hash); for (const hash of runtime.pendingImages.keys()) keep.add(hash);
  const blobs = new Map(runtime.blobs), images = new Map(runtime.images); let blobCount = 0, bitmapCount = 0;
  for (const hash of blobs.keys()) if (!keep.has(hash)) { blobs.delete(hash); blobCount++; }
  const removed = new Set<CanvasImageSource>();
  for (const [hash, image] of images) if (!keep.has(hash) && !protectedBitmap(image)) { images.delete(hash); removed.add(image); }
  const retainedImages = new Set(images.values()); for (const image of removed) if (!retainedImages.has(image as ImageBitmap)) { close(image); bitmapCount++; }
  if (blobCount || bitmapCount) runtimeStore.setState({ blobs, images });
  return { blobs: blobCount, bitmaps: bitmapCount, skipped: false };
}
export function scheduleBlobCollection(): void {
  if (timer !== null) return;
  timer = setTimeout(() => { timer = null; void collectUnreferencedBlobs(); }, 250);
}
export function installBlobRepository(): () => void {
  return documentStore.subscribe((next, old) => { if (next.project !== old.project || next.history !== old.history) scheduleBlobCollection(); });
}
export function historyResourceHashes(before: Project, after: Project, assetIds: Id[]): string[] {
  const hashes = new Set<string>(); for (const project of [before, after]) for (const id of assetIds) { const asset = project.assets[id]; if (asset) { hashes.add(asset.originalHash); hashes.add(asset.renderHash); } } return [...hashes];
}
