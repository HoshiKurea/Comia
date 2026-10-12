import { useLayoutEffect, useRef, useState } from 'react';
import type { Result } from '../domain/types';
import { pushNotice } from '../state/sessionStore';
import { commitMangaEdit, cancelMangaEdit, currentMangaEdit } from './mangaEditController';

export function reportManga(result:Result<unknown>):void{if(!result.ok)pushNotice('error',result.problems[0].message);}
export function MangaNumber({label,value,apply,min,max,step=1}:{label:string;value:number;apply:(value:number)=>void;min?:number;max?:number;step?:number}){
  const [draft,setDraft]=useState(String(Math.round(value*1000)/1000)),editing=useRef(false),cancelled=useRef(false),dirty=useRef(false);
  useLayoutEffect(()=>{if(!editing.current)setDraft(String(Math.round(value*1000)/1000));},[value]);
  return <label className="field"><span>{label}</span><input aria-label={label} type="number" step={step} min={min} max={max} value={draft} onFocus={()=>{editing.current=true;cancelled.current=false;dirty.current=false;}} onChange={e=>{dirty.current=true;setDraft(e.target.value);}} onBlur={()=>{editing.current=false;if(cancelled.current||!dirty.current)return;dirty.current=false;const n=draft.trim()?Number(draft):NaN;if(!Number.isFinite(n)){pushNotice('error','请输入有限数字');setDraft(String(value));}else if(n!==value)apply(n);}} onKeyDown={e=>{if(e.nativeEvent.isComposing||e.nativeEvent.keyCode===229)return;if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancelled.current=true;editing.current=false;setDraft(String(value));e.currentTarget.blur();}}}/></label>;
}
export function MangaEditButtons(){
  if(!currentMangaEdit())return null;
  return <div className="button-stack manga-edit-buttons"><button onClick={()=>reportManga(commitMangaEdit())}>完成漫画组件编辑</button><button onClick={cancelMangaEdit}>取消漫画组件编辑</button></div>;
}
