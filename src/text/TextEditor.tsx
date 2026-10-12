import { FloatingEditPanel } from '../app/FloatingEditPanel';
import { useEffect, useRef, useState } from 'react';
import type { Id, Project, Viewport } from '../domain/types';
import { apply, screenMatrix } from '../geometry/matrix';
import { runtimeStore } from '../state/runtimeStore';
import { pushNotice } from '../state/sessionStore';
import { layoutText } from './layout';
import { fontCss, actualFont } from './fonts';
import { resolveBubbleTextFrame } from './bubbleTextFrame';
import { caretAt, hitCaret, selectionRects } from './selection';
import { registerTextPointer } from './editorPointer';
import { clipTextOverlay } from './overlayClip';
import { beginTextEdit, cancelTextEdit, commitTextEdit, currentTextEdit, setTextComposing, textEditStore, updateTextInput, updateTextSelection } from './editController';
import type { ActiveTextEdit } from './editController';
import { compileEffectText, effectCaretAt, hitEffectCaret } from './effects';
export { beginTextEdit, commitTextEdit, cancelTextEdit };
import './editor.css';

/** Real, focusable textarea owns native clipboard/undo/IME; all glyph positions come from shared layout. */
export function TextEditor({ project, id, viewport, size }: { project: Project; id: Id; viewport: Viewport; size: { width: number; height: number } }) {
  const input = useRef<HTMLTextAreaElement>(null), overlay = useRef<HTMLCanvasElement>(null);
  const visibleRef = useRef(false), frame = useRef<number | null>(null), anchor = useRef<{ id: number; index: number } | null>(null);
  const [visibleInput, setVisibleInput] = useState(false), [overflow, setOverflow] = useState(false);
  const settings = useRef({ project, viewport, size }); settings.current = { project, viewport, size };
  useEffect(() => {
    const node = input.current!, canvas = overlay.current!, ctx = canvas.getContext('2d')!;
    let blinkOn = true;
    let paintedSelection = '';
    const notify = (result: ReturnType<typeof commitTextEdit>) => { if (!result.ok) pushNotice('error', result.problems[0].message); };
    const layout = (edit: ActiveTextEdit) => {
      const layer = edit.preview.layers[id];
      if (layer.type !== 'text') throw new Error('文字编辑目标无效');
      ctx.font = fontCss(edit.draft.font.family, edit.draft.font.size, edit.draft.font.bold, edit.draft.font.italic);
      const frame=layer.bubbleFrame?.placement==='center'?resolveBubbleTextFrame(edit.preview,id,ctx,actualFont(edit.draft.font.family)):null;
      if(frame&&!frame.ok)throw Error(frame.problems[0].message);
      const font=ctx.font,value=frame?.ok?frame.value.layout:layoutText(edit.draft,layer.box,ctx);
      const glyphFonts=new Map<string,string>();for(const run of value.runs)for(const cell of run.cells)if(cell.fontFamily)glyphFonts.set(cell.fontFamily,fontCss(cell.fontFamily,edit.draft.font.size,edit.draft.font.bold,edit.draft.font.italic));
      return { layer, value, effect:layer.role==='sfx'&&layer.effects?compileEffectText(layer,value,font,glyphFonts,ctx):null };
    };
    const paint = () => {
      frame.current = null;
      const edit = currentTextEdit(); if (!edit || edit.layerId !== id) return;
      const { value, effect } = layout(edit), { size, viewport } = settings.current;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.ceil(size.width * ratio) || canvas.height !== Math.ceil(size.height * ratio)) { canvas.width = Math.ceil(size.width * ratio); canvas.height = Math.ceil(size.height * ratio); }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, size.width, size.height);
      const m = screenMatrix(edit.preview, id, viewport);
      ctx.save(); clipTextOverlay(ctx, edit.preview, id, viewport, value.frameBox, value.safeClipBox);
      ctx.fillStyle = '#5298e755';
      if(effect&&!effect.legacy)for(const glyph of effect.glyphs.filter(g=>g.startUTF16<edit.selectionEnd&&g.endUTF16>edit.selectionStart)){ctx.beginPath();glyph.selection.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill();}
      else for (const rect of selectionRects(value, edit.selectionStart, edit.selectionEnd, edit.draft.direction === 'vertical')) ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      const cursor = edit.selectionDirection === 'backward' ? edit.selectionStart : edit.selectionEnd;
      const stop = caretAt(value, cursor), vertical = edit.draft.direction === 'vertical';
      const effectStop=effect&&!effect.legacy?effectCaretAt(effect,cursor):null;
      if (edit.selectionStart === edit.selectionEnd && (blinkOn || edit.composing)) {
        ctx.strokeStyle = '#2679c9'; ctx.lineWidth = 1.5 / Math.max(0.05, Math.hypot(m[0], m[1])); ctx.beginPath();
        if(effectStop){ctx.moveTo(effectStop.a.x,effectStop.a.y);ctx.lineTo(effectStop.b.x,effectStop.b.y);}
        else if (vertical) { ctx.moveTo(stop.x - stop.extent / 2, stop.y); ctx.lineTo(stop.x + stop.extent / 2, stop.y); }
        else { ctx.moveTo(stop.x, stop.y); ctx.lineTo(stop.x, stop.y + stop.extent); }
        ctx.stroke();
      }
      ctx.restore();
      const at = apply(m, effectStop?.b??{ x: stop.x, y: stop.y + (vertical ? 0 : stop.extent) });
      // A visible alternative stays near the text, with readable input independent of page zoom.
      const width = visibleRef.current ? Math.min(360, Math.max(120, size.width - 24)) : 160;
      node.style.left = `${Math.max(8, Math.min(at.x, size.width - width - 8))}px`;
      node.style.top = `${Math.max(8, Math.min(at.y, size.height - (visibleRef.current ? 120 : 32) - 8))}px`;
      node.style.width = `${width}px`;
      node.style.font = fontCss(edit.draft.font.family, Math.min(32, Math.max(14, edit.draft.font.size * viewport.zoom)), edit.draft.font.bold, edit.draft.font.italic);
      if (!edit.composing && node.value !== edit.draft.content) node.value = edit.draft.content;
      // Native selection can change before WebKit dispatches select/input. Never
      // restore an older model selection over a focused textarea's native edit.
      // Canvas pointer selection is applied synchronously in the pointer handler.
      const selection = `${edit.selectionStart}:${edit.selectionEnd}:${edit.selectionDirection}`;
      if (!edit.composing && document.activeElement !== node && selection !== paintedSelection && (node.selectionStart !== edit.selectionStart || node.selectionEnd !== edit.selectionEnd || node.selectionDirection !== edit.selectionDirection)) node.setSelectionRange(edit.selectionStart, edit.selectionEnd, edit.selectionDirection);
      paintedSelection = selection;
      setOverflow(value.overflow);
    };
    const schedule = () => { if (frame.current === null) frame.current = requestAnimationFrame(paint); };
    const unsubscribe = textEditStore.subscribe(() => { blinkOn = true; schedule(); });
    const fonts = runtimeStore.subscribe((next, old) => { if (next.fontGeneration !== old.fontGeneration) schedule(); });
    const pointer = registerTextPointer(({ point, phase, pointerId, shift }) => {
      const edit = currentTextEdit(); if (!edit || edit.composing || edit.layerId !== id) return;
      const prepared=layout(edit),index=prepared.effect&&!prepared.effect.legacy?hitEffectCaret(prepared.effect,point):hitCaret(prepared.value, point, edit.draft.direction === 'vertical');
      if (phase === 'down') { anchor.current = { id: pointerId, index: shift ? (edit.selectionDirection === 'backward' ? edit.selectionEnd : edit.selectionStart) : index }; node.focus({ preventScroll: true }); }
      if ((phase === 'down' || phase === 'move') && anchor.current?.id === pointerId) {
        const start = anchor.current.index;
        updateTextSelection(Math.min(start, index), Math.max(start, index), index < start ? 'backward' : 'forward');
        node.setSelectionRange(Math.min(start, index), Math.max(start, index), index < start ? 'backward' : 'forward');
      }
      if (phase === 'up' || phase === 'cancel') anchor.current = null;
    });
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-text-edit-preserve],.canvas-viewport')) return;
      const result = commitTextEdit();
      if (!result.ok) { event.preventDefault(); event.stopPropagation(); notify(result); }
    };
    document.addEventListener('pointerdown', outside, true);
    const timer = setInterval(() => { blinkOn = !blinkOn; schedule(); }, 530);
    const edit = currentTextEdit(); if (edit) node.value = edit.draft.content;
    node.focus({ preventScroll: true });
    if (edit) { node.setSelectionRange(edit.selectionStart, edit.selectionEnd, edit.selectionDirection); paintedSelection = `${edit.selectionStart}:${edit.selectionEnd}:${edit.selectionDirection}`; }
    schedule();
    return () => {
      unsubscribe(); fonts(); pointer(); clearInterval(timer); document.removeEventListener('pointerdown', outside, true);
      if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null;
      canvas.width = canvas.height = 0;
    };
  }, [id]);
  useEffect(() => { textEditStore.setState((state) => ({ ...state })); }, [project, viewport, size, visibleInput]);
  const sync = (node: HTMLTextAreaElement) => updateTextSelection(node.selectionStart, node.selectionEnd, node.selectionDirection);
  const finish = (commit: boolean) => { const result = commit ? commitTextEdit() : cancelTextEdit(); if (!result.ok) pushNotice('error', result.problems[0].message);else document.querySelector<HTMLElement>('.canvas-viewport')?.focus({preventScroll:true}); };
  return <div className="canvas-text-editor" data-text-edit-preserve>
    <canvas ref={overlay} className="text-selection-overlay" style={{ width: size.width, height: size.height }} aria-hidden="true" />
    <textarea ref={input} className={`canvas-text-input ${visibleInput ? 'visible-input' : ''}`} aria-label="编辑文字内容" spellCheck={false}
      onChange={(event) => { const node = event.currentTarget; const content = updateTextInput(node.value, node.selectionStart, node.selectionEnd, node.selectionDirection); if (node.value !== content) { node.value = content; const edit = currentTextEdit(); if (edit) node.setSelectionRange(edit.selectionStart, edit.selectionEnd); } }}
      onSelect={(event) => sync(event.currentTarget)}
      onCompositionStart={() => setTextComposing(true)}
      onCompositionEnd={(event) => { const node = event.currentTarget; setTextComposing(false); const value = updateTextInput(node.value, node.selectionStart, node.selectionEnd, node.selectionDirection); if (node.value !== value) node.value = value; }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || currentTextEdit()?.composing || event.key === 'Process' || event.nativeEvent.keyCode === 229) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); finish(true); }
      }} />
    <FloatingEditPanel title="编辑文字"><div className="text-edit-actions">{overflow && <span role="status">文字溢出 · 内容保留</span>}<button onClick={() => { visibleRef.current = !visibleRef.current; setVisibleInput(visibleRef.current); input.current?.focus({ preventScroll: true }); }}>{visibleInput ? '隐藏编辑输入' : '显示编辑输入'}</button><span>Ctrl / Cmd + Enter 完成</span><button aria-label="取消文字编辑" onClick={() => finish(false)}>取消</button><button onClick={() => finish(true)}>完成</button></div></FloatingEditPanel>
    {visibleInput && <span className="text-input-caption">编辑输入 · 画布同步显示最终排版</span>}
  </div>;
}
