import { useStore } from 'zustand';
import { FloatingEditPanel } from '../app/FloatingEditPanel';
import { mangaEditStore } from './mangaEditController';
import { MangaEditButtons } from './MangaFields';

export function MangaEditPanel() {
  const active = useStore(mangaEditStore, state => state.active);
  if (!active) return null;
  const title = active.kind === 'shape' ? '气泡轮廓' : active.kind === 'tail' ? '气泡尾巴' : '连续对白';
  return <FloatingEditPanel key={`${active.epoch}-${active.stateId}-${active.id}-${active.kind}`} title={title}>
    <p>在画布拖动手柄，或在属性面板调整参数。完成后统一提交，取消恢复本次编辑前的状态。</p>
    <MangaEditButtons />
  </FloatingEditPanel>;
}
