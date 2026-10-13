import { useStore } from 'zustand';
import type { BubbleBrushOptions as Options } from '../domain/types';
import { activateBubbleBrush, activateHandBubbleEdit, bubbleBrushStore, setBubbleBrushOptions, setBubbleInkOptions, type HandBubbleMode } from './brushController';
import { DEFAULT_BUBBLE_BRUSH } from './brushOptions';
import { handDrawnPreset } from './handDrawn';
import { pushNotice, sessionStore } from '../state/sessionStore';
import { StrokeBandFields } from './StrokeBandFields';
import { openPresetDialog } from '../library/PresetDialog';
import { MangaNumber } from './MangaFields';
export function BubbleBrushOptions({ expanded = false }: { expanded?: boolean }) {
  const o = useStore(bubbleBrushStore, s => s.options), mode = useStore(bubbleBrushStore, s => s.mode), ink = useStore(bubbleBrushStore, s => s.ink);
  const report = (r: { ok: boolean; problems?: { message: string }[] }) => { if (!r.ok) pushNotice('info', r.problems?.[0].message ?? '参数无效'); };
  const set = (patch: Partial<Options>) => report(setBubbleBrushOptions({ ...bubbleBrushStore.getState().options, ...patch }));
  return <><label>操作<select aria-label="手绘气泡操作" value={mode} onChange={e => { const next = e.target.value as HandBubbleMode; if (next === 'contour') report(activateBubbleBrush()); else report(activateHandBubbleEdit({ targetId: bubbleBrushStore.getState().targetId ?? sessionStore.getState().selection[0], mode: next })); }}>
    <option value="contour">新轮廓</option><option value="ink">画细节</option><option value="erase-ink">擦细节</option><option value="add-shape">补画</option><option value="subtract-shape">擦形</option></select></label>
    {mode === 'contour' ? <><label>边缘<select aria-label="气泡笔触预设" value={o.handDrawn?.preset ?? 'clean'} onChange={e => set({ handDrawn: e.target.value === 'clean' ? null : handDrawnPreset(e.target.value as 'soft' | 'rough') })}><option value="clean">原始轮廓</option><option value="soft">柔和手绘</option><option value="rough">粗糙速写</option>{o.handDrawn?.preset === 'custom' && <option value="custom">自定义</option>}</select></label><MangaNumber label="气泡笔刷边宽" min={0} max={256} step={.25} value={o.borderWidth} apply={borderWidth => { set({ borderWidth }); return { ok: true, value: undefined }; }} />
      {expanded && <><label>填充RGBA<input aria-label="气泡笔刷填充RGBA" key={o.fill} defaultValue={o.fill} onBlur={e => set({ fill: e.target.value.trim().toUpperCase() })} /></label><label>边色RGBA<input aria-label="气泡笔刷边色RGBA" key={o.borderColor} defaultValue={o.borderColor} onBlur={e => set({ borderColor: e.target.value.trim().toUpperCase() })} /></label><MangaNumber label="气泡笔刷抖动" min={0} max={.03} step={.001} value={o.handDrawn?.wobble ?? 0} apply={wobble => { set({ handDrawn: { preset: 'custom', seed: 42, pressure: 0, irregularity: 0, wobble } }); return { ok: true, value: undefined }; }} /><StrokeBandFields style={{ ...o, radius: 0 }} prefix="笔刷" update={set} /><button onClick={() => report(openPresetDialog({ bubbleBrush: true }))}>保存气泡笔刷预设…</button><button onClick={() => set(DEFAULT_BUBBLE_BRUSH)}>恢复笔刷默认</button></>}</> : <>
      <MangaNumber label="气泡画笔笔宽" min={1} max={512} step={1} value={ink.width} apply={width => setBubbleInkOptions({ width })} />
      <MangaNumber label="气泡画笔透明度 %" min={0} max={100} value={ink.opacity * 100} apply={opacity => setBubbleInkOptions({ opacity: opacity / 100 })} />
      {(mode === 'ink' || mode === 'erase-ink') && <label>颜色<input type="color" aria-label="气泡画笔颜色" value={ink.color.slice(0, 7)} onChange={e => report(setBubbleInkOptions({ color: e.target.value.toUpperCase() + ink.color.slice(7) }))} /></label>}
    </>}
    <span className="tool-option-hint">{mode === 'contour' ? '画轮廓 · 松手自动补口并选中' : '每笔松手保存 · Esc取消当前笔 · V移动'}</span></>;
}
