import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer, createProject } from '../../src/domain/factories';
import type { BubbleLayer } from '../../src/domain/types';
import { getDocument, getProject } from '../../src/state/documentStore';
import { replaceDocument, execute, undo, redo } from '../../src/history/commandBus';
import { sessionStore } from '../../src/state/sessionStore';
import { runtimeStore } from '../../src/state/runtimeStore';
import { beginBubbleShapeEdit, applyHandDrawnPreset, editableContour, updateBubbleContour, commitBubbleShapeEdit, cancelBubbleShapeEdit, updateHandDrawn, setEditedBubbleShape, regenerateBubbleContour } from '../../src/bubbles/shapeController';
import { currentMangaEdit, cancelMangaEdit } from '../../src/bubbles/mangaEditController';
import { createAttachedTail } from '../../src/bubbles/tailCommands';
import { beginTailEdit, updateTailEdit, commitTailEdit } from '../../src/bubbles/tailEditController';
import { moveTailTipLayer, setTailDirection } from '../../src/bubbles/tailEditGeometry';
import { mainBubbleText } from '../../src/bubbles/ownership';
import { beginBubbleTextEdit, updateTextInput, commitTextEdit } from '../../src/text/editController';

let id:string,pageId:string;
beforeEach(()=>{cancelMangaEdit();const p=createProject();p.schemaVersion=5;pageId=p.pageOrder[0];const b=createLayer('bubble',pageId) as BubbleLayer;id=b.id;p.layers[id]=b;p.pages[pageId].roots.push(id);expect(replaceDocument(p).ok).toBe(true);sessionStore.setState({activePageId:pageId,selection:[id]});});
describe('manga preview transactions',()=>{
  it('preserves authored nodes when switching pressure presets, and replaces them only on explicit regeneration',()=>{
    beginBubbleShapeEdit(id);applyHandDrawnPreset('soft');const b=currentMangaEdit()!.preview.layers[id] as BubbleLayer,c=editableContour(b);if(!c.ok)throw Error('contour');
    const nodes=c.value.nodes.map((p,i)=>i===0?{x:p.x-.005,y:p.y}:p);expect(updateBubbleContour(nodes).ok).toBe(true);{const r=applyHandDrawnPreset('rough');expect(r.ok,r.ok?'':JSON.stringify(r)).toBe(true);}
    const changed=currentMangaEdit()!.preview.layers[id] as BubbleLayer;expect(changed.contour!.nodes).toEqual(nodes);expect(changed.handDrawn!.pressure).toBe(.4);
    expect(regenerateBubbleContour().ok).toBe(true);expect((currentMangaEdit()!.preview.layers[id] as BubbleLayer).contour).toBeNull();cancelBubbleShapeEdit();
  });
  it('keeps repeated shape changes outside the document/history and commits one reversible edit',()=>{
    const before=getDocument();expect(beginBubbleShapeEdit(id).ok).toBe(true);expect(applyHandDrawnPreset('soft').ok).toBe(true);
    for(let i=0;i<10;i++){const result=updateHandDrawn({pressure:.1+i*.01});expect(result.ok,result.ok?'':result.problems.map(p=>`${p.code}:${p.message}`).join(';')).toBe(true);}
    expect(getDocument()).toBe(before);expect(runtimeStore.getState().gestureActive).toBe(true);expect(currentMangaEdit()?.revision).toBe(11);
    expect(commitBubbleShapeEdit().ok).toBe(true);expect(getProject().schemaVersion).toBe(10);expect(getDocument().history.past).toHaveLength(1);
    expect(undo().ok).toBe(true);expect(getProject()).toEqual(before.project);expect(redo().ok).toBe(true);expect((getProject().layers[id] as BubbleLayer).handDrawn?.pressure).toBeCloseTo(.19);
  });
  it('cancel and an unchanged completion leave the legacy document untouched',()=>{
    const before=getDocument();beginBubbleShapeEdit(id);applyHandDrawnPreset('rough');cancelBubbleShapeEdit();expect(getDocument()).toBe(before);expect(runtimeStore.getState().previewProject).toBeNull();
    beginBubbleShapeEdit(id);expect(commitBubbleShapeEdit().ok).toBe(true);expect(getDocument()).toBe(before);
  });
  it('preserves the last valid contour for invalid nodes and pressure',()=>{
    beginBubbleShapeEdit(id);applyHandDrawnPreset('soft');const a=currentMangaEdit()!,b=a.preview.layers[id] as BubbleLayer,c=editableContour(b);if(!c.ok)throw Error('contour');
    expect(updateBubbleContour(Array(8).fill({x:.5,y:.5})).ok).toBe(false);expect(currentMangaEdit()).toBe(a);expect(updateHandDrawn({pressure:.9}).ok).toBe(false);expect(currentMangaEdit()).toBe(a);
    const nodes=c.value.nodes.map((p,i)=>i===0?{x:p.x-.005,y:p.y}:p);expect(updateBubbleContour(nodes).ok).toBe(true);cancelBubbleShapeEdit();
  });
  it('does not silently update the safe box of a locked main text',()=>{
    beginBubbleTextEdit(id);updateTextInput('锁定对白',4,4);commitTextEdit();const textId=mainBubbleText(getProject(),id)!.id;
    expect(execute({label:'lock',context:{pageId,selection:[id]},mutate(p){p.layers[textId].locked=true;}}).ok).toBe(true);
    const before=getDocument();beginBubbleShapeEdit(id);expect(applyHandDrawnPreset('soft').ok).toBe(false);expect(getDocument()).toBe(before);cancelBubbleShapeEdit();
  });
  it('keeps a circle centered while changing the dimensions and rescales its tails together',()=>{
    const created=createAttachedTail(id,'line');if(!created.ok)throw Error('tail');const before=getProject().layers[id] as BubbleLayer;
    beginBubbleShapeEdit(id);expect(setEditedBubbleShape('circle').ok).toBe(true);const b=currentMangaEdit()!.preview.layers[id] as BubbleLayer;
    expect(b.width).toBe(300);expect(b.height).toBe(300);expect(b.matrix[4]+b.width/2).toBe(before.matrix[4]+before.width/2);expect(b.matrix[5]+b.height/2).toBe(before.matrix[5]+before.height/2);cancelBubbleShapeEdit();
  });
  it('cancels on selection changes or another document transaction and rejects late edits',()=>{
    beginBubbleShapeEdit(id);applyHandDrawnPreset('soft');sessionStore.setState({selection:[]});expect(currentMangaEdit()).toBeNull();expect(updateHandDrawn({pressure:.2}).ok).toBe(false);
    sessionStore.setState({selection:[id]});beginBubbleShapeEdit(id);expect(execute({label:'rename',context:{pageId,selection:[id]},mutate(p){p.layers[id].name='新名字';}}).ok).toBe(true);
    expect(currentMangaEdit()).toBeNull();expect(commitBubbleShapeEdit().ok).toBe(false);expect(getProject().layers[id].name).toBe('新名字');
  });
  it('constrains tail tip movement before its first crossing of the body, never jumping through',()=>{
    const made=createAttachedTail(id,'triangle');if(!made.ok)throw Error('tail');const p=getProject(),next=moveTailTipLayer(p,made.value,{x:150,y:-80});expect(next.ok).toBe(true);
    if(next.ok){expect(next.value.tip.y).toBeGreaterThan(180);expect(beginTailEdit(made.value).ok).toBe(true);expect(updateTailEdit({tip:next.value.tip}).ok).toBe(true);expect(commitTailEdit().ok).toBe(true);}
  });
  it('rotates a straight attached tail through every quadrant and preserves one transaction',()=>{
    const made=createAttachedTail(id,'line');if(!made.ok)throw Error('tail');expect(beginTailEdit(made.value).ok).toBe(true);const before=getDocument();
    for(const angle of [0,45,90,135,180,225,270,315]){const p=currentMangaEdit()!.preview,next=setTailDirection(p,made.value,angle,60);expect(next.ok,`${angle}`).toBe(true);if(next.ok)expect(updateTailEdit({attachment:next.value.attachment,tip:next.value.tip,route:next.value.route}).ok).toBe(true);}
    expect(getDocument()).toBe(before);expect(commitTailEdit().ok).toBe(true);expect(getDocument().history.past.length).toBe(before.history.past.length+1);
  });
});
