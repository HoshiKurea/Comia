import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer, createProject } from '../../src/domain/factories';
import type { BubbleLayer, BubbleTailLayer, GroupLayer } from '../../src/domain/types';
import { migrateProject } from '../../src/storage/migrateProject';
import { replaceDocument, undo, redo, execute } from '../../src/history/commandBus';
import { getDocument, getProject } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';
import { createAttachedTail, createFreeTail, attachTail, detachTail } from '../../src/bubbles/tailCommands';
import { buildTailAppearance } from '../../src/bubbles/tailGeometry';
import { composeBubble } from '../../src/bubbles/composeBubble';
import { mainBubbleText, bubbleTails } from '../../src/bubbles/ownership';
import { beginBubbleTextEdit, cancelTextEdit, updateTextInput, commitTextEdit } from '../../src/text/editController';
import { buildPaintOps } from '../../src/render/paintOps';
import { apply, multiply, translation, worldMatrix } from '../../src/geometry/matrix';
import { handDrawnPreset } from '../../src/bubbles/handDrawn';
import { prepareTailPaint, tailVisualBounds } from '../../src/bubbles/tailPaint';

let bubbleId:string,pageId:string;
beforeEach(()=>{
  const p=createProject();pageId=p.pageOrder[0];const b=createLayer('bubble',pageId) as BubbleLayer;bubbleId=b.id;p.layers[b.id]=b;p.pages[pageId].roots.push(b.id);
  const up=migrateProject(p);if(!up.ok)throw Error('migration');expect(replaceDocument(up.value).ok).toBe(true);sessionStore.setState({activePageId:pageId,selection:[bubbleId]});
});
describe('independent manga tails',()=>{
  it.each(['triangle','line','curved','thought','jagged','flat'] as const)('conservatively encloses the actual %s pressure stroke without unioning another stroke for selection',appearance=>{
    const r=createAttachedTail(bubbleId,appearance);if(!r.ok)throw Error(JSON.stringify(r));const p=structuredClone(getProject()),b=p.layers[bubbleId] as BubbleLayer;b.style.borderWidth=12;b.handDrawn=handDrawnPreset('soft',42);b.handDrawn.pressure=.65;const bounds=tailVisualBounds(p,r.value),paint=prepareTailPaint(p,r.value);if(!bounds.ok||!paint.ok)throw Error(JSON.stringify([bounds,paint]));const a=bounds.value,z=paint.value.bounds;expect(a.x).toBeLessThanOrEqual(z.x+1e-7);expect(a.y).toBeLessThanOrEqual(z.y+1e-7);expect(a.x+a.width).toBeGreaterThanOrEqual(z.x+z.width-1e-7);expect(a.y+a.height).toBeGreaterThanOrEqual(z.y+z.height-1e-7);expect(tailVisualBounds(p,r.value)).toEqual(bounds);
  });
  it.each(['triangle','line','curved','thought','jagged','flat'] as const)('creates a drawable independent %s component in one undoable transaction',kind=>{
    const before=getDocument(),created=createFreeTail(pageId,kind,{x:20,y:30});expect(created.ok).toBe(true);if(!created.ok)throw Error(created.problems[0].message);
    const id=created.value,geometry=buildTailAppearance(getProject(),id);expect(geometry.ok).toBe(true);if(geometry.ok){if(kind==='thought')expect(geometry.value.fillRegions).toHaveLength(4);else if(kind==='line')expect(geometry.value.linePaths).toHaveLength(1);else expect(geometry.value.fillRegions).toHaveLength(1);}
    expect(getDocument().history.past).toHaveLength(before.history.past.length+1);expect(undo().ok).toBe(true);expect(getProject().layers[id]).toBeUndefined();expect(redo().ok).toBe(true);expect(getProject().layers[id].type).toBe('bubbleTail');
  });
  it.each(['triangle','line','curved','thought','jagged','flat'] as const)('adds a bound %s without a duplicate child paint operation or erased text',kind=>{
    const result=createAttachedTail(bubbleId,kind);expect(result.ok).toBe(true);if(!result.ok)throw Error(result.problems[0].message);
    const composed=composeBubble(getProject(),bubbleId);expect(composed.ok).toBe(true);
    expect(buildPaintOps(getProject(),pageId,new Map()).filter(op=>op.layerId===result.value)).toHaveLength(0);
    expect(beginBubbleTextEdit(bubbleId).ok).toBe(true);updateTextInput('你好😀',4,4);expect(commitTextEdit().ok).toBe(true);
    expect(mainBubbleText(getProject(),bubbleId)?.text.content).toBe('你好😀');expect(bubbleTails(getProject(),bubbleId)).toHaveLength(1);
  });
  it('preserves tails when cancelling creation of missing main text',()=>{
    const tail=createAttachedTail(bubbleId,'triangle');expect(tail.ok).toBe(true);const before=getDocument();
    expect(beginBubbleTextEdit(bubbleId).ok).toBe(true);updateTextInput('取消',2,2);expect(cancelTextEdit().ok).toBe(true);
    expect(getDocument()).toEqual(before);expect(mainBubbleText(getProject(),bubbleId)).toBeNull();expect(bubbleTails(getProject(),bubbleId)).toHaveLength(1);
  });
  it('rejects a fifth tail and locking the owner without appending history',()=>{
    for(let i=0;i<4;i++)expect(createAttachedTail(bubbleId,'triangle').ok).toBe(true);
    const before=getDocument();expect(createAttachedTail(bubbleId,'line').ok).toBe(false);expect(getDocument()).toBe(before);
    expect(execute({label:'lock',context:{pageId,selection:[bubbleId]},mutate(p){p.layers[bubbleId].locked=true;}}).ok).toBe(true);
    const locked=getDocument();expect(createAttachedTail(bubbleId,'line').ok).toBe(false);expect(getDocument()).toBe(locked);
  });
  it('binds and detaches between transformed parents while preserving every route point in world coordinates',()=>{
    const p=structuredClone(getProject()),b=p.layers[bubbleId] as BubbleLayer,g=createLayer('group',pageId) as GroupLayer;
    g.matrix=[1.1,.2,.1,.9,80,60];g.children=[bubbleId];b.parentId=g.id;b.matrix=translation(10,15);b.handDrawn=handDrawnPreset('soft',0);p.layers[g.id]=g;p.pages[pageId].roots=p.pages[pageId].roots.map(id=>id===bubbleId?g.id:id);
    const t=createLayer('bubbleTail',pageId) as BubbleTailLayer;t.matrix=multiply(worldMatrix(p,bubbleId),translation(b.width*.65-12,b.height+4));p.layers[t.id]=t;p.pages[pageId].roots.push(t.id);expect(replaceDocument(p).ok).toBe(true);
    const tipBefore=apply(worldMatrix(getProject(),t.id),t.tip),result=attachTail(t.id,bubbleId);expect(result.ok).toBe(true);if(!result.ok)throw Error(result.problems[0].message);
    const attached=getProject().layers[t.id] as BubbleTailLayer,tipAttached=apply(worldMatrix(getProject(),t.id),attached.tip);expect(tipAttached.x).toBeCloseTo(tipBefore.x,8);expect(tipAttached.y).toBeCloseTo(tipBefore.y,8);
    expect(detachTail(t.id).ok).toBe(true);const free=getProject().layers[t.id] as BubbleTailLayer,tipFree=apply(worldMatrix(getProject(),t.id),free.tip);expect(free.parentId).toBe(g.id);expect(tipFree.x).toBeCloseTo(tipBefore.x,8);expect(tipFree.y).toBeCloseTo(tipBefore.y,8);expect(free.stroke).toEqual({pressure:.15,seed:0});expect(free.style).toEqual(b.style);
    expect(undo().ok).toBe(true);expect((getProject().layers[t.id] as BubbleTailLayer).attachment.mode).toBe('bubble');
  });
  it('rejects routes through the owner and self crossing routes with observable error messages',()=>{
    const created=createAttachedTail(bubbleId,'triangle');if(!created.ok)throw Error('tail');
    const p=structuredClone(getProject()),t=p.layers[created.value] as BubbleTailLayer;t.tip={x:150,y:90};const inside=buildTailAppearance(p,t.id);expect(inside.ok).toBe(false);if(!inside.ok)expect(inside.problems[0].message).toContain('主体');
    t.attachment={mode:'free',baseA:{x:0,y:0},baseB:{x:24,y:0}};t.parentId=null;t.style={...(p.layers[bubbleId] as BubbleLayer).style};t.tip={x:12,y:60};t.route={kind:'polyline',knots:[{x:100,y:100},{x:-100,y:100},{x:100,y:0}]};expect(buildTailAppearance(p,t.id).ok).toBe(false);
  });
  it('does not discard a main text layer when child order starts with a tail',()=>{
    expect(createAttachedTail(bubbleId,'line').ok).toBe(true);expect(beginBubbleTextEdit(bubbleId).ok).toBe(true);updateTextInput('旧对白',3,3);expect(commitTextEdit().ok).toBe(true);
    const b=getProject().layers[bubbleId] as BubbleLayer;expect(getProject().layers[b.children[0]].type).toBe('bubbleTail');expect(mainBubbleText(getProject(),bubbleId)?.text.content).toBe('旧对白');
    expect(beginBubbleTextEdit(bubbleId).ok).toBe(true);cancelTextEdit();expect(bubbleTails(getProject(),bubbleId)).toHaveLength(1);
  });
});
