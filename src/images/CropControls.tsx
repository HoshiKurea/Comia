import { FloatingEditPanel } from '../app/FloatingEditPanel';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { ImageLayer, Result } from '../domain/types';
import { firstMessage } from '../domain/types';
import { cropEditStore, currentCropEdit, editableCropImages, previewCropParams, previewCropZoom, selectCropImage } from './cropController';
import './crop.css';

function CropNumber({ label, value, maximum, apply }: { label: string; value: number; maximum: number; apply: (value: number) => Result<void> }) {
  const [draft, setDraft] = useState(String(value)), [error, setError] = useState('');
  useEffect(() => { setDraft(String(Number(value.toFixed(6)))); setError(''); }, [value]);
  const submit = () => {
    const result = apply(draft.trim() ? Number(draft) : NaN);
    setError(result.ok ? '' : firstMessage(result));
    const active = currentCropEdit(), image = active?.preview.layers[active.imageId];
    if (image?.type === 'image' && image.crop) setDraft(String(Number((label === '裁剪缩放倍数' ? image.crop.zoom : label === '裁剪焦点 U' ? image.crop.focus.u : image.crop.focus.v).toFixed(6))));
  };
  return <label className="crop-number"><span>{label.replace('裁剪', '')}{label==='裁剪缩放倍数'?' ×':''}</span><input aria-label={label} type="number" min={label === '裁剪缩放倍数' ? 1 : 0} max={maximum} step="0.01" value={draft} aria-invalid={!!error} onChange={(event) => setDraft(event.target.value)} onBlur={submit} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing&&event.nativeEvent.keyCode!==229) { event.preventDefault(); event.stopPropagation(); submit(); event.currentTarget.blur(); } }} />{error && <span role="alert">{error}</span>}</label>;
}
export function CropControls({ finish }: { finish: (commit: boolean) => void }) {
  const active = useStore(cropEditStore, (state) => state.active), [error, setError] = useState('');
  if (!active) return null;
  const image = active.preview.layers[active.imageId] as ImageLayer, crop = image.crop!, maximum = active.maximumByImage[image.id];
  const check = (result: Result<void>) => setError(result.ok ? '' : firstMessage(result));
  return <FloatingEditPanel title="图片裁剪"><div className="crop-actions" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
    <div className="crop-heading"><span>拖动焦点 · 滚轮缩放 · Esc 取消</span><button onClick={() => finish(false)}>取消</button><button onClick={() => finish(true)}>完成裁剪</button></div>
    <label className="crop-target">目标图片<select aria-label="裁剪目标图片" value={image.id} onChange={(event) => check(selectCropImage(event.target.value))}>{editableCropImages(active.base, active.panelId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <div className="crop-fields"><CropNumber key={`${image.id}-zoom`} label="裁剪缩放倍数" value={crop.zoom} maximum={maximum} apply={(value) => previewCropParams({ ...crop, zoom: value })} /><CropNumber key={`${image.id}-u`} label="裁剪焦点 U" value={crop.focus.u} maximum={1} apply={(value) => previewCropParams({ ...crop, focus: { ...crop.focus, u: value } })} /><CropNumber key={`${image.id}-v`} label="裁剪焦点 V" value={crop.focus.v} maximum={1} apply={(value) => previewCropParams({ ...crop, focus: { ...crop.focus, v: value } })} /></div>
    <input aria-label="裁剪缩放滑块" type="range" min="1" max={maximum} step="0.01" value={crop.zoom} onChange={(event) => check(previewCropZoom(Number(event.target.value)))} />
    <small>焦点为原图归一坐标，边界自动钳制；改变分镜尺寸后维持焦点。</small>{error && <span role="alert">{error}</span>}
  </div></FloatingEditPanel>;
}
