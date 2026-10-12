import { useEffect, useRef, useState } from 'react';
import type { BubbleLayer } from '../domain/types';
import { pushNotice } from '../state/sessionStore';
import { setBubbleStyle } from './commands';
import {StrokeBandFields} from './StrokeBandFields';
import {useStore} from 'zustand';
import {mangaEditStore} from './mangaEditController';
import {beginBubbleShapeEdit,updateEditedBubbleStyle} from './shapeController';

function Color({ bubble, field, label }: { bubble: BubbleLayer; field: 'fill' | 'borderColor'; label: string }) {
  const value = bubble.style[field], [draft, setDraft] = useState(value), cancelled = useRef(false), picker = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(value), [value, bubble.id]);
  const apply = (color: string) => { const result = setBubbleStyle(bubble.id, { [field]: color }); if (!result.ok) pushNotice('error', result.problems[0].message); };
  useEffect(() => {
    const node = picker.current; if (!node) return;
    // Native change fires on final acceptance; intermediate input does not enter document history.
    const accepted = () => apply(node.value + value.slice(7)); node.addEventListener('change', accepted);
    return () => node.removeEventListener('change', accepted);
  }, [bubble.id, value]);
  return <div className="panel-style-color"><label className="color-field">{label}<input ref={picker} aria-label={label} type="color" value={value.slice(0, 7)} /></label>
    <label className="field"><span>RGBA</span><input aria-label={`${label}RGBA`} value={draft} onFocus={() => { cancelled.current = false; }} onChange={(event) => setDraft(event.target.value)}
      onBlur={() => { if (!cancelled.current && draft !== value) apply(draft.trim()); setDraft(value); }}
      onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled.current = true; event.currentTarget.blur(); } }} /></label>
  </div>;
}
export function BubbleStyleInspector({ bubble }: { bubble: BubbleLayer }) {
  const active=useStore(mangaEditStore,s=>s.active?.id===bubble.id?s.active:null),source=active?.preview.layers[bubble.id],b=source?.type==='bubble'?source:bubble;
  return <><Color bubble={b} field="fill" label="气泡填充色" /><Color bubble={b} field="borderColor" label="气泡边框色" /><StrokeBandFields style={b.style} update={patch=>{const began=beginBubbleShapeEdit(b.id),r=began.ok?updateEditedBubbleStyle(patch):began;if(!r.ok)pushNotice('error',r.problems[0].message);}}/></>;
}
