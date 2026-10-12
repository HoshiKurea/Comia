import { afterEach, beforeEach, expect, it } from 'vitest';
import { createProject, createLayer } from '../../src/domain/factories';
import type { BubbleLayer, GroupLayer } from '../../src/domain/types';
import { replaceDocument, undo, redo, execute } from '../../src/history/commandBus';
import { getDocument, getProject } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';
import { createDialogue, dialogueEligibility, dissolveDialogue, setDialogueMode, updateDialogueStyle } from '../../src/bubbles/dialogueCommands';
import { prepareDialogue, smoothFusion } from '../../src/bubbles/dialogueGeometry';
import { cancelMangaEdit, commitMangaEdit } from '../../src/bubbles/mangaEditController';
import { regionArea, polygonRegion, regionContains } from '../../src/geometry/pathRegion';
import { partitionOverlap, prepareCoverage, rasterizeOwnedFills } from '../../src/bubbles/overlapFill';
import { IDENTITY, worldMatrix } from '../../src/geometry/matrix';
import { LOCAL_TARGET } from '../../src/geometry/flattenForBoolean';
import { buildPaintOps } from '../../src/render/paintOps';
import { deleteSelected } from '../../src/app/actions';
import { validateProject } from '../../src/domain/validate';
import { createAttachedTail } from '../../src/bubbles/tailCommands';
import { mainBubbleText } from '../../src/bubbles/ownership';

function fixture(overlap=false){const p=createProject({background:false}),page=p.pages[p.pageOrder[0]],a=createLayer('bubble',page.id) as BubbleLayer,b=createLayer('bubble',page.id) as BubbleLayer;
  Object.assign(page,{width:800,height:600});Object.assign(a,{width:180,height:120,matrix:[1,0,0,1,50,50]});Object.assign(b,{width:180,height:120,matrix:[1,0,0,1,overlap?160:300,80]});a.style.fill='#FF000080';b.style.fill='#0000FF80';p.layers[a.id]=a;p.layers[b.id]=b;page.roots=[a.id,b.id];expect(replaceDocument(p).ok).toBe(true);sessionStore.setState({activePageId:page.id,selection:[a.id,b.id],scopeId:null});return{p,page,a,b};}
beforeEach(()=>cancelMangaEdit());afterEach(cancelMangaEdit);
it.each(['connector','fused','overlap'] as const)('creates %s, keeps members and their world placement, dissolves original colors and undoes',mode=>{
  const f=fixture(mode!=='connector'),before=getProject(),worlds=[f.a.id,f.b.id].map(id=>worldMatrix(before,id)),r=createDialogue([f.b.id,f.a.id],mode);expect(r.ok).toBe(true);if(!r.ok)throw Error(JSON.stringify(r));
  const g=getProject().layers[r.value] as GroupLayer;expect(g.children).toEqual([f.a.id,f.b.id]);g.children.forEach((id,i)=>expect(worldMatrix(getProject(),id)).toEqual(worlds[i]));expect(validateProject(getProject()).ok).toBe(true);expect(prepareDialogue(getProject(),g.id).ok).toBe(true);
  const grouped=getProject();expect(dissolveDialogue(g.id).ok).toBe(true);expect(getProject().layers[f.a.id]).toEqual(before.layers[f.a.id]);expect(getProject().layers[f.b.id]).toEqual(before.layers[f.b.id]);undo();expect(getProject()).toEqual(grouped);undo();expect(getProject()).toEqual(before);redo();expect(getProject()).toEqual(grouped);
});
it('rejects noncontiguous, hidden or locked child selections without history',()=>{const f=fixture();const p=structuredClone(f.p),middle=createLayer('text',f.page.id);p.layers[middle.id]=middle;p.pages[f.page.id].roots.splice(1,0,middle.id);replaceDocument(p);const before=getDocument();expect(createDialogue([f.a.id,f.b.id],'connector').ok).toBe(false);expect(getDocument()).toBe(before);p.pages[f.page.id].roots.splice(1,1);delete p.layers[middle.id];p.layers[f.a.id].visible=false;expect(dialogueEligibility(p,[f.a.id,f.b.id]).ok).toBe(false);});
it('previews mode and opacity with one history entry, preserves originals, and rejects overlong fusion',()=>{const f=fixture(true),r=createDialogue([f.a.id,f.b.id],'connector');if(!r.ok)throw Error('group');const before=getDocument();expect(setDialogueMode(r.value,'overlap').ok).toBe(true);for(let i=0;i<12;i++)expect(updateDialogueStyle(r.value,{overlapOpacity:i/12}).ok).toBe(true);expect(getDocument()).toBe(before);expect(commitMangaEdit().ok).toBe(true);expect(getDocument().history.past.length).toBe(before.history.past.length+1);undo();expect(getProject()).toEqual(before.project);
  const p=structuredClone(getProject()),g=p.layers[r.value] as GroupLayer;g.dialogue!.mode='fused';p.layers[f.b.id].matrix=[1,0,0,1,3000,0];const result=prepareDialogue(p,r.value);expect(result.ok).toBe(false);});
