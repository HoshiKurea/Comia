import { breakoutSplitGuard } from '../images/breakoutCommands';
import { getProject } from '../state/documentStore';
import { useEffect, useState } from 'react';
import type { Id, Result } from '../domain/types';
import { firstMessage } from '../domain/types';
import { pushNotice } from '../state/sessionStore';
import { clearCutPreview, commitCut, showCutPreview, type CutSpec } from './cutPanel';

export function CutInspector({ id, leaf }: { id: Id; leaf: boolean }) {
  const [ratio, setRatio] = useState('0.5'), [gap, setGap] = useState('16'), [axis, setAxis] = useState<CutSpec['axis']>('vertical'), [error, setError] = useState('');
  useEffect(() => () => clearCutPreview(), [id]);
  const spec = (nextRatio = ratio, nextGap = gap, nextAxis = axis): CutSpec => ({ axis: nextAxis, ratio: nextRatio.trim() ? Number(nextRatio) : NaN, gap: nextGap.trim() ? Number(nextGap) : NaN });
  const check = (result: Result<unknown>, toast = false) => { const message = result.ok ? '' : firstMessage(result); setError(message); if (toast && message) pushNotice('error', message); };
  const guard = breakoutSplitGuard(getProject(), id), reason = guard.ok ? '' : guard.problems[0].message;
  return <fieldset className="inspector-edit cut-inspector" disabled={!leaf || !!reason} title={reason || undefined} onFocusCapture={() => check(showCutPreview(id, spec()))} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearCutPreview(); }} onKeyDown={(event) => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); clearCutPreview(); event.currentTarget.querySelector<HTMLElement>(':focus')?.blur(); } }}>
    <p className="hint">按分镜局部坐标切割，生成独立分镜；间隙透出下方内容。{!leaf && '请选择叶子分镜继续切割。'}{reason}</p>
    <div className="field-grid"><label className="field"><span>比例</span><input aria-label="切割比例" type="number" min="0.01" max="0.99" step="0.01" value={ratio} onChange={(event) => { setRatio(event.target.value); check(showCutPreview(id, spec(event.target.value))); }} /></label><label className="field"><span>间隙 px</span><input aria-label="切割间隙" type="number" min="0" max="256" step="1" value={gap} onChange={(event) => { setGap(event.target.value); check(showCutPreview(id, spec(ratio, event.target.value))); }} /></label></div>
    {error && <p className="hint" role="alert">{error}</p>}
    <div className="button-stack">{(['vertical', 'horizontal'] as const).map((value) => <button key={value} onPointerEnter={() => { if (leaf) { setAxis(value); check(showCutPreview(id, spec(ratio, gap, value))); } }} onFocus={() => { setAxis(value); check(showCutPreview(id, spec(ratio, gap, value))); }} onClick={() => check(commitCut(id, spec(ratio, gap, value)), true)}>{value === 'vertical' ? '垂直切割' : '水平切割'}</button>)}</div>
  </fieldset>;
}
