import { expect, it } from 'vitest';
import { createLayer, createProject } from '../../src/domain/factories';
import type { BubbleLayer, TextLayer } from '../../src/domain/types';
import { resolveBubbleTextFrame } from '../../src/text/bubbleTextFrame';

const measure={measureText(s:string){const width=Array.from(s).reduce((n,c)=>n+(c==='i'?4:c===' '?5:10),0);return{width,actualBoundingBoxAscent:8,actualBoundingBoxDescent:2,actualBoundingBoxLeft:0,actualBoundingBoxRight:width} as TextMetrics;}};
function fixture(content='你们好啊'){
  const p=createProject(),pid=p.pageOrder[0],bubble=createLayer('bubble',pid) as BubbleLayer,text=createLayer('text',pid) as TextLayer;
  text.parentId=bubble.id;text.text={...text.text,content,font:{...text.text.font,size:10},lineHeight:1,align:'center'};text.bubbleFrame={mode:'auto',manualSize:null,placement:'center'};bubble.children=[text.id];p.layers[bubble.id]=bubble;p.layers[text.id]=text;p.pages[pid].roots.push(bubble.id);return{p,bubble,text};
}
it.each([['你们好啊',40],['你们好',30],['大家中文好后',60],['Hi',14],['Hello',50]])('fits actual advances for %s and centers the complete ink block', (content,width)=>{
  const{p,text}=fixture(content),r=resolveBubbleTextFrame(p,text.id,measure,'sans-serif');if(!r.ok)throw Error('resolve');
  expect(r.value.box.width).toBe(width);expect(r.value.inkBounds.x+r.value.inkBounds.width/2).toBeCloseTo(150,8);expect(r.value.inkBounds.y+r.value.inkBounds.height/2).toBeCloseTo(90,8);expect(r.value.layout.runs).toHaveLength(1);expect(text.text.content).toBe(content);
});
it('wraps English at word boundaries, preserves spaces/UTF16 indices and never scales the font',()=>{
  const{p,text}=fixture('Hello world');text.bubbleFrame={mode:'manual',manualSize:{width:55,height:40},placement:'center'};
  const r=resolveBubbleTextFrame(p,text.id,measure,'sans-serif');if(!r.ok)throw Error('resolve');expect(r.value.box.width).toBe(55);expect(r.value.box.height).toBe(40);expect(r.value.layout.runs.map(r=>r.paintText)).toEqual(['Hello','world']);expect(r.value.layout.runs.map(r=>[r.startUTF16,r.endUTF16])).toEqual([[0,6],[6,11]]);expect(text.text.content).toBe('Hello world');expect(text.text.font.size).toBe(10);expect(r.value.inkBounds.y+r.value.inkBounds.height/2).toBe(90);
});
it('keeps empty/whitespace input editable and preserves an overflowing long word',()=>{
  for(const s of ['', '   ']){const f=fixture(s),r=resolveBubbleTextFrame(f.p,f.text.id,measure,'sans-serif');expect(r.ok).toBe(true);if(r.ok){expect(r.value.box.width).toBeGreaterThanOrEqual(10);expect(r.value.box.height).toBeGreaterThanOrEqual(10);expect(r.value.layout.caretStops.length).toBeGreaterThan(0);}}
  const f=fixture('Longword');f.text.bubbleFrame={mode:'manual',manualSize:{width:25,height:10},placement:'center'};const r=resolveBubbleTextFrame(f.p,f.text.id,measure,'sans-serif');if(!r.ok)throw Error('resolve');expect(r.value.layout.runs.map(r=>r.text).join('')).toBe('Longword');expect(r.value.overflow).toBe(true);
});
it('does not invent new wrapping for auto mode and re-centers explicit multiple lines',()=>{
  const f=fixture('AB\nCD'),r=resolveBubbleTextFrame(f.p,f.text.id,measure,'sans-serif');if(!r.ok)throw Error('resolve');expect(r.value.layout.runs).toHaveLength(2);expect(r.value.box.width).toBe(20);expect(r.value.inkBounds.y+r.value.inkBounds.height/2).toBe(90);
  f.text.text.content='A'.repeat(100);const long=resolveBubbleTextFrame(f.p,f.text.id,measure,'sans-serif');if(!long.ok)throw Error('long');expect(long.value.layout.runs).toHaveLength(1);expect(long.value.overflow).toBe(true);expect(f.bubble.width).toBe(300);
});
it('preserves the previous authored position when legacy mode is active',()=>{
  const f=fixture();f.text.bubbleFrame={mode:'manual',manualSize:{width:200,height:90},placement:'legacy'};f.text.box={x:7,y:19,width:200,height:90};const r=resolveBubbleTextFrame(f.p,f.text.id,measure,'sans-serif');if(!r.ok)throw Error('legacy');expect(r.value.box).toEqual(f.text.box);expect(r.value.layout.runs[0].origin.y).toBe(19);
});
it('moves vertical glyphs, caret stops and columns together and never splits emoji graphemes',()=>{
  const f=fixture('你们好');f.text.text.direction='vertical';const r=resolveBubbleTextFrame(f.p,f.text.id,{measureText(s){return{width:s.length*10} as TextMetrics;}},'sans-serif');if(!r.ok)throw Error('vertical');expect(r.value.layout.runs).toHaveLength(1);expect(r.value.inkBounds.x+r.value.inkBounds.width/2).toBeCloseTo(150);expect(r.value.inkBounds.y+r.value.inkBounds.height/2).toBeCloseTo(90);expect(r.value.layout.caretStops.at(-1)!.indexUTF16).toBe(3);
  const e=fixture('你👨‍👩‍👧‍👦好');const emoji=resolveBubbleTextFrame(e.p,e.text.id,measure,'sans-serif');if(!emoji.ok)throw Error('emoji');expect(emoji.value.layout.runs[0].cells).toHaveLength(3);
});
