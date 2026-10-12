import {useLayoutEffect,useRef,useState,type Dispatch,type SetStateAction} from 'react';
import {COMMANDS,COMMAND_CATEGORIES,type CommandId} from '../commands/catalog';
import {bindingLabel,chordFromEvent,chordReason,effectiveBindings,formatChord,buildShortcutIndex} from '../commands/shortcutBinding';
import type {ShortcutChord} from '../commands/types';
import type {AppPreferences} from './types';
export interface ShortcutCapture {commandId:CommandId;aliasIndex:number;candidate:ShortcutChord|null;reason:string|null}
export function ShortcutEditor({value,change,capture,setCapture,error,clearError}:{value:AppPreferences;change:(value:AppPreferences)=>boolean;capture:ShortcutCapture|null;setCapture:Dispatch<SetStateAction<ShortcutCapture|null>>;error:string;clearError:()=>void}) {
 const cancelCapture=()=>{setCapture(null);clearError();};
 const [search,setSearch]=useState(''),input=useRef<HTMLInputElement>(null),composing=useRef(false);
 useLayoutEffect(()=>{if(capture)input.current?.focus();},[capture?.commandId,capture?.aliasIndex]);
 const update=(id:CommandId,chords:ShortcutChord[]|null)=>{const next=structuredClone(value);if(chords===null)delete next.shortcuts[id];else next.shortcuts[id]=chords;return change(next);};
 const useCandidate=()=>{if(!capture?.candidate||capture.reason)return;const chords=[...effectiveBindings(capture.commandId,value.shortcuts)];chords[capture.aliasIndex]=capture.candidate;if(update(capture.commandId,chords))cancelCapture();};
 const filtered=COMMANDS.filter(c=>`${c.label} ${COMMAND_CATEGORIES[c.category as keyof typeof COMMAND_CATEGORIES]} ${bindingLabel(c.id,value.shortcuts)}`.toLowerCase().includes(search.trim().toLowerCase()));
 return <div className="shortcut-editor"><div className="preferences-search"><input aria-label="搜索命令或快捷键" placeholder="搜索命令或快捷键" value={search} onChange={e=>setSearch(e.target.value)} /><span>{filtered.length} / {COMMANDS.length}</span></div><p className="preferences-help">点击“改键”后按组合，再选择“使用此快捷键”。最多两个组合；清除后该命令不再响应快捷键。</p>
  <div className="shortcut-command-list">{Object.entries(COMMAND_CATEGORIES).map(([category,label])=>{const rows=filtered.filter(c=>c.category===category);return rows.length?<section key={category} aria-label={`${label}快捷键`}><h3>{label}</h3>{rows.map(c=>{const chords=effectiveBindings(c.id,value.shortcuts);return <div key={c.id} className="shortcut-command" data-command={c.id}><div className="shortcut-command-label"><strong>{c.label}</strong><small>{value.shortcuts[c.id]!==undefined?'已自定义':'默认'}</small></div><div className="shortcut-bindings">{chords.length?chords.map((chord,i)=><span className="shortcut-chip" key={i}><kbd>{formatChord(chord)}</kbd><button aria-label={`移除${c.label}快捷键 ${i+1}`} onClick={()=>update(c.id,chords.filter((_,j)=>i!==j))}>×</button></span>):<span className="shortcut-unbound">未绑定</span>}</div><div className="shortcut-actions"><button aria-label={`修改${c.label}快捷键`} onClick={()=>{clearError();setCapture({commandId:c.id,aliasIndex:0,candidate:null,reason:null});}}>改键</button><button aria-label={`添加${c.label}备用快捷键`} disabled={chords.length>=2} onClick={()=>{clearError();setCapture({commandId:c.id,aliasIndex:chords.length,candidate:null,reason:null});}}>＋</button><button aria-label={`恢复${c.label}默认快捷键`} onClick={()=>update(c.id,null)}>默认</button></div>
   {capture?.commandId===c.id&&<div className="shortcut-capture" data-capture-area onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))cancelCapture();}}><input ref={input} readOnly aria-label={`录入${c.label}快捷键`} aria-invalid={!!capture.reason} value={capture.candidate?formatChord(capture.candidate):''} placeholder="按下快捷键组合" onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={e=>{
    if(composing.current||e.nativeEvent.isComposing||e.nativeEvent.keyCode===229||['Process','Dead','AltGraph','Unidentified'].includes(e.key))return;
    if(['Control','Meta','Shift','Alt','Tab','Escape'].includes(e.key))return;
    e.preventDefault();e.stopPropagation();if(e.repeat)return;
    if(e.key==='Enter'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.shiftKey){useCandidate();return;}
    const candidate=chordFromEvent(e.nativeEvent);let reason=candidate?chordReason(candidate):'该按键当前不可配置，请换用字母、数字、F2/F3/F4/F8/F9或Delete/Backspace组合';
    if(candidate&&!reason){const next=structuredClone(value.shortcuts),chords=[...effectiveBindings(c.id,next)];chords[capture.aliasIndex]=candidate;next[c.id]=chords;const result=buildShortcutIndex(next);if(!result.ok)reason=result.problems[0].message;}
    setCapture({...capture,candidate,reason});
   }} /><button disabled={!capture.candidate||!!capture.reason} onPointerDown={e=>e.preventDefault()} onClick={useCandidate}>使用此快捷键</button><button onPointerDown={e=>e.preventDefault()} onClick={cancelCapture}>取消录入</button><span role="status">{capture.reason||error||'Enter使用 · Esc取消本次录入'}</span></div>}
  </div>;})}</section>:null;})}{!filtered.length&&<p className="preferences-empty">没有匹配的命令</p>}
  <section className="protected-shortcuts"><h3>固定基础交互</h3><p>Esc：取消　Ctrl+Enter：完成文字　Space：按住平移</p><p>← / → / ↑ / ↓：微移，Shift加速</p><p>Ctrl＋拖动顶点：单节点；Ctrl＋方向键：节点微调，Shift加速；Alt＋←/→：切换节点；Alt＋单击：选框内素材</p><small>这些交互依赖上下文与按键释放，当前保持固定。</small></section></div></div>;
}