it('removes a member, dissolves a one-member group and restores references on undo',()=>{const f=fixture(),r=createDialogue([f.a.id,f.b.id],'connector');if(!r.ok)throw Error('group');const before=getProject();sessionStore.setState({selection:[f.a.id]});expect(deleteSelected().ok).toBe(true);expect(getProject().layers[r.value]).toBeUndefined();expect(worldMatrix(getProject(),f.b.id)).toEqual(worldMatrix(before,f.b.id));undo();expect(getProject()).toEqual(before);});
it('emits the group surface before every dialogue text and leaves the next root on top',()=>{const f=fixture();const p=structuredClone(f.p),a=p.layers[f.a.id] as BubbleLayer,b=p.layers[f.b.id] as BubbleLayer,t1=createLayer('text',f.page.id),t2=createLayer('text',f.page.id),top=createLayer('text',f.page.id);t1.parentId=a.id;t2.parentId=b.id;a.children=[t1.id];b.children=[t2.id];for(const t of[t1,t2,top])p.layers[t.id]=t;p.pages[f.page.id].roots.push(top.id);replaceDocument(p);const r=createDialogue([a.id,b.id],'connector');if(!r.ok)throw Error('group');const ops=buildPaintOps(getProject(),f.page.id,new Map());expect(ops.map(o=>[o.layerId,o.kind])).toEqual([[r.value,'dialogueSurface'],[t1.id,'content'],[t2.id,'content'],[top.id,'content']]);expect(ops[0].contributorIds).toContain(t2.id);});
const rect=(x:number,y:number,w:number,h:number)=>polygonRegion([{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]);
it('partitions triple overlap by the highest color once, preserves holes and exact exclusive area',()=>{const r=partitionOverlap([{id:'a',region:rect(0,0,10,10)},{id:'b',region:rect(5,0,10,10)},{id:'c',region:rect(7,0,3,10)}]);expect(r.ok).toBe(true);if(!r.ok)throw Error('partition');expect(regionArea(r.value.overlap)).toBeCloseTo(50,8);expect(r.value.parts.map(p=>regionArea(p.exclusive)+regionArea(p.overlap))).toEqual([50,70,30]);expect(regionContains(r.value.parts[2].overlap,{x:8,y:5})).toBe(true);});
it.each([0,.65,1])('integrates a shared diagonal without alpha seams at multiplier %s',factor=>{
  const a=polygonRegion([{x:0,y:0},{x:2,y:0},{x:0,y:2}]),b=polygonRegion([{x:2,y:0},{x:2,y:2},{x:0,y:2}]),parts=prepareCoverage([{region:a,color:'#FF000080',multiplier:1},{region:b,color:'#0000FF80',multiplier:factor}],IDENTITY),r=rasterizeOwnedFills(parts,{x:0,y:0,width:2,height:2});if(!r.ok)throw Error('raster');
  // Pixel [1,0] is two exact triangles, each area 1/2.
  const i=4;expect(r.value.data[i+3]).toBe(Math.round(128*(.5+.5*factor)));expect(r.value.data[i]).toBe(Math.round(255/(1+factor)));expect(r.value.data[i+2]).toBe(Math.round(255*factor/(1+factor)));expect(r.value.data[3]).toBe(128);
});
it('smooths only intersections with tangent quadratic transitions while leaving original square corners',()=>{
  const region=[[[[0,0],[4,0],[4,2],[6,2],[6,6],[0,6],[0,0]]]] as import('../../src/geometry/pathRegion').Region,sources=[rect(0,0,4,6),rect(3,2,3,4)],r=smoothFusion(region,sources,1,LOCAL_TARGET);expect(r.ok).toBe(true);if(!r.ok)throw Error('smooth');expect(r.value.ops.some(op=>op.op==='Q')).toBe(true);expect(r.value.ops.some(op=>'p'in op&&op.p.x===0&&op.p.y===0)).toBe(true);
});
it('connects separated bodies even with independent thought beads, and suspends hidden-end links without deleting them',()=>{
  const f=fixture(),tail=createAttachedTail(f.a.id,'thought');expect(tail.ok).toBe(true);const grouped=createDialogue([f.a.id,f.b.id],'fused');expect(grouped.ok,JSON.stringify(grouped)).toBe(true);if(!grouped.ok)throw Error('group');
  const p=getProject(),g=p.layers[grouped.value] as GroupLayer,geometry=prepareDialogue(p,g.id);if(!geometry.ok)throw Error(JSON.stringify(geometry));expect(geometry.value.bridgePaths).toHaveLength(1);
  const r=geometry.value.fusionRegion!;for(const id of g.children){const b=p.layers[id] as BubbleLayer,m=b.matrix;expect(regionContains(r,{x:m[4]+b.width/2,y:m[5]+b.height/2})).toBe(true);}
  const hidden=structuredClone(p);hidden.layers[f.b.id].visible=false;const dormant=prepareDialogue(hidden,g.id);expect(dormant.ok).toBe(true);if(dormant.ok)expect(dormant.value.bridgePaths).toHaveLength(0);expect((hidden.layers[g.id] as GroupLayer).dialogue!.links).toEqual(g.dialogue!.links);
});
it('refuses group style changes that would affect locked dialogue text, preserving the document and history',()=>{
  const f=fixture(true),p=structuredClone(getProject()),t=createLayer('text',f.page.id);t.parentId=f.a.id;p.layers[t.id]=t;(p.layers[f.a.id] as BubbleLayer).children=[t.id];replaceDocument(p);
  const made=createDialogue([f.a.id,f.b.id],'connector');if(!made.ok)throw Error(JSON.stringify(made));const text=mainBubbleText(getProject(),f.a.id)!;
  execute({label:'lock dialogue',context:{pageId:f.page.id,selection:[made.value]},mutate(d){d.layers[text.id].locked=true;}});const before=getDocument();expect(setDialogueMode(made.value,'fused').ok).toBe(false);expect(getDocument()).toBe(before);
});
it('keeps a separated rectangular fusion bridge around the straight centreline with opposite tangent directions on its two edges',()=>{
  const f=fixture(),p=structuredClone(getProject());for(const id of [f.a.id,f.b.id]){const b=p.layers[id] as BubbleLayer;b.shape='rect';b.matrix=[b.matrix[0],b.matrix[1],b.matrix[2],b.matrix[3],b.matrix[4],80];}replaceDocument(p);const made=createDialogue([f.a.id,f.b.id],'fused');if(!made.ok)throw Error(JSON.stringify(made));const g=getProject().layers[made.value] as GroupLayer,a=getProject().layers[g.children[0]] as BubbleLayer,b=getProject().layers[g.children[1]] as BubbleLayer,point={x:(a.matrix[4]+a.width+b.matrix[4])/2,y:a.matrix[5]+a.height/2};const prepared=prepareDialogue(getProject(),g.id);if(!prepared.ok)throw Error(JSON.stringify(prepared));expect(regionContains(prepared.value.fusionRegion!,point)).toBe(true);
});
it('reuses only unchanged overlap geometry when alpha changes, and invalidates it for real member movement',()=>{
  const f=fixture(true),made=createDialogue([f.a.id,f.b.id],'overlap');if(!made.ok)throw Error(JSON.stringify(made));
  const p=getProject(),first=prepareDialogue(p,made.value);if(!first.ok)throw Error(JSON.stringify(first));
  const alpha=structuredClone(p);(alpha.layers[made.value] as GroupLayer).dialogue!.overlapOpacity=.12;
  const same=prepareDialogue(alpha,made.value);if(!same.ok)throw Error(JSON.stringify(same));expect(same.value).toBe(first.value);
  alpha.layers[f.a.id].matrix=[1,0,0,1,51,50];const moved=prepareDialogue(alpha,made.value);if(!moved.ok)throw Error(JSON.stringify(moved));expect(moved.value).not.toBe(first.value);
});
