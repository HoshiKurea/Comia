import { currentTextEdit, textEditStore } from '../../src/text/editController';
import { getDocument } from '../../src/state/documentStore';
import '../../src/main';

// Explicit test page only. Observe native events without preventing them,
// changing focus, modifying a draft, or sending information to a server.
const records: Record<string, unknown>[] = [];
const targetName = (target: EventTarget | null) => target instanceof HTMLElement
  ? { tag: target.tagName, label: target.getAttribute('aria-label') ?? target.textContent?.slice(0, 40), classes: target.className }
  : null;
const details = document.createElement('details');
details.dataset.textEditPreserve = '';
details.style.cssText = 'position:fixed;left:8px;bottom:4px;z-index:100;width:min(620px,94vw);max-height:220px;overflow:auto;background:#fff;color:#222;border:1px solid #999;font:12px monospace;padding:4px';
const summary = document.createElement('summary'); summary.textContent = '输入法诊断（仅本页记录，不自动上传）';
const help = document.createElement('p'); help.textContent = '用新建的测试文字复现异常；展开后可下载记录。此页不证明系统候选窗已通过验收。';
const download = document.createElement('button'); download.textContent = '下载诊断 JSON';
const output = document.createElement('pre'); output.style.whiteSpace = 'pre-wrap';
details.append(summary, help, download, output); document.body.append(details);
const record = (data: Record<string, unknown>) => {
  const edit = currentTextEdit(), doc = getDocument();
  records.push({ ms: Math.round(performance.now()), ...data, focus: targetName(document.activeElement), editing: Boolean(edit), composing: edit?.composing ?? false, draftLength: edit?.draft.content.length, historyLength: doc.history.past.length });
  if (records.length > 240) records.shift();
  output.textContent = JSON.stringify(records.slice(-18), null, 2);
};
record({ type: 'start', href: location.href, userAgent: navigator.userAgent, controller: navigator.serviceWorker?.controller?.scriptURL ?? null, scope: 'Actual local event observations; OS candidate UI still requires human observation' });
for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input', 'keydown', 'keyup', 'focusin', 'focusout', 'pointerdown', 'click']) {
  document.addEventListener(type, (event) => {
    if (event.target instanceof Node && details.contains(event.target)) return;
    const keyboard = event instanceof KeyboardEvent ? { key: event.key, code: event.code, keyCode: event.keyCode, ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey, isComposing: event.isComposing } : {};
    const input = event instanceof InputEvent ? { inputType: event.inputType, isComposing: event.isComposing, dataLength: event.data?.length } : {};
    record({ type, trusted: event.isTrusted, target: targetName(event.target), ...keyboard, ...input });
    if (type === 'keydown') queueMicrotask(() => record({ type: 'after-keydown', prevented: event.defaultPrevented, ...keyboard }));
  }, true);
}
textEditStore.subscribe((next, old) => {
  if (next.active?.layerId !== old.active?.layerId || next.active?.composing !== old.active?.composing) record({ type: 'edit-session-change', previouslyEditing: Boolean(old.active) });
});
download.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'comia-ime-diagnostic.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
