import { beforeEach, afterEach, expect, it } from 'vitest';
import { createProject, createLayer } from '../../src/domain/factories';
import type { ImageLayer, PanelLayer, BreakoutRegion } from '../../src/domain/types';
import { numberFixture } from '../helpers/numberFixture';
import { replaceDocument, execute, undo, redo } from '../../src/history/commandBus';
import { getProject, getDocument } from '../../src/state/documentStore';
import { worldMatrix } from '../../src/geometry/matrix';
import { rectangle } from '../../src/panels/presets';
import { bindImagesToPanel, unbindPanelImages, rankPanelOverlaps } from '../../src/images/panelAssociation';
import { beginBreakoutEdit, cancelBreakoutEdit, commitBreakoutEdit, currentBreakoutEdit, previewBreakoutRegion } from '../../src/images/breakoutController';
import { setPanelClipMode, setBreakoutRegion } from '../../src/images/breakoutCommands';
import { previewCut } from '../../src/panels/cutPanel';
import { previewLineCut } from '../../src/panels/lineCut';
import { replaceLeafWithLayout } from '../../src/panels/splitCommand';
import { applyIndependentLayout } from '../../src/panels/independentLayout';
import { buildPaintOps } from '../../src/render/paintOps';
import { getPanelNumberLabels } from '../../src/panels/numberOverlay';
import { validateProject } from '../../src/domain/validate';
import { resolveShortcut } from '../../src/interaction/shortcuts';
import { regionArea, ellipseRegion, pathPolygon, pathRegionDiagnostics } from '../../src/geometry/pathRegion';
import { buildRoundedPolygon } from '../../src/geometry/roundedPolygon';

