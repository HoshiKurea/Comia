import { useLayoutEffect, useRef, useState } from 'react';
import type { Result } from '../domain/types';
import { getDocument } from '../state/documentStore';
import { isInputComposing, isPanelRelocating } from '../workspacePanels/panelInteraction';
import './rangeNumber.css';

/** Numeric half of a paired slider: preserves each feature's existing preview owner. */
export function RangeNumberValue({label,value,min,max,step=1,unit='',disabled=false,apply}:{label:string;value:number|undefined;min:number;max:number;step?:number;unit?:string;disabled?:boolean;apply:(n:number)=>Result<unknown>|void}) {
  const display=(n:number|undefined)=>n===undefined?'':String(Math.round(n*1000)/1000);
  const [draft,setDraft]=useState(display(value)),[error,setError]=useState('');
  const focused=useRef(false),dirty=useRef(false),cancelled=useRef(false),owner=useRef<{epoch:number;stateId:string}|null>(null),composition=useRef(false);
  useLayoutEffect(()=>{if(!focused.current){setDraft(display(value));setError('');}},[value]);
  const submit=()=>{
    if(isPanelRelocating())return;focused.current=false;if(cancelled.current||!dirty.current)return;
    const doc=getDocument();if(owner.current?.epoch!==doc.epoch||owner.current.stateId!==doc.history.stateId){setError('作品已变化，请重新输入');return;}
    const n=draft.trim()?Number(draft):NaN;
    if(!Number.isFinite(n)||n<min||n>max){setError(`请输入 ${min}～${max}${unit} 的有限数值`);return;}
    if(n!==value){const result=apply(n);if(result&&!result.ok){setError(result.problems[0].message);return;}}
    dirty.current=false;setError('');
  };
  return <span className="range-number"><input type="number" aria-label={`${label}数值`} aria-invalid={!!error} placeholder="—" min={min} max={max} step={step} value={draft} disabled={disabled}
    onFocus={()=>{focused.current=true;cancelled.current=false;const d=getDocument();owner.current={epoch:d.epoch,stateId:d.history.stateId};}}
    onChange={e=>{dirty.current=true;setDraft(e.target.value);setError('');}} onBlur={submit}
    onCompositionStart={()=>{composition.current=true;}} onCompositionEnd={()=>{composition.current=false;}}
    onKeyDown={e=>{if(composition.current||e.nativeEvent.isComposing||e.nativeEvent.keyCode===229||isInputComposing())return;if(e.key==='Enter'){e.preventDefault();submit();if(!error)e.currentTarget.blur();}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancelled.current=true;dirty.current=false;setDraft(display(value));setError('');e.currentTarget.blur();}}}/><span className="range-unit">{unit}</span>{error&&<span className="range-number-error" role="alert">{error}</span>}</span>;
}
