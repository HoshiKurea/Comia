import { breakoutSplitGuard } from '../images/breakoutCommands';
import { useEffect, useRef, useState } from 'react';
import type { Id, PanelLayer, PanelTemplateNode, Result } from '../domain/types';
import { getProject } from '../state/documentStore';
import { sessionStore, pushNotice } from '../state/sessionStore';
import { polyBounds } from '../geometry/polygon';
import { generateRandomLayout, type RandomLayoutOptions } from './randomLayout';
import { makeGrid } from './presets';
import { applyIndependentLayout } from './independentLayout';
import { cancelActiveGesture } from '../interaction/activeGesture';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { hasLockedDescendant } from '../layers/group';
import './tools.css';
import { useModalFocus } from '../app/useModalFocus';
import { LibraryCategory } from '../library/LibraryCategory';
import { LibraryTile } from '../library/LibraryTile';
import { beginDrawing } from './drawingController';

export function LayoutDialog({ random, close }: { random: boolean; close: () => void }) {
  const dialogRef = useRef<HTMLElement>(null); useModalFocus(dialogRef, true, close);
  const base = useRef(getProject()).current, pageId = useRef(sessionStore.getState().activePageId).current, page = base.pages[pageId];
  const selected = useRef(sessionStore.getState().selection[0]).current, selectedLayer = selected ? base.layers[selected] : null;
  const breakout = selected ? breakoutSplitGuard(base, selected) : null, splitReason = breakout && !breakout.ok ? breakout.problems[0].message : '';
  const selectable = selectedLayer?.type === 'panel' && selectedLayer.role === 'leaf' && !effectiveLayerFlags(base, selected).locked && !hasLockedDescendant(base, selected) && !splitReason;
  const [targetId, setTargetId] = useState<Id | null>(null), [count, setCount] = useState('6'), [margin, setMargin] = useState('48'), [gapX, setGapX] = useState('16'), [gapY, setGapY] = useState('16'), [angle, setAngle] = useState('12'), [seed, setSeed] = useState('42'), [style, setStyle] = useState<RandomLayoutOptions['style']>('dynamic'), [rows, setRows] = useState('2'), [columns, setColumns] = useState('2');
  const [result, setResult] = useState<Result<PanelTemplateNode> | null>(null), [applying, setApplying] = useState(false), [error, setError] = useState('');
  const target = targetId ? base.layers[targetId] as PanelLayer : null;
  const bounds = target ? polyBounds(target.geometry) : { x: 0, y: 0, width: page.width, height: page.height };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.isComposing) { event.stopImmediatePropagation(); close(); } };
    document.addEventListener('keydown', listener, true); return () => document.removeEventListener('keydown', listener, true);
  }, [close]);
  useEffect(() => {
    setResult(null); setError('');
    const frame = requestAnimationFrame(() => {
      const number = (value: string) => value.trim() ? Number(value) : NaN;
      if (getProject() !== base || sessionStore.getState().activePageId !== pageId) { setError('作品已变化，请关闭后重新生成'); return; }
      if (!target && (!Number.isFinite(number(margin)) || number(margin) < 0 || number(margin) > 8192)) { setError('页边距须为0～8192px'); return; }
      if (target && target.geometryMode === 'simple') { setError('自由轮廓请使用直线切割；随机布局请选择当前页或凸形分镜'); return; }
      if (!random && target && (target.geometry.length !== 4 || target.geometry.some(p => ![bounds.x, bounds.x + bounds.width].includes(p.x) || ![bounds.y, bounds.y + bounds.height].includes(p.y)))) { setError('行列等分需要矩形目标，请选择当前页'); return; }
      setResult(random ? generateRandomLayout(bounds, { count: number(count), margin: target ? 0 : number(margin), gapX: number(gapX), gapY: number(gapY), maxAngleDeg: number(angle), seed: number(seed), style }, target?.geometry) : makeGrid({ x: bounds.x + (target ? 0 : number(margin)), y: bounds.y + (target ? 0 : number(margin)), width: bounds.width - (target ? 0 : 2 * number(margin)), height: bounds.height - (target ? 0 : 2 * number(margin)) }, number(rows), number(columns), number(gapX), number(gapY)));
    });
    return () => cancelAnimationFrame(frame);
  }, [targetId, count, margin, gapX, gapY, angle, seed, style, rows, columns]);
  const apply = () => {
    if (!result?.ok || applying) return;
    if (getProject() !== base || sessionStore.getState().activePageId !== pageId) { setError('作品已变化，未应用布局'); return; }
    setApplying(true); const applied = applyIndependentLayout(pageId, result.value, targetId);
    if (applied.ok) close(); else { setError(applied.problems[0].message); setApplying(false); }
  };
  const input = (label: string, value: string, update: (value: string) => void, min: number, max: number) => <label>{label}<input aria-label={label} type="number" min={min} max={max} step="1" value={value} onChange={e => update(e.target.value)} /></label>;
  const leaves: PanelTemplateNode[] = []; const visit = (node: PanelTemplateNode) => { if (!node.children.length) leaves.push(node); else node.children.forEach(visit); }; if (result?.ok) visit(result.value);
  return <div className="dialog-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) close(); }}><section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={random ? '随机分格' : '行列等分'} className="panel-layout-dialog">
    <div className="dialog-heading"><strong>{random ? '随机分格' : '行列等分'}</strong><button aria-label="关闭分格设置" onClick={close}>×</button></div>
    <div className="panel-layout-body"><div>
      <label>生成范围<select aria-label="分格生成范围" value={targetId ?? ''} onChange={e => setTargetId(e.target.value || null)}><option value="">当前页（新增布局）</option><option value={selected ?? 'unavailable'} disabled={!selectable} title={splitReason || undefined}>当前分镜（切分目标）</option></select></label>{splitReason && <p className="hint">{splitReason}</p>}
      {random ? input('随机格数', count, setCount, 2, 24) : <>{input('等分行数', rows, setRows, 1, 8)}{input('等分列数', columns, setColumns, 1, 8)}</>}
      {!targetId && input('分格页边距', margin, setMargin, 0, 8192)}
      {input('分格横向间隙', gapX, setGapX, 0, 256)}{input('分格纵向间隙', gapY, setGapY, 0, 256)}
      {random && <><label>布局风格<select aria-label="随机布局风格" value={style} onChange={e => setStyle(e.target.value as typeof style)}><option value="dynamic">动态倾斜</option><option value="regular">规整分格</option></select></label>{input('最大倾斜角', angle, setAngle, 0, 25)}{input('随机种子', seed, setSeed, 0, 4294967295)}<button onClick={() => setSeed(String((Number(seed) + 1) >>> 0))}>换一组</button></>}
      {(error || (result && !result.ok)) && <p role="alert">{error || (result && !result.ok ? result.problems[0].message : '')}</p>}
      <p className="hint">每格独立选中、移动、缩放和调整边框。 {targetId ? '替换原框并移出分格容器，保留图片映射；原父框裁剪不再约束新框。' : '新增分镜，已有内容保持。'} 预览不进入历史，整次生成可一次撤销。</p>
    </div><svg className="panel-layout-preview" aria-label="分格布局预览" viewBox={`${bounds.x - 8} ${bounds.y - 8} ${bounds.width + 16} ${bounds.height + 16}`}>
      <rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill="white" />
      {leaves.map((node, i) => <polygon key={i} points={node.geometry.map(p => `${p.x},${p.y}`).join(' ')} fill="#e8e8df" stroke="#293b34" strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
    </svg></div><div className="dialog-actions"><span>{leaves.length} 格 · 可撤销</span><button onClick={close}>取消</button><button className="primary" disabled={!result?.ok || applying || Boolean(error)} onClick={apply}>应用分格</button></div>
  </section></div>;
}
export function PanelTools() {
  const [dialog, setDialog] = useState<'random' | 'grid' | null>(null);
  const open = (next: 'random' | 'grid') => { const text = finishActiveTextEdit(); if (!text.ok) { pushNotice('error', text.problems[0].message); return; } cancelActiveGesture(); setDialog(next); };
  const draw = (mode: 'freehand' | 'polygon') => { const result = beginDrawing(mode); if (!result.ok) pushNotice('error', result.problems[0].message); };
  return <><LibraryCategory name="分格工具" id="panel-tools">
    <LibraryTile label="行列等分" onClick={() => open('grid')}><svg viewBox="0 0 32 30"><path d="M3 3H29V27H3Z M16 3V27 M3 15H29" /></svg></LibraryTile>
    <LibraryTile label="随机分格" onClick={() => open('random')}><svg viewBox="0 0 32 30"><path d="M3 3H29V27H3Z M3 12L29 18 M13 3L10 14 M22 17L18 27" /></svg></LibraryTile>
    <LibraryTile label="手绘分格" onClick={() => draw('freehand')}><svg viewBox="0 0 32 30"><path d="M5 6C9 3 13 5 17 4S28 2 28 8L26 24Q24 27 20 25L14 20 6 25Q3 27 4 21Z M18 12L25 5 28 8 21 15 17 16Z" /></svg></LibraryTile>
    <LibraryTile label="多边形分格" onClick={() => draw('polygon')}><svg viewBox="0 0 32 30"><path d="M5 5H27V25L16 19 5 25Z" /><path d="M3 3H7V7H3Z M25 3H29V7H25Z M25 23H29V27H25Z M14 17H18V21H14Z M3 23H7V27H3Z" fill="var(--panel)" /></svg></LibraryTile>
  </LibraryCategory>{dialog && <LayoutDialog random={dialog === 'random'} close={() => setDialog(null)} />}</>;
}
