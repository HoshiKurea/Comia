import { FloatingEditPanel } from '../app/FloatingEditPanel';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { ImageLayer, Mat, Point, Viewport } from '../domain/types';
import { IDENTITY, apply, decompose, inverse, multiply, pageToScreen, rotationRad, scaling, translation, worldMatrix } from '../geometry/matrix';
import { polyBounds } from '../geometry/polygon';
import { rectHandle } from '../interaction/resize';
import { pushNotice } from '../state/sessionStore';
import { cancelMaskEdit, commitMaskEdit, currentMaskEdit, maskEditStore, previewMaskImage, selectMaskTarget } from './maskController';
import { preserveUnlinkedMasks } from './maskGeometry';
import './mask.css';

type Drag = { pointerId: number; kind: 'move' | 'resize' | 'rotate' | 'vertex'; index: number; start: Point; image: ImageLayer; world: Mat; parentWorld: Mat; matrix: Mat };
function Numeric({ label, value, applyValue }: { label: string; value: number; applyValue: (n: number) => void }) {
  const [text, setText] = useState(String(Math.round(value * 1000) / 1000)), editing = useRef(false);
  // A target switch must update the displayed value before the browser can
  // select/type into it. While focused, retain the user's uncommitted draft.
  useLayoutEffect(() => { if (!editing.current) setText(String(Math.round(value * 1000) / 1000)); }, [value]);
  return <label>{label}<input aria-label={`遮罩编辑${label}`} type="number" step="any" value={text} onFocus={() => { editing.current = true; }} onChange={event => setText(event.target.value)} onBlur={() => { editing.current = false; const n = text.trim() ? Number(text) : NaN; if (Number.isFinite(n)) applyValue(n); else { pushNotice('error', '请输入有限数字'); setText(String(value)); } }} onKeyDown={event => { if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return; if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} /></label>;
}
export function MaskEditor({ viewport }: { viewport: Viewport }) {
  const active = useStore(maskEditStore, s => s.active), svg = useRef<SVGSVGElement>(null), drag = useRef<Drag | null>(null), pending = useRef<Point | null>(null), frame = useRef<number | null>(null);
  const [vertex, setVertex] = useState(0);
  const report = (image: ImageLayer) => { const result = previewMaskImage(image); if (!result.ok) pushNotice('error', result.problems[0].message); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.isComposing || event.keyCode === 229 || document.getElementById('expanded-tool-options')) return; if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancelMaskEdit(); } };
    const blur = () => cancelMaskEdit();
    window.addEventListener('keydown', key, true); window.addEventListener('blur', blur); return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('blur', blur); if (frame.current !== null) cancelAnimationFrame(frame.current); drag.current = null; };
  }, []);
  if (!active) return null;
  const image = active.preview.layers[active.imageId] as ImageLayer, mask = image.mask!;
  const matrix = active.target === 'mask' ? mask.matrix : image.matrix;
  const box = active.target === 'mask' ? polyBounds(mask.geometry) : { x: 0, y: 0, width: image.width, height: image.height };
  const parentWorld = active.target === 'mask' ? worldMatrix(active.preview, image.id) : image.parentId ? worldMatrix(active.preview, image.parentId) : IDENTITY;
  const world = multiply(parentWorld, matrix), screen = (p: Point) => pageToScreen(apply(world, p), viewport);
  const corners = [0, 2, 4, 6].map(index => screen(rectHandle(box, index))), hs = Array.from({ length: 8 }, (_, index) => screen(rectHandle(box, index)));
  const theta = decompose(matrix).thetaRad, factors = decompose(matrix);
  const point = (event: React.PointerEvent) => { const r = svg.current!.getBoundingClientRect(); return { x: (event.clientX - r.left - viewport.pan.x) / viewport.zoom, y: (event.clientY - r.top - viewport.pan.y) / viewport.zoom }; };
  const publishMatrix = (next: Mat, source: ImageLayer = image) => {
    const nextImage = active.target === 'mask' ? { ...source, mask: { ...source.mask!, matrix: next } } : { ...source, matrix: next };
    if (active.target === 'image') {
      const from = { ...active.preview, layers: { ...active.preview.layers, [source.id]: source } }, to = { ...from, layers: { ...from.layers, [source.id]: nextImage } };
      preserveUnlinkedMasks(from, to); report(to.layers[source.id] as ImageLayer);
    } else report(nextImage);
  };
  const flush = () => {
    frame.current = null;
    const d = drag.current, p = pending.current; pending.current = null; if (!d || !p || !currentMaskEdit()) return;
    const inv = inverse(d.parentWorld), wi = inverse(d.world); if (!inv.ok || !wi.ok) return;
    const q = apply(inv.value, p), start = apply(inv.value, d.start);
    if (d.kind === 'move') publishMatrix(multiply(translation(q.x - start.x, q.y - start.y), d.matrix), d.image);
    else if (d.kind === 'rotate') {
      const center = apply(d.matrix, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
      const angle = Math.atan2(q.y - center.y, q.x - center.x) - Math.atan2(start.y - center.y, start.x - center.x);
      publishMatrix(multiply(translation(center.x, center.y), multiply(rotationRad(angle), multiply(translation(-center.x, -center.y), d.matrix))), d.image);
    } else if (d.kind === 'resize') {
      const local = apply(wi.value, p), b = active.target === 'mask' ? polyBounds(d.image.mask!.geometry) : { x: 0, y: 0, width: d.image.width, height: d.image.height };
      const h = rectHandle(b, d.index), anchor = rectHandle(b, (d.index + 4) % 8);
      const sx = h.x === anchor.x ? 1 : (local.x - anchor.x) / (h.x - anchor.x), sy = h.y === anchor.y ? 1 : (local.y - anchor.y) / (h.y - anchor.y);
      if (sx <= 0 || sy <= 0) return;
      publishMatrix(multiply(d.matrix, multiply(translation(anchor.x, anchor.y), multiply(scaling(sx, sy), translation(-anchor.x, -anchor.y)))), d.image);
    } else {
      const geometry = d.image.mask!.geometry.map((value, i) => i === d.index ? apply(wi.value, p) : { ...value });
      report({ ...d.image, mask: { ...d.image.mask!, geometry } });
    }
  };
  const begin = (event: React.PointerEvent<SVGElement>, kind: Drag['kind'], index = 0) => {
    if (event.button !== 0 || drag.current) return; event.preventDefault(); event.stopPropagation();
    const node = svg.current!; node.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, kind, index, start: point(event), image: structuredClone(image), matrix: [...matrix], world: [...world], parentWorld: [...parentWorld] };
    if (kind === 'vertex') setVertex(index);
  };
  const stop = (event: React.PointerEvent<SVGSVGElement>, commit: boolean) => {
    if (drag.current?.pointerId !== event.pointerId) return; event.stopPropagation();
    if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null;
    if (commit) { pending.current = point(event); flush(); } else report(drag.current.image);
    drag.current = null; pending.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const updateGeometry = (geometry: Point[]) => report({ ...image, mask: { ...mask, geometry } });
  const length = Math.hypot(hs[1].x - hs[5].x, hs[1].y - hs[5].y), rotate = { x: hs[1].x + (hs[1].x - hs[5].x) * 28 / Math.max(1, length), y: hs[1].y + (hs[1].y - hs[5].y) * 28 / Math.max(1, length) };
  return <>
    <svg ref={svg} className="mask-editor-surface" aria-label="素材遮罩调整画布" onPointerDown={event => { event.stopPropagation(); begin(event, 'move'); }} onPointerMove={event => { if (drag.current?.pointerId !== event.pointerId) return; event.stopPropagation(); pending.current = point(event); if (frame.current === null) frame.current = requestAnimationFrame(flush); }} onPointerUp={event => stop(event, true)} onPointerCancel={event => stop(event, false)} onLostPointerCapture={event => stop(event, false)}>
      <polygon points={corners.map(p => `${p.x},${p.y}`).join(' ')} fill="transparent" stroke="#e97e52" strokeWidth="1.5" strokeDasharray="5 4" />
      {hs.map((p, index) => <circle key={index} cx={p.x} cy={p.y} r="5" className="mask-handle" aria-label={`调整手柄${index}`} onPointerDown={event => begin(event, 'resize', index)} />)}
      <circle cx={rotate.x} cy={rotate.y} r="6" className="mask-handle" aria-label="旋转遮罩或图片" onPointerDown={event => begin(event, 'rotate')} />
      {active.target === 'mask' && mask.shape === 'polygon' && mask.geometry.map((p, index) => { const q = screen(p); return <circle key={`v${index}`} cx={q.x} cy={q.y} r="5" className={`mask-vertex${vertex === index ? ' selected' : ''}`} aria-label={`遮罩顶点${index + 1}`} onPointerDown={event => begin(event, 'vertex', index)} />; })}
    </svg>
    <FloatingEditPanel title="编辑图片与遮罩"><div className="mask-editor-controls" role="region" aria-label="编辑图片与遮罩" onPointerDown={event => event.stopPropagation()}>
      <div className="mask-edit-heading"><button onClick={() => { const result = commitMaskEdit(); if (!result.ok) pushNotice('error', result.problems[0].message); }}>完成遮罩</button><button onClick={cancelMaskEdit}>取消遮罩编辑</button></div>
      <div className="mask-target-switch"><button aria-pressed={active.target === 'mask'} onClick={() => selectMaskTarget('mask')}>调整遮罩</button><button aria-pressed={active.target === 'image'} onClick={() => selectMaskTarget('image')}>调整图片</button><label>形状<select aria-label="遮罩形状" value={mask.shape} onChange={event => { const shape = event.target.value as typeof mask.shape, b = polyBounds(mask.geometry), geometry = [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }]; report({ ...image, mask: { ...mask, shape, geometry: shape === 'polygon' ? mask.geometry : geometry } }); setVertex(0); }}><option value="rect">矩形</option><option value="ellipse">椭圆</option><option value="polygon">多边形</option></select></label></div>
      <div className="mask-edit-fields" key={active.target}>
        <Numeric label="X" value={matrix[4]} applyValue={n => publishMatrix([matrix[0], matrix[1], matrix[2], matrix[3], n, matrix[5]])} />
        <Numeric label="Y" value={matrix[5]} applyValue={n => publishMatrix([matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], n])} />
        <Numeric label="宽" value={box.width * factors.sx} applyValue={n => { if (n > 0) publishMatrix(multiply(matrix, scaling(n / (box.width * factors.sx), 1))); else pushNotice('error', '宽度必须大于0'); }} />
        <Numeric label="高" value={box.height * factors.sy} applyValue={n => { if (n > 0) publishMatrix(multiply(matrix, scaling(1, n / (box.height * factors.sy)))); else pushNotice('error', '高度必须大于0'); }} />
        <Numeric label="角度" value={theta * 180 / Math.PI} applyValue={n => { const m = multiply(rotationRad(n * Math.PI / 180 - theta), [matrix[0], matrix[1], matrix[2], matrix[3], 0, 0]); publishMatrix([m[0], m[1], m[2], m[3], matrix[4], matrix[5]]); }} />
      </div>
      <div className="mask-target-switch"><label><input aria-label="编辑时链接遮罩" type="checkbox" checked={mask.linked} onChange={event => report({ ...image, mask: { ...mask, linked: event.target.checked } })} />图片与遮罩链接</label><label><input aria-label="编辑时启用遮罩" type="checkbox" checked={mask.enabled} onChange={event => report({ ...image, mask: { ...mask, enabled: event.target.checked } })} />显示遮罩效果</label>
      {active.target === 'mask' && mask.shape === 'polygon' && <><button disabled={mask.geometry.length >= 256} onClick={() => { const i = Math.min(vertex, mask.geometry.length - 1), a = mask.geometry[i], b = mask.geometry[(i + 1) % mask.geometry.length], next = [...mask.geometry]; next.splice(i + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); updateGeometry(next); setVertex(i + 1); }}>插入遮罩顶点</button><button disabled={mask.geometry.length <= 3} onClick={() => { updateGeometry(mask.geometry.filter((_, i) => i !== Math.min(vertex, mask.geometry.length - 1))); setVertex(0); }}>删除遮罩顶点</button></>}
      </div><p>拖动移动，手柄缩放，上方圆柄旋转；橙色顶点可修正轮廓。取消将恢复进入编辑前的图片。</p>
    </div></FloatingEditPanel>
  </>;
}
