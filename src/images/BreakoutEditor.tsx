import { FloatingEditPanel } from '../app/FloatingEditPanel';
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { BreakoutRegion, Mat, Point, Viewport } from '../domain/types';
import { apply, inverse, multiply, rotationRad, scaling, translation, worldMatrix } from '../geometry/matrix';
import { polyBounds } from '../geometry/polygon';
import { rectHandle } from '../interaction/resize';
import { pushNotice } from '../state/sessionStore';
import { breakoutEditStore, cancelBreakoutEdit, commitBreakoutEdit, currentBreakoutEdit, previewBreakoutRegion } from './breakoutController';
import './mask.css';

type Drag = { pointerId: number; kind: 'move' | 'resize' | 'rotate' | 'vertex'; index: number; start: Point; region: BreakoutRegion; imageWorld: Mat; regionWorld: Mat; angle: number; delta: number };
export function BreakoutEditor({ viewport }: { viewport: Viewport }) {
  const active = useStore(breakoutEditStore, s => s.active), svg = useRef<SVGSVGElement>(null), drag = useRef<Drag | null>(null), frame = useRef<number | null>(null), pending = useRef<{ point: Point; shift: boolean } | null>(null);
  const [vertex, setVertex] = useState(0), [error, setError] = useState(''), [drawPoints, setDrawPoints] = useState<Point[] | null>(null);
  const drawing = useRef<Point[] | null>(null); drawing.current = drawPoints;
  const report = (region: BreakoutRegion) => { const result = previewBreakoutRegion(region); setError(result.ok ? '' : result.problems[0].message); return result.ok; };
  const finishPolygon = () => { const points = drawing.current, session = currentBreakoutEdit(); if (!points || !session) return;
    if (points.length < 3) { setError('至少绘制三个不同的点才能闭合'); return; }
    if (report({ shape: 'polygon', geometry: points, matrix: [1,0,0,1,0,0] })) setDrawPoints(null);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      const input = (e.target as HTMLElement).closest('input,textarea,[contenteditable=true]');
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (drawing.current) setDrawPoints(null); else cancelBreakoutEdit(); }
      else if (e.key === 'Enter' && drawing.current && !input) { e.preventDefault(); e.stopImmediatePropagation(); finishPolygon(); }
    }; window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  });
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  if (!active) return null;
  const image = active.preview.layers[active.imageId]; if (image.type !== 'image' || !image.panelClip?.region) return null;
  const region = image.panelClip.region, imageWorld = worldMatrix(active.preview, image.id), world = multiply(imageWorld, region.matrix), box = polyBounds(region.geometry);
  const toPage = (e: React.PointerEvent | React.MouseEvent): Point => { const r = svg.current!.getBoundingClientRect(); return { x: (e.clientX - r.left - viewport.pan.x) / viewport.zoom, y: (e.clientY - r.top - viewport.pan.y) / viewport.zoom }; };
  const screen = (p: Point): Point => { const q = apply(world, p); return { x: viewport.pan.x + viewport.zoom * q.x, y: viewport.pan.y + viewport.zoom * q.y }; };
  const start = (e: React.PointerEvent, kind: Drag['kind'], index = 0) => {
    if (e.button !== 0 || !e.isPrimary || drag.current) return; e.preventDefault(); e.stopPropagation(); const point = toPage(e), inv = inverse(imageWorld); if (!inv.ok) return;
    const c = apply(region.matrix, { x: box.x + box.width / 2, y: box.y + box.height / 2 }), p = apply(inv.value, point);
    drag.current = { pointerId: e.pointerId, kind, index, start: point, region: structuredClone(region), imageWorld, regionWorld: world, angle: Math.atan2(p.y - c.y, p.x - c.x), delta: 0 }; svg.current?.setPointerCapture(e.pointerId); setVertex(index);
  };
  const flush = () => {
    frame.current = null; const d = drag.current, input = pending.current; pending.current = null; if (!d || !input) return;
    const imageInv = inverse(d.imageWorld), regionInv = inverse(d.regionWorld); if (!imageInv.ok || !regionInv.ok) return;
    let next = structuredClone(d.region); const b = polyBounds(next.geometry), point = apply(regionInv.value, input.point);
    if (d.kind === 'vertex') next.geometry[d.index] = point;
    else if (d.kind === 'move') { const delta = { x: input.point.x - d.start.x, y: input.point.y - d.start.y }, m = imageInv.value; next.matrix = multiply(translation(m[0] * delta.x + m[2] * delta.y, m[1] * delta.x + m[3] * delta.y), d.region.matrix); }
    else if (d.kind === 'resize') {
      const h = rectHandle(b, d.index), a = rectHandle(b, (d.index + 4) % 8);
      let kx = h.x === a.x ? 1 : (point.x - a.x) / (h.x - a.x), ky = h.y === a.y ? 1 : (point.y - a.y) / (h.y - a.y);
      if (kx <= 0 || ky <= 0) { setError('不能穿过固定锚点翻转区域'); return; }
      if (input.shift) kx = ky = Math.abs(kx - 1) >= Math.abs(ky - 1) ? kx : ky;
      next.matrix = multiply(d.region.matrix, multiply(multiply(translation(a.x, a.y), scaling(kx, ky)), translation(-a.x, -a.y)));
    } else {
      const c = apply(d.region.matrix, { x: b.x + b.width / 2, y: b.y + b.height / 2 }), p = apply(imageInv.value, input.point), angle = Math.atan2(p.y - c.y, p.x - c.x);
      let delta = angle - d.angle; while (delta > Math.PI) delta -= 2 * Math.PI; while (delta < -Math.PI) delta += 2 * Math.PI;
      d.delta += delta; d.angle = angle;
      const theta = input.shift ? Math.round(d.delta / (Math.PI / 12)) * Math.PI / 12 : d.delta;
      next.matrix = multiply(multiply(multiply(translation(c.x, c.y), rotationRad(theta)), translation(-c.x, -c.y)), d.region.matrix);
    }
    report(next);
  };
  const stop = (e: React.PointerEvent) => { if (drag.current?.pointerId !== e.pointerId) return; e.stopPropagation(); pending.current = { point: toPage(e), shift: e.shiftKey }; if (frame.current !== null) cancelAnimationFrame(frame.current); flush(); drag.current = null; };
  const hs = Array.from({ length: 8 }, (_, i) => screen(rectHandle(box, i))), rotate = { x: hs[1].x, y: hs[1].y - 28 };
  const transform = `matrix(${world[0] * viewport.zoom} ${world[1] * viewport.zoom} ${world[2] * viewport.zoom} ${world[3] * viewport.zoom} ${viewport.pan.x + world[4] * viewport.zoom} ${viewport.pan.y + world[5] * viewport.zoom})`;
  const numeric = (label: string, value: number, update: (value: number) => void) => <label key={label}>{label}<input aria-label={`局部破格${label}`} type="number" step="any" defaultValue={Number(value.toFixed(3))} key={`${label}:${value}`} onBlur={e => { const n = e.currentTarget.value.trim() ? Number(e.currentTarget.value) : NaN; if (!Number.isFinite(n) || Math.abs(n) > 1e7) { setError('请输入绝对值不超过10000000的有限数字'); return; } update(n); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} /></label>;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }, width = box.width * Math.hypot(region.matrix[0], region.matrix[1]), height = box.height * Math.hypot(region.matrix[2], region.matrix[3]);
  const resizeNumeric = (w: number, h: number) => { if (w < .001 || h < .001) { setError('区域宽高至少0.001px'); return; } report({ ...region, matrix: multiply(region.matrix, multiply(multiply(translation(center.x, center.y), scaling(w / width, h / height)), translation(-center.x, -center.y))) }); };
  const polygonEdit = (kind: 'insert' | 'delete') => {
    const index = Math.min(vertex, region.geometry.length - 1), points = structuredClone(region.geometry);
    if (kind === 'delete') { if (points.length <= 3) { setError('多边形至少保留三个点'); return; } points.splice(index, 1); }
    else { if (points.length >= 256) { setError('最多256个顶点'); return; } const a = points[index], b = points[(index + 1) % points.length]; points.splice(index + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); }
    report({ ...region, geometry: points }); setVertex(Math.min(index, points.length - 1));
  };
  return <>
    <svg ref={svg} className="mask-editor-surface" data-testid="breakout-editor" aria-label="局部破格区域编辑" style={{ pointerEvents: drawPoints ? 'auto' : 'none' }} onPointerDown={e => {
      if (!drawPoints || e.button !== 0 || !e.isPrimary) return; e.stopPropagation(); const inv = inverse(imageWorld); if (!inv.ok) return;
      const p = apply(inv.value, toPage(e)); if (drawPoints.length >= 256) { setError('最多256个顶点'); return; }
      if (!drawPoints.length || Math.hypot(p.x - drawPoints.at(-1)!.x, p.y - drawPoints.at(-1)!.y) > .001) setDrawPoints([...drawPoints, p]);
    }} onPointerMove={e => { if (drag.current?.pointerId !== e.pointerId) return; e.stopPropagation(); pending.current = { point: toPage(e), shift: e.shiftKey }; if (frame.current === null) frame.current = requestAnimationFrame(flush); }} onPointerUp={stop} onPointerCancel={() => { drag.current = null; pending.current = null; cancelBreakoutEdit(); }} onLostPointerCapture={e => { if (drag.current?.pointerId === e.pointerId) { drag.current = null; pending.current = null; cancelBreakoutEdit(); } }} onDoubleClick={e => { if (drawPoints) { e.stopPropagation(); finishPolygon(); } }}>
      {region.shape === 'ellipse' ? <ellipse transform={transform} cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2} fill="#4c94dd18" stroke="#3276b8" strokeWidth="1.5" vectorEffect="non-scaling-stroke" style={{ pointerEvents: drawPoints ? 'none' : 'auto' }} onPointerDown={e => start(e, 'move')} /> : <polygon points={region.geometry.map(p => { const q = screen(p); return `${q.x},${q.y}`; }).join(' ')} fill="#4c94dd18" stroke="#3276b8" strokeWidth="1.5" style={{ pointerEvents: drawPoints ? 'none' : 'auto' }} onPointerDown={e => start(e, 'move')} />}
      {!drawPoints && <>{hs.map((p, i) => <rect key={i} x={p.x - 4} y={p.y - 4} width="8" height="8" fill="white" stroke="#3276b8" style={{ pointerEvents: 'auto' }} onPointerDown={e => start(e, 'resize', i)} />)}<circle cx={rotate.x} cy={rotate.y} r="6" fill="white" stroke="#3276b8" style={{ pointerEvents: 'auto' }} onPointerDown={e => start(e, 'rotate')} />{region.shape === 'polygon' && region.geometry.map((p, i) => { const s = screen(p); return <circle key={i} cx={s.x} cy={s.y} r="5" fill={i === vertex ? '#3276b8' : 'white'} stroke="#3276b8" style={{ pointerEvents: 'auto' }} onPointerDown={e => start(e, 'vertex', i)} />; })}</>}
      {drawPoints && <polyline points={drawPoints.map(p => { const q = apply(imageWorld, p); return `${viewport.pan.x + viewport.zoom * q.x},${viewport.pan.y + viewport.zoom * q.y}`; }).join(' ')} fill="none" stroke="#3276b8" strokeWidth="2" />}
    </svg>
    <FloatingEditPanel title="局部破格区域"><div className="mask-editor-controls breakout-editor-controls" data-testid="breakout-controls" onPointerDown={e => e.stopPropagation()}>
      {numeric('X', region.matrix[4], n => report({ ...region, matrix: [...region.matrix.slice(0,4), n, region.matrix[5]] as unknown as Mat }))}
      {numeric('Y', region.matrix[5], n => report({ ...region, matrix: [...region.matrix.slice(0,4), region.matrix[4], n] as unknown as Mat }))}
      {numeric('宽', width, n => resizeNumeric(n, height))}{numeric('高', height, n => resizeNumeric(width, n))}
      {numeric('角度', Math.atan2(region.matrix[1], region.matrix[0]) * 180 / Math.PI, n => { const c = apply(region.matrix, center), angle = n * Math.PI / 180 - Math.atan2(region.matrix[1], region.matrix[0]); report({ ...region, matrix: multiply(multiply(multiply(translation(c.x, c.y), rotationRad(angle)), translation(-c.x, -c.y)), region.matrix) }); })}
      {region.shape === 'polygon' && <><button onClick={() => setDrawPoints([])}>重新绘制多边形</button><button disabled={!!drawPoints} onClick={() => polygonEdit('insert')}>插入顶点</button><button disabled={!!drawPoints} onClick={() => polygonEdit('delete')}>删除顶点</button></>}
      {drawPoints ? <button onClick={finishPolygon}>闭合区域</button> : <button onClick={() => { const r = commitBreakoutEdit(); if (!r.ok) pushNotice('error', r.problems[0].message); }}>完成局部破格</button>}<button onClick={cancelBreakoutEdit}>取消局部破格</button>{error && <span role="alert">{error}</span>}
    </div></FloatingEditPanel>
  </>;
}
