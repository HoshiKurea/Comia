/**
 * M01-T03：运行时 Store。存 Blob/ImageBitmap/Konva 节点/DOM/FileSystemHandle/
 * AbortController，禁止 JSON 序列化。所有派生 bbox/字体布局按 stateId+id 缓存。
 */
import { createStore } from 'zustand/vanilla';
import type { Id, Mat, Rect, Project } from '../domain/types';
import type { ShapePath } from '../geometry/types';
import type { TextLayout } from '../text/types';

export interface RuntimeStoreState {
  /** 原始与归一化资源按 SHA-256 存储，供项目文件往返使用。 */
  blobs: Map<string, Blob>;
  /** 已解码图片位图，键为 renderHash（去重共享） */
  images: Map<string, ImageBitmap | HTMLImageElement>;
  /** 图片解码中：hash → promise（避免并发重复解码） */
  pendingImages: Map<string, Promise<ImageBitmap | HTMLImageElement>>;
  /** 字体代次：字体加载完成后递增，使文字布局缓存失效 */
  fontGeneration: number;
  /** 渲染统计（M04/M15） */
  renderStats: { mainDraws: number; gestureDraws: number; overlayDraws: number };
  /** 手势活动标志 */
  gestureActive: boolean;
  previewProject: Project | null;
  /** 自动恢复定时器等 */
  timers: Map<string, ReturnType<typeof setTimeout>>;
  abortControllers: Map<string, AbortController>;
}

export const runtimeStore = createStore<RuntimeStoreState>(() => ({
  blobs: new Map(),
  images: new Map(),
  pendingImages: new Map(),
  fontGeneration: 0,
  renderStats: { mainDraws: 0, gestureDraws: 0, overlayDraws: 0 },
  gestureActive: false,
  previewProject: null,
  timers: new Map(),
  abortControllers: new Map(),
}));

export function bumpFontGeneration(): void {
  runtimeStore.setState((s) => ({ fontGeneration: s.fontGeneration + 1 }));
}

export function addMainDraws(n: number): void {
  runtimeStore.setState((s) => ({ renderStats: { ...s.renderStats, mainDraws: s.renderStats.mainDraws + n } }));
}

export function addGestureDraws(n: number): void {
  runtimeStore.setState((s) => ({ renderStats: { ...s.renderStats, gestureDraws: s.renderStats.gestureDraws + n } }));
}

export function addOverlayDraws(n: number): void {
  runtimeStore.setState((s) => ({ renderStats: { ...s.renderStats, overlayDraws: s.renderStats.overlayDraws + n } }));
}

export function resetRenderStats(): void {
  runtimeStore.setState({ renderStats: { mainDraws: 0, gestureDraws: 0, overlayDraws: 0 } });
}

// ---------- 派生缓存（stateId + id 键控） ----------

interface CacheEntry<T> {
  stateId: string;
  value: T;
}

const boundsCache = new Map<string, CacheEntry<Rect>>();
const layoutCache = new Map<string, CacheEntry<TextLayout>>();
const CACHE_MAX = 4096;

function cacheGet<T>(cache: Map<string, CacheEntry<T>>, key: string, stateId: string): T | undefined {
  const e = cache.get(key);
  if (e && e.stateId === stateId) return e.value;
  return undefined;
}

function cachePut<T>(cache: Map<string, CacheEntry<T>>, key: string, stateId: string, value: T): void {
  if (cache.size >= CACHE_MAX) {
    // 简单清理：全量失效（低频）
    cache.clear();
  }
  cache.set(key, { stateId, value });
}

export function invalidateDocumentCaches(): void {
  boundsCache.clear();
  layoutCache.clear();
}

export function cachedBounds(key: string, stateId: string, compute: () => Rect): Rect {
  const hit = cacheGet(boundsCache, key, stateId);
  if (hit) return hit;
  const v = compute();
  cachePut(boundsCache, key, stateId, v);
  return v;
}

export function cachedLayout(key: string, stateId: string, compute: () => TextLayout): TextLayout {
  const hit = cacheGet(layoutCache, key, stateId);
  if (hit) return hit;
  const v = compute();
  cachePut(layoutCache, key, stateId, v);
  return v;
}

/** 简易会话内 memo（gesture 计算） */
export function memoGesture<T>(map: Map<string, T>, key: string, compute: () => T): T {
  const hit = map.get(key);
  if (hit !== undefined) return hit;
  const v = compute();
  map.set(key, v);
  return v;
}

export type { Mat, ShapePath, Id, Rect };
