import { useState } from 'react';
import { useStore } from 'zustand';
import { FocusDialog } from '../app/FocusDialog';
import { firstMessage } from '../domain/types';
import { getDocument } from '../state/documentStore';
import { pushNotice } from '../state/sessionStore';
import { runtimeStore } from '../state/runtimeStore';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { saveFile } from '../storage/fileSave';
import { offlineStore, restartWithOfflineUpdate } from './register';
import { hasUnsavedWorkspaces, hasUnsavedInactiveWorkspaces } from '../projects/workspaces';

export function OfflineUpdate() {
  const waiting = useStore(offlineStore, (state) => state.waiting), [dialog, setDialog] = useState(false), [busy, setBusy] = useState(false), [download, setDownload] = useState<{ epoch: number; stateId: string } | null>(null);
  const restart = async () => { setBusy(true); try { const result = await restartWithOfflineUpdate(); if (!result.ok) pushNotice('error', firstMessage(result)); } finally { setBusy(false); } };
  const save = async () => {
    setBusy(true);
    try {
      const epoch = getDocument().epoch, result = await saveFile(); if (!result.ok) { pushNotice('error', firstMessage(result)); return; }
      const doc = getDocument(); if (doc.epoch !== epoch || doc.history.stateId !== result.value.stateId) { pushNotice('error', '保存期间作品又有修改，请再次保存后重启'); return; }
      if (!result.value.verified) { setDownload({ epoch: doc.epoch, stateId: doc.history.stateId }); return; }
      if (hasUnsavedWorkspaces()) { pushNotice('error', '其他漫画项目仍未保存，请切换标签逐个保存后重启'); return; }
      const restarted = await restartWithOfflineUpdate(); if (!restarted.ok) pushNotice('error', firstMessage(restarted));
    } finally { setBusy(false); }
  };
  if (!waiting && !dialog) return null;
  return <><div className="offline-update" role="status"><span>新版本已就绪</span><button onClick={() => {
    if (runtimeStore.getState().gestureActive) { pushNotice('error', '请先完成或取消当前手势'); return; }
    const edit = finishActiveTextEdit(); if (!edit.ok) { pushNotice('error', firstMessage(edit)); return; } setDownload(null); setDialog(true);
  }}>重启使用新版本</button></div>
    {dialog && <FocusDialog title="重启使用新版本" onCancel={() => { if (!busy) setDialog(false); }}><div className="dialog-heading"><strong>重启使用新版本</strong></div><p>请保存所有漫画项目，或明确放弃全部未保存修改后重启。当前浏览器中的所有漫画标签会一起重启。</p><div className="dialog-actions"><button disabled={busy} onClick={() => setDialog(false)}>取消</button><button disabled={busy} onClick={() => void restart()}>放弃更改并重启</button>{download ? <button disabled={busy} className="primary" onClick={() => { const doc = getDocument(); if (doc.epoch !== download.epoch || doc.history.stateId !== download.stateId) { setDownload(null); pushNotice('error', '下载后作品又有修改，请重新保存'); return; } if (hasUnsavedInactiveWorkspaces()) { pushNotice('error', '请先逐个保存其他漫画项目；下载确认只适用于当前漫画'); return; } void restart(); }}>确认下载已保存并重启</button> : <button disabled={busy} className="primary" onClick={() => void save()}>保存后重启</button>}</div></FocusDialog>}
  </>;
}
