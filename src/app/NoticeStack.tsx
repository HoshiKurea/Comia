import { useEffect } from 'react';
import { useStore } from 'zustand';
import { documentStore } from '../state/documentStore';
import { dismissNotice, sessionStore, setSelection, type Notice } from '../state/sessionStore';

function returnToEditing(notice: Notice): void {
  const doc = documentStore.getState();
  if (doc.epoch !== notice.epoch) { dismissNotice(notice.id); return; }
  const target = notice.targetId ? doc.project.layers[notice.targetId] : null;
  if (target) { sessionStore.setState({ activePageId: target.pageId }); setSelection([target.id]); }
  requestAnimationFrame(() => {
    if (documentStore.getState().epoch !== notice.epoch) return;
    const control = target ? document.querySelector<HTMLElement>('.inspector-edit input:not(:disabled),.inspector-edit select:not(:disabled),.inspector-edit textarea:not(:disabled)') : null;
    (control ?? document.querySelector<HTMLElement>('.canvas-viewport'))?.focus();
  });
  dismissNotice(notice.id);
}

export function NoticeStack() {
  const notices = useStore(sessionStore, (s) => s.notices), epoch = useStore(documentStore, (s) => s.epoch);
  useEffect(() => { for (const notice of sessionStore.getState().notices) if (notice.epoch !== epoch) dismissNotice(notice.id); }, [epoch]);
  return <div className="notice-stack">{notices.filter((n) => n.epoch === epoch).map((notice) => <div key={notice.id} role={notice.kind === 'error' ? 'alert' : 'status'} className={`notice ${notice.kind}`}>
    {notice.objectName && <strong className="notice-object">对象：{notice.objectName}</strong>}
    <span className="notice-message">{notice.message}</span>
    <div className="notice-actions">{notice.kind === 'error' && <button onClick={() => {
      if (documentStore.getState().epoch !== notice.epoch) { dismissNotice(notice.id); return; }
      if (notice.action) { dismissNotice(notice.id); void notice.action.run(); } else returnToEditing(notice);
    }}>{notice.action?.label ?? '返回编辑'}</button>}<button aria-label="关闭提示" onClick={() => { returnToEditing(notice); }}>关闭</button></div>
  </div>)}</div>;
}
