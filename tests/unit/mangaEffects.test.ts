import { beforeEach, afterEach, expect, it } from 'vitest';
import { createProject, createLayer } from '../../src/domain/factories';
import type { TextLayer } from '../../src/domain/types';
import { replaceDocument, undo, redo } from '../../src/history/commandBus';
import { getDocument, getProject } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';
import { BASE_SFX_EFFECTS, SFX_PRESETS, applySfxPreset, setTextEffects } from '../../src/text/sfxPresets';
import { beginSfxTextEdit, cancelTextEdit, commitTextEdit, currentTextEdit, setTextComposing, updateTextInput, updateTextStyleDraft } from '../../src/text/editController';
import { compileEffectText, effectCaretAt, hitEffectCaret } from '../../src/text/effects';
import { graphemes, layoutHorizontal, layoutVertical } from '../../src/text/layout';
import { apply } from '../../src/geometry/matrix';
import { createObjectDraft } from '../../src/app/actions';
import { componentCategories } from '../../src/library/componentCatalog';
let layer:TextLayer;
beforeEach(()=>{cancelTextEdit();const p=createProject({background:false}),id=p.pageOrder[0];layer=createLayer('text',id) as TextLayer;layer.role='sfx';layer.effects={...BASE_SFX_EFFECTS};layer.text.content='自己的台词';p.layers[layer.id]=layer;p.pages[id].roots=[layer.id];expect(replaceDocument(p).ok).toBe(true);sessionStore.setState({activePageId:id});});afterEach(cancelTextEdit);
it.each(SFX_PRESETS.map(p=>p.id))('applies %s without replacing content or font, commits content/style/effects as one reversible change',id=>{
  const before=getProject();expect(applySfxPreset(layer.id,id).ok).toBe(true);expect(currentTextEdit()!.draft.content).toBe('自己的台词');expect(currentTextEdit()!.draft.font).toEqual(layer.text.font);updateTextInput('ドン😀',5,5);expect(updateTextStyleDraft({font:{size:72},direction:'vertical'}).ok).toBe(true);expect(getProject()).toBe(before);expect(getDocument().history.past).toHaveLength(0);expect(commitTextEdit().ok).toBe(true);expect(getDocument().history.past).toHaveLength(1);const after=getProject();expect((after.layers[layer.id] as TextLayer).text.font.size).toBe(72);undo();expect(getProject()).toEqual(before);redo();expect(getProject()).toEqual(after);
});
it('preserves composition during effects edits and refuses commit, invalid parameters and plain targets',()=>{beginSfxTextEdit(layer.id);setTextComposing(true);updateTextInput('ni',2,2);expect(setTextEffects(layer.id,{shearDeg:12}).ok).toBe(true);expect(currentTextEdit()!.composing).toBe(true);expect(commitTextEdit().ok).toBe(false);const prior=currentTextEdit()!.draftEffects;expect(setTextEffects(layer.id,{amount:Infinity}).ok).toBe(false);expect(currentTextEdit()!.draftEffects).toEqual(prior);cancelTextEdit();expect(getProject().layers[layer.id]).toEqual(layer);});
const measure={measureText:(text:string)=>({width:graphemes(text).length*20,actualBoundingBoxLeft:0,actualBoundingBoxRight:graphemes(text).length*20,actualBoundingBoxAscent:16,actualBoundingBoxDescent:4}) as TextMetrics};
const context=()=>({save(){},restore(){},...measure,font:'',textAlign:'',textBaseline:''}) as unknown as CanvasRenderingContext2D;
it.each(['arc','wave','impact'] as const)('uses independent matrix formulas for %s without splitting ZWJ or combining marks',deformation=>{
  layer.text.font.size=20;layer.text.lineHeight=1;layer.text.content='A👩‍🚀é';layer.box={x:0,y:0,width:200,height:100};layer.effects={...BASE_SFX_EFFECTS,deformation,amount:.35,shearDeg:12,cycles:2};const layout=layoutHorizontal(layer.text,layer.box,measure),prepared=compileEffectText(layer,layout,'20px test',new Map(),context());expect(prepared.glyphs.map(g=>g.glyph)).toEqual(['A','👩‍🚀','é']);
  const cell=prepared.glyphs[0],u=1/6,A=7,L=60,anchor={x:10,y:16};let dy=0,theta=0,sx=1,sy=1;if(deformation==='arc'){dy=A*(4*(u-.5)**2-1);theta=Math.atan2(8*A*(u-.5),L);}if(deformation==='wave'){dy=A*Math.sin(4*Math.PI*u);theta=Math.atan2(4*Math.PI*A*Math.cos(4*Math.PI*u),L);}if(deformation==='impact'){sy=1+.35*(2*u-1);sx=1+.175*(2*u-1);}
  const p={x:cell.drawOrigin.x-anchor.x,y:cell.drawOrigin.y-anchor.y},rx=Math.cos(theta)*p.x*sx-Math.sin(theta)*p.y*sy,ry=Math.sin(theta)*p.x*sx+Math.cos(theta)*p.y*sy,actual=apply(cell.localMatrix,cell.drawOrigin);expect(actual.x).toBeCloseTo(anchor.x+rx+Math.tan(12*Math.PI/180)*ry,10);expect(actual.y).toBeCloseTo(anchor.y+dy+ry,10);expect(cell.inkBounds.width).toBeGreaterThan(0);
  const caret=effectCaretAt(prepared,1);expect(hitEffectCaret(prepared,{x:(caret.a.x+caret.b.x)/2,y:(caret.a.y+caret.b.y)/2})).toBe(1);
});
it('keeps empty and vertical layouts usable, applies rotated glyph font and bounds outside the box',()=>{layer.effects={...BASE_SFX_EFFECTS,deformation:'arc',amount:.45,shearDeg:60};layer.text.direction='vertical';layer.text.content='AB';layer.box={x:0,y:0,width:20,height:80};layer.text.font.size=20;const layout=layoutVertical(layer.text,layer.box,g=>({glyph:g,rotation:Math.PI/2,fontFamily:'mapped'})),p=compileEffectText(layer,layout,'base',new Map([['mapped','mappedFont']]),context());expect(p.glyphs.every(g=>g.font==='mappedFont')).toBe(true);expect(p.bounds.width).toBeGreaterThan(layer.box.width);layer.text.content='';const empty=compileEffectText(layer,layoutHorizontal(layer.text,layer.box,measure),'base',new Map(),context());expect(empty.glyphs).toHaveLength(0);expect(effectCaretAt(empty,0).indexUTF16).toBe(0);});
it('creates every new catalog item as real data, including independent SFX text and six tail types',()=>{for(const category of componentCategories({}).filter(c=>['emotion-bubbles','bubble-tails','effect-text'].includes(c.id)))for(const item of category.items){const r=createObjectDraft(item.kind,layer.pageId);expect(r.ok).toBe(true);if(!r.ok)throw Error(JSON.stringify(r));if(category.id==='effect-text')expect(r.value.layer).toMatchObject({type:'text',role:'sfx',effects:{recipe:'layout'}});if(category.id==='bubble-tails')expect(r.value.layer.type).toBe('bubbleTail');}});
it.each(['vertical','multiline'] as const)('upgrades legacy SFX only when %s layout is actively changed, then undoes content and recipe together',change=>{
  const p=structuredClone(getProject()),t=p.layers[layer.id] as TextLayer;t.effects!.recipe='legacy-sfx-v5';Object.assign(t.text,{lineHeight:1,letterSpacing:0,align:'start',direction:'horizontal'});t.text.font.bold=true;replaceDocument(p);
  const before=getProject();expect(beginSfxTextEdit(layer.id).ok).toBe(true);expect(currentTextEdit()!.draftEffects!.recipe).toBe('legacy-sfx-v5');
  if(change==='vertical')expect(updateTextStyleDraft({direction:'vertical'}).ok).toBe(true);else updateTextInput('新的一行\n第二行',9,9);
  expect(currentTextEdit()!.draftEffects!.recipe).toBe('layout');expect(getProject()).toBe(before);expect(commitTextEdit().ok).toBe(true);expect((getProject().layers[layer.id] as TextLayer).effects!.recipe).toBe('layout');undo();expect(getProject()).toEqual(before);
});
