import { useState } from 'react';
import { FocusDialog } from '../app/FocusDialog';
import { firstMessage, type Project } from '../domain/types';
import type { PaperPreset } from '../pages/commands';
import { buildNewProject } from './newProject';

export function NewProjectDialog({ busy, create, cancel }: { busy: boolean; create: (project: Project) => void; cancel: () => void }) {
  const [name, setName] = useState('未命名项目'), [preset, setPreset] = useState<PaperPreset>('A4'), [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [width, setWidth] = useState('2480'), [height, setHeight] = useState('3508'), [dpi, setDpi] = useState('300'), [background, setBackground] = useState<'white' | 'transparent'>('white');
  const result = buildNewProject({ name, page: { preset, orientation, widthPx: width.trim() ? Number(width) : NaN, heightPx: height.trim() ? Number(height) : NaN, dpi: dpi.trim() ? Number(dpi) : NaN }, background });
  const page = result.ok ? result.value.pages[result.value.pageOrder[0]] : null;
  const direction = (value: 'portrait' | 'landscape') => {
    if (preset === 'custom' && ((value === 'landscape' && Number(width) < Number(height)) || (value === 'portrait' && Number(width) > Number(height)))) { setWidth(height); setHeight(width); }
    setOrientation(value);
  };
  return <FocusDialog title="新建项目" onCancel={() => { if (!busy) cancel(); }}><div className="dialog-heading"><strong>新建漫画项目</strong></div>
    <form className="new-project-form" onSubmit={event => { event.preventDefault(); if (result.ok && !busy) create(result.value); }} onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }}>
      <p>创建独立漫画并在新标签中打开，当前项目会保留。</p>
      <label>项目名称<input aria-label="新项目名称" value={name} onChange={e => setName(e.target.value)} aria-describedby={!result.ok ? 'new-project-error' : undefined} /></label>
      <label>纸张<select aria-label="新项目纸张" value={preset} onChange={e => { const p = e.target.value as PaperPreset; if (p === 'custom' && page) { setWidth(String(page.width)); setHeight(String(page.height)); } setPreset(p); }}><option value="A4">A4 · 210×297 mm</option><option value="B4-ISO">ISO B4 · 250×353 mm</option><option value="custom">自定义像素</option></select></label>
      <label>方向<select aria-label="新项目方向" value={orientation} onChange={e => direction(e.target.value as 'portrait' | 'landscape')}><option value="portrait">纵向</option><option value="landscape">横向</option></select></label>
      <div className="new-project-dimensions"><label>宽 px<input aria-label="新项目宽度" type="number" min="16" max="16384" readOnly={preset !== 'custom'} value={preset === 'custom' ? width : page?.width ?? ''} onChange={e => setWidth(e.target.value)} /></label><label>高 px<input aria-label="新项目高度" type="number" min="16" max="16384" readOnly={preset !== 'custom'} value={preset === 'custom' ? height : page?.height ?? ''} onChange={e => setHeight(e.target.value)} /></label></div>
      <label>DPI<input aria-label="新项目 DPI" type="number" min="72" max="600" value={dpi} onChange={e => setDpi(e.target.value)} /></label>
      <label>页面背景<select aria-label="新项目背景" value={background} onChange={e => setBackground(e.target.value as 'white' | 'transparent')}><option value="white">纯白色</option><option value="transparent">透明</option></select></label>
      {!result.ok && <p id="new-project-error" role="alert">{firstMessage(result)}</p>}
      <div className="dialog-actions"><button type="button" disabled={busy} onClick={cancel}>取消</button><button className="primary" type="submit" disabled={busy || !result.ok}>{busy ? '正在创建…' : '创建项目'}</button></div>
    </form></FocusDialog>;
}
