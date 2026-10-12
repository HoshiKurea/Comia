import { afterEach,expect,it,vi } from 'vitest';
import { createDefaultPanelLayout,validatePanelLayout,panelGroup } from '../../src/workspacePanels/layoutModel';
import { movePanels,closePanel,showPanel,resetLayout,setActivePanel } from '../../src/workspacePanels/layoutCommands';
import { dockWidths,fitFloatingRect } from '../../src/workspacePanels/layoutGeometry';
import { panelLayoutStore,publishLayout,installPanelPersistence } from '../../src/workspacePanels/panelLayoutStore';
import { loadPanelLayout,PANEL_LAYOUT_KEY } from '../../src/workspacePanels/layoutPersistence';
import { getDocument } from '../../src/state/documentStore';
import type { PanelLayout } from '../../src/workspacePanels/types';
const good=(r:ReturnType<typeof movePanels>)=>{expect(r.ok).toBe(true);if(!r.ok)throw Error('layout');return r.value;};
afterEach(()=>{localStorage.clear();vi.useRealTimers();});
it('keeps every panel uniquely owned through detach, merge, same-group reorder and full-group docking',()=>{
 let l=createDefaultPanelLayout();l=good(movePanels(l,{kind:'tab',panel:'assets'},{kind:'float',rect:{x:80,y:80,width:300,height:350}}));
 expect(panelGroup(l,'components')!.tabs).toEqual(['components','pages']);const f=panelGroup(l,'assets')!;expect(l.floating[0].groupId).toBe(f.id);
 l=good(movePanels(l,{kind:'tab',panel:'assets'},{kind:'merge',groupId:'pg-lower',index:1}));expect(l.groups['pg-lower'].tabs).toEqual(['layers','assets','history']);expect(l.floating).toHaveLength(0);
 l=good(movePanels(l,{kind:'tab',panel:'layers'},{kind:'merge',groupId:'pg-lower',index:3}));expect(l.groups['pg-lower'].tabs).toEqual(['assets','history','layers']);
 l=good(movePanels(l,{kind:'group',groupId:'pg-lower'},{kind:'dock',side:'left',index:0}));expect(l.docks.left.groups).toEqual(['pg-lower','pg-left']);expect(l.docks.right.groups).toEqual(['pg-hints','pg-upper']);expect(validatePanelLayout(l).ok).toBe(true);
});
it('restores all seven panels after closing everything without modifying comic content or history',()=>{
 const before=getDocument();let l=createDefaultPanelLayout();for(const id of ['components','assets','pages','inspector','layers','history','hints'] as const)l=good(closePanel(l,id));
 expect(l.groups).toEqual({});expect(l.hidden).toHaveLength(7);expect(validatePanelLayout(l).ok).toBe(true);
 l=good(showPanel(l,'history'));expect(panelGroup(l,'history')?.active).toBe('history');l=good(resetLayout(l));expect(l.hidden).toEqual([]);expect(getDocument()).toBe(before);
});
it('selects the next or previous active tab when closing and ignores already closed panels',()=>{
 let l=good(setActivePanel(createDefaultPanelLayout(),'assets'));l=good(closePanel(l,'assets'));expect(l.groups['pg-left'].active).toBe('pages');expect(good(closePanel(l,'assets'))).toBe(l);
 l=good(closePanel(l,'pages'));expect(l.groups['pg-left'].active).toBe('components');
});
it('rejects stale revisions and missing targets without changing the caller layout',()=>{
 const l=createDefaultPanelLayout(),copy=structuredClone(l);expect(movePanels(l,{kind:'tab',panel:'assets'},{kind:'dock',side:'right',index:0},2).ok).toBe(false);
 expect(movePanels(l,{kind:'group',groupId:'gone'},{kind:'dock',side:'right',index:0}).ok).toBe(false);expect(movePanels(l,{kind:'tab',panel:'assets'},{kind:'merge',groupId:'gone',index:0}).ok).toBe(false);expect(l).toEqual(copy);
});
it('rejects damaged topology, duplicate ownership, nonfinite sizes, invalid versions and missing panels',()=>{
 const change=[(l:any)=>l.version=99,(l:PanelLayout)=>l.groups['pg-left'].tabs.push('layers'),(l:PanelLayout)=>l.hidden.push('assets'),(l:PanelLayout)=>l.groups['pg-left'].tabs.pop(),(l:PanelLayout)=>l.docks.right.weights[0]=NaN,(l:PanelLayout)=>l.groups['pg-left'].active='history',(l:PanelLayout)=>l.docks.left.groups.push('pg-upper'),(l:PanelLayout)=>delete l.groups['pg-upper']];
 for(const mutate of change){const l=createDefaultPanelLayout();mutate(l);expect(validatePanelLayout(l).ok).toBe(false);}
 const l=good(movePanels(createDefaultPanelLayout(),{kind:'tab',panel:'assets'},{kind:'float',rect:{x:0,y:0,width:300,height:300}}));l.floating[0].rect.x=Infinity;expect(validatePanelLayout(l).ok).toBe(false);
});
it('fits floating titles into the workspace and preserves positive sizes on tiny screens',()=>{
 for(const size of [{width:900,height:700},{width:100,height:60},{width:0,height:0}]){const r=fitFloatingRect({x:1e6,y:-1e6,width:400,height:500},size);expect(r.width).toBeGreaterThan(0);expect(r.height).toBeGreaterThan(0);expect(r.x).toBeGreaterThanOrEqual(8);expect(r.y).toBeGreaterThanOrEqual(8);}
 const l=createDefaultPanelLayout();expect(dockWidths(l,390).narrow).toBe(true);const w=dockWidths(l,800);expect(w.left+w.right).toBeLessThanOrEqual(560);expect(800-w.left-w.right).toBeGreaterThanOrEqual(240);
});
it('persists committed layout once after debounce and reloads it without changing the document',()=>{
 vi.useFakeTimers();localStorage.clear();const original=getDocument(),l=createDefaultPanelLayout();panelLayoutStore.setState({layout:l});const off=installPanelPersistence();
 const next=good(movePanels(l,{kind:'tab',panel:'pages'},{kind:'float',rect:{x:90,y:100,width:300,height:420}}));publishLayout({ok:true,value:next});expect(localStorage.getItem(PANEL_LAYOUT_KEY)).toBeNull();vi.advanceTimersByTime(300);
 expect(loadPanelLayout()).toEqual(next);expect(getDocument()).toBe(original);off();
});
it('falls back to a complete default when stored settings are damaged or over budget',()=>{
 for(const value of ['{broken','x'.repeat(65537),JSON.stringify({version:99})]){localStorage.setItem(PANEL_LAYOUT_KEY,value);expect(loadPanelLayout()).toEqual(createDefaultPanelLayout());}
});
it('can rescue a layout whose revision reached the safe integer limit',()=>{
 const l=createDefaultPanelLayout();l.revision=Number.MAX_SAFE_INTEGER;expect(movePanels(l,{kind:'tab',panel:'assets'},{kind:'float',rect:{x:40,y:40,width:300,height:400}}).ok).toBe(false);expect(good(resetLayout(l))).toEqual(createDefaultPanelLayout());
});
