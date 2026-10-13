import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Page } from '../domain/types';
import { FocusDialog } from '../app/FocusDialog';
import { getDocument } from '../state/documentStore';
import { configurePage } from './commands';
import { createPageSetupDraft, PageSetupFields, PageSetupPreview, resolvePageSetup } from './PageSetupFields';

export function PageSetupDialog({ page, close }: { page: Page; close: () => void }) {
  const [origin] = useState(() => ({ epoch: getDocument().epoch, projectId: getDocument().project.id, page: structuredClone(page) }));
  const [draft, setDraft] = useState(() => createPageSetupDraft(page)), [error, setError] = useState('');
  const result = resolvePageSetup(draft);
  const apply = () => {
    if (!result.ok) return;
    const doc = getDocument(), current = doc.project.pages[origin.page.id];
    const settings = (p: Page | undefined) => p && JSON.stringify([p.width, p.height, p.dpi, p.manuscript]);
    if (doc.epoch !== origin.epoch || doc.project.id !== origin.projectId || settings(current) !== settings(origin.page)) { setError('页面或项目已改变，请关闭设置并重新打开'); return; }
    const configured = configurePage(page.id, result.value, result.value.manuscript);
    if (!configured.ok) setError(configured.problems[0].message); else close();
  };
  return createPortal(<FocusDialog title="漫画原稿设置" className="manuscript-dialog" onCancel={close}>
    <div className="dialog-heading"><strong>{page.name} · 漫画原稿设置</strong></div>
    <form className="new-project-form" onSubmit={e => { e.preventDefault(); apply(); }} onKeyDown={e => { if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)) e.preventDefault(); }}>
      <p>修改尺寸只改变纸张边界，内容的位置和大小保持原值。超出纸张的内容导出时会被裁切。</p>
      <div className="manuscript-layout"><PageSetupFields draft={draft} change={next => { setDraft(next); setError(''); }} prefix="页面" /><PageSetupPreview page={result.ok ? result.value : null} /></div>
      {(error || !result.ok) && <p role="alert">{error || (!result.ok ? result.problems[0].message : '')}</p>}
      <div className="dialog-actions"><button type="button" onClick={close}>取消</button><button className="primary" disabled={!result.ok || !!error} type="submit">应用原稿设置</button></div>
    </form>
  </FocusDialog>, document.body);
}
