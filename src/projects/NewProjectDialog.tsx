import { useState } from 'react';
import { FocusDialog } from '../app/FocusDialog';
import { firstMessage, type Project } from '../domain/types';
import { createPageSetupDraft, PageSetupFields, PageSetupPreview, resolvePageSetup } from '../pages/PageSetupFields';
import { DEFAULT_COMIC_PAGE_COUNT } from '../pages/manuscript';
import { exportAvailability } from '../export/exportFiles';
import { buildNewProject } from './newProject';

export function NewProjectDialog({ busy, create, cancel }: { busy: boolean; create: (project: Project) => void; cancel: () => void }) {
  const [name, setName] = useState('未命名项目'), [draft, setDraft] = useState(createPageSetupDraft);
  const [count, setCount] = useState(String(DEFAULT_COMIC_PAGE_COUNT)), [direction, setDirection] = useState<'rtl' | 'ltr'>('rtl');
  const [background, setBackground] = useState<'white' | 'transparent'>('white'), [paperColor, setPaperColor] = useState('#ffffff');
  const size = resolvePageSetup(draft);
  const result = size.ok ? buildNewProject({ name, page: { preset: 'custom', orientation: 'portrait', widthPx: size.value.width, heightPx: size.value.height, dpi: size.value.dpi },
    manuscript: size.value.manuscript, pageCount: count.trim() ? Number(count) : NaN, readingDirection: direction, background, paperColor: `${paperColor.toUpperCase()}FF` as import('../domain/types').RGBA }) : size;
  const page = result.ok ? result.value.pages[result.value.pageOrder[0]] : null;
  const png = result.ok ? exportAvailability(result.value, [result.value.pageOrder[0]], 'png', 1) : null;
  return <FocusDialog title="新建项目" className="manuscript-dialog" onCancel={() => { if (!busy) cancel(); }}><div className="dialog-heading"><strong>新建漫画项目</strong></div>
    <form className="new-project-form" onSubmit={event => { event.preventDefault(); if (result.ok && !busy) create(result.value); }} onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }}>
      <p>创建独立漫画并在新标签中打开，当前项目会保留。</p>
      <label>项目名称<input aria-label="新项目名称" value={name} onChange={e => setName(e.target.value)} aria-describedby={!result.ok ? 'new-project-error' : undefined} /></label>
      <div className="manuscript-project-options">
        <label>页数<input aria-label="新项目页数" type="number" min="1" max="100" step="1" value={count} onChange={e => setCount(e.target.value)} /></label>
        <label>阅读方向<select aria-label="新项目阅读方向" value={direction} onChange={e => setDirection(e.target.value as 'rtl' | 'ltr')}><option value="rtl">右到左（日式）</option><option value="ltr">左到右</option></select></label>
        <label>纸张颜色<select aria-label="新项目背景" value={background} onChange={e => setBackground(e.target.value as 'white' | 'transparent')}><option value="white">纸张颜色</option><option value="transparent">透明</option></select></label>
        {background === 'white' && <label>颜色<input aria-label="新项目纸张颜色" type="color" value={paperColor} onChange={e => setPaperColor(e.target.value)} /></label>}
      </div>
      <div className="manuscript-layout"><PageSetupFields draft={draft} change={setDraft} prefix="新项目" /><PageSetupPreview page={page} notice={png && !png.ok ? '整页1×导出超过当前384 MiB内存预算。可明确选择0.5×导出，或降低DPI；不会自动降采样。' : undefined} /></div>
      {!result.ok && <p id="new-project-error" role="alert">{firstMessage(result)}</p>}
      <div className="dialog-actions"><button type="button" disabled={busy} onClick={cancel}>取消</button><button className="primary" type="submit" disabled={busy || !result.ok}>{busy ? '正在创建…' : '创建项目'}</button></div>
    </form></FocusDialog>;
}