function fixture() {
  const p = createProject({ background: false }), pageId = p.pageOrder[0]; Object.assign(p.pages[pageId], { width: 640, height: 480 });
  const outer = createLayer('panel', pageId) as PanelLayer, panel = createLayer('panel', pageId) as PanelLayer, other = createLayer('panel', pageId) as PanelLayer;
  outer.geometry = rectangle({ x: 0,y:0,width:220,height:220 }); outer.matrix = [1,.2,.1,1,100,100]; outer.role='split'; outer.children=[panel.id];
  panel.parentId=outer.id; panel.geometry=rectangle({x:0,y:0,width:160,height:160}); panel.children=[]; other.geometry=rectangle({x:0,y:0,width:220,height:220}); other.matrix=[1,0,0,1,350,100];
  const assetId=crypto.randomUUID(); p.assets[assetId]={id:assetId,name:'真图.png',width:300,height:200,originalHash:'a'.repeat(64),renderHash:'b'.repeat(64),originalMime:'image/png',renderMime:'image/png',originalBytes:1,renderBytes:1,framePolicy:'still',normalizedOrientation:true}; p.libraryAssetIds=[assetId];p.assetLibrary!.assetFolder[assetId]=null;
  const images=Array.from({length:3},(_,i)=>{const l=createLayer('image',pageId) as ImageLayer;l.assetId=assetId;l.width=300;l.height=200;l.matrix=[.5,.1,-.05,.5,120+i*10,120];return l;});
  for (const l of [outer,panel,other,...images]) p.layers[l.id]=l; p.pages[pageId].roots=[outer.id,other.id,...images.map(l=>l.id)]; numberFixture(p); expect(replaceDocument(p).ok).toBe(true); return { pageId,outer,panel,other,images };
}
beforeEach(()=>cancelBreakoutEdit()); afterEach(cancelBreakoutEdit);
it('bounds auxiliary curve approximation without truncating the closed outline and records its budget fallback once',()=>{
 const path = buildRoundedPolygon(rectangle({x:0,y:0,width:1e7,height:1e7}),5e6), before=pathRegionDiagnostics()['center-approximation-budget'];
 const region=pathPolygon(path,[10000,0,0,10000,0,0]),ring=region[0][0];expect(ring.length-1).toBeLessThanOrEqual(8192);expect(ring[0]).toEqual(ring.at(-1));expect(regionArea(region)).toBeGreaterThan(0);expect(pathRegionDiagnostics()['center-approximation-budget']).toBe(before+1);pathPolygon(path,[10000,0,0,10000,0,0]);expect(pathRegionDiagnostics()['center-approximation-budget']).toBe(before+1);
});
it('binds three transformed images atomically, unbinds outside the outer panel and restores tree/order/masks on undo',()=>{
 const f=fixture(), ids=f.images.map(i=>i.id), before=structuredClone(getProject()), worlds=ids.map(id=>worldMatrix(before,id));
 expect(bindImagesToPanel(ids,f.panel.id).ok).toBe(true); ids.forEach((id,j)=>worldMatrix(getProject(),id).forEach((n,i)=>expect(n).toBeCloseTo(worlds[j][i],10)));
 expect((getProject().layers[f.panel.id] as PanelLayer).children).toEqual(ids); const bound=structuredClone(getProject()); expect(undo().ok).toBe(true); expect(getProject()).toEqual(before); expect(redo().ok).toBe(true); expect(getProject()).toEqual(bound);
 expect(unbindPanelImages(ids).ok).toBe(true); expect(getProject().pages[f.pageId].roots).toEqual([f.outer.id,...ids,f.other.id]); ids.forEach((id,j)=>worldMatrix(getProject(),id).forEach((n,i)=>expect(n).toBeCloseTo(worlds[j][i],10)));
 undo(); expect(getProject()).toEqual(bound);
 execute({label:'锁定',context:{pageId:f.pageId,selection:ids},mutate(p){p.layers[ids[1]].locked=true;}}); const locked=getProject(), count=getDocument().history.past.length; expect(unbindPanelImages(ids).ok).toBe(false); expect(getProject()).toBe(locked); expect(getDocument().history.past).toHaveLength(count);
});
it('ranks true clipped/masked overlap, excludes current/hidden/locked owners and handles tiny/empty footprint',()=>{
 const f=fixture(), id=f.images[0].id; expect(rankPanelOverlaps(getProject(),id)[0]?.panelId).toBe(f.panel.id); expect(bindImagesToPanel([id],f.panel.id).ok).toBe(true); expect(rankPanelOverlaps(getProject(),id).some(c=>c.panelId===f.panel.id)).toBe(false);
 execute({label:'移到另框',context:{pageId:f.pageId,selection:[id]},mutate(p){p.layers[id].matrix=[1,0,0,1,300,0];}}); expect(rankPanelOverlaps(getProject(),id)[0]?.panelId).toBe(f.other.id);
 const p=structuredClone(getProject()); p.layers[f.other.id].locked=true; expect(rankPanelOverlaps(p,id)).toEqual([]); p.layers[f.other.id].locked=false; p.layers[f.other.id].visible=false; expect(rankPanelOverlaps(p,id)).toEqual([]);
 const image=p.layers[id] as ImageLayer; image.matrix=[1,0,0,1,10000,10000]; expect(rankPanelOverlaps(p,id)).toEqual([]);
});
it('begins without mutating the document, previews20 changes without history, rejects invalid outlines, commits once and restores on undo',()=>{
 const f=fixture(), id=f.images[0].id; bindImagesToPanel([id],f.panel.id); const before=structuredClone(getProject()), canonical=getProject(), count=getDocument().history.past.length;
 expect(beginBreakoutEdit(id,'polygon').ok).toBe(true); expect(getProject()).toBe(canonical); expect(getProject()).toEqual(before);
 const base=currentBreakoutEdit()!.preview.layers[id] as ImageLayer, r=base.panelClip!.region!;
 for(let i=0;i<20;i++)expect(previewBreakoutRegion({...r,matrix:[1,0,0,1,i,0]}).ok).toBe(true);
 const valid=currentBreakoutEdit()!.preview; expect(previewBreakoutRegion({...r,geometry:[{x:0,y:0},{x:100,y:100},{x:100,y:0},{x:0,y:100}]}).ok).toBe(false); expect(currentBreakoutEdit()!.preview).toBe(valid);
 expect(getProject()).toEqual(before);expect(getDocument().history.past).toHaveLength(count); expect(commitBreakoutEdit().ok).toBe(true);expect(getDocument().history.past).toHaveLength(count+1);undo();expect(getProject()).toEqual(before);
 beginBreakoutEdit(id,'ellipse');cancelBreakoutEdit();expect(getProject()).toEqual(before);beginBreakoutEdit(id);execute({label:'竞争锁定',context:{pageId:f.pageId,selection:[id]},mutate(p){p.layers[id].locked=true;}});expect(currentBreakoutEdit()).toBeNull();
});
it('retains dormant regions through mode changes and unbinding, and refuses all four cloning split paths',()=>{
 const f=fixture(), id=f.images[0].id;bindImagesToPanel([id],f.panel.id);const r:BreakoutRegion={shape:'ellipse',geometry:rectangle({x:0,y:0,width:100,height:100}),matrix:[1,0,0,1,0,0]};
 expect(setBreakoutRegion(id,r).ok).toBe(true);expect(setPanelClipMode([id],'normal').ok).toBe(true);expect((getProject().layers[id] as ImageLayer).panelClip?.region).toEqual(r);expect(setPanelClipMode([id],'whole').ok).toBe(true);
 const before=getProject(), tree={geometry:f.panel.geometry,style:f.panel.style,children:[{geometry:rectangle({x:0,y:0,width:80,height:160}),style:f.panel.style,children:[]},{geometry:rectangle({x:80,y:0,width:80,height:160}),style:f.panel.style,children:[]}]};
 for(const result of [previewCut(f.panel.id,{axis:'vertical',ratio:.5,gap:0}),previewLineCut(f.panel.id,{a:{x:80,y:0},b:{x:80,y:160},gap:0}),replaceLeafWithLayout(f.panel.id,tree),applyIndependentLayout(f.pageId,tree,f.panel.id)])expect(result).toMatchObject({ok:false,problems:[{code:'panel/breakout-split'}]});expect(getProject()).toBe(before);
 expect(unbindPanelImages([id]).ok).toBe(true);expect((getProject().layers[id] as ImageLayer).panelClip?.region).toEqual(r);expect(previewCut(f.panel.id,{axis:'vertical',ratio:.5,gap:0}).ok).toBe(true);
});
it('keeps breakout ops after every branch frame but before the next root, and normal images inside clips',()=>{
 const f=fixture(), id=f.images[0].id;bindImagesToPanel([id],f.panel.id);setPanelClipMode([id],'whole');const ops=buildPaintOps(getProject(),f.pageId,new Map()), at=ops.findIndex(op=>op.layerId===id), border=ops.findIndex(op=>op.layerId===f.outer.id&&op.kind==='panelBorder'), next=ops.findIndex(op=>op.layerId===f.other.id);
 expect(at).toBeGreaterThan(border);expect(at).toBeLessThan(next);expect(ops[at].panelClips.map(c=>c.panelId)).toEqual([f.outer.id,f.panel.id]);setPanelClipMode([id],'normal');const normal=buildPaintOps(getProject(),f.pageId,new Map());expect(normal.findIndex(op=>op.layerId===id)).toBeLessThan(normal.findIndex(op=>op.layerId===f.panel.id&&op.kind==='panelBorder'));
});
it('rejects unknown modes, invalid region matrices, crop coexistence and malformed shapes without healing imports',()=>{
 const f=fixture(),id=f.images[0].id;bindImagesToPanel([id],f.panel.id); const before=getProject();
 for(const policy of [{mode:'bad'},{mode:'partial'},{mode:'partial',region:{shape:'ellipse',geometry:rectangle({x:0,y:0,width:10,height:10}),matrix:[0,0,0,0,0,0]}}]){const p=structuredClone(before);(p.layers[id] as ImageLayer).panelClip=policy as never;expect(validateProject(p).ok).toBe(false);expect(replaceDocument(p).ok).toBe(false);expect(getProject()).toBe(before);}
});
it('places concave/clipped labels inside the visible area, skips hidden ancestors and keeps locked labels',()=>{
 const f=fixture(), p=structuredClone(getProject());const panel=p.layers[f.panel.id] as PanelLayer;panel.geometryMode='simple';panel.geometry=[{x:0,y:0},{x:160,y:0},{x:160,y:160},{x:110,y:160},{x:110,y:40},{x:50,y:40},{x:50,y:160},{x:0,y:160}];panel.matrix=[1,0,0,1,0,0];p.layers[f.outer.id].matrix=[1,0,0,1,100,100];const label=getPanelNumberLabels(p,f.pageId).find(l=>l.id===panel.id)!;
 expect(label.pageTopLeft).toEqual({x:100,y:100});panel.locked=true;expect(getPanelNumberLabels(p,f.pageId).some(l=>l.id===panel.id)).toBe(true);p.layers[f.outer.id].visible=false;expect(getPanelNumberLabels(p,f.pageId).some(l=>l.id===panel.id)).toBe(false);
 const area=regionArea(ellipseRegion(0,0,100,50,[1,0,0,1,0,0]));expect(area).toBeLessThan(Math.PI*5000);expect(area).toBeGreaterThan(Math.PI*5000*.995);
});
it('resolves exact association shortcuts while preserving input, composition and gesture ownership',()=>{
 const event={key:'b',ctrlKey:true,metaKey:false,altKey:true,shiftKey:false,isComposing:false,keyCode:66}, ctx={textEditing:false,inputFocused:false,modalOpen:false,gestureActive:false};expect(resolveShortcut(event,ctx)).toBe('bindImages');expect(resolveShortcut({...event,shiftKey:true},ctx)).toBe('unbindImages');
 for(const context of [{...ctx,inputFocused:true},{...ctx,gestureActive:true},{...ctx,composing:true},{...ctx,textEditing:true},{...ctx,modalOpen:true}])expect(resolveShortcut(event,context)).toBeNull();expect(resolveShortcut({...event,keyCode:229},ctx)).toBeNull();
});
