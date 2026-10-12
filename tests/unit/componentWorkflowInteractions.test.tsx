import {beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,render,cleanup} from '@testing-library/react';
import {createProject,createLayer} from '../../src/domain/factories';
import {replaceDocument,undo} from '../../src/history/commandBus';
import {getDocument,getProject} from '../../src/state/documentStore';
import {sessionStore} from '../../src/state/sessionStore';
import {numberFixture} from '../helpers/numberFixture';
import {clearGeometryNode,commitNodeEdit,currentNodeEdit,nodeKeyboard,nodeKeyUp,pickPanelVertex,selectGeometryNode,constrainNodeGeometry} from '../../src/interaction/geometryNodeEdit';
import {getElementHints} from '../../src/commands/elementHints';
import {RangeNumberValue} from '../../src/ui/RangeNumberField';
import {readStoredPreferences,PREFERENCES_KEY} from '../../src/preferences/persistence';

let id:string;
beforeEach(()=>{cleanup();clearGeometryNode();localStorage.clear();const p=createProject(),pageId=p.pageOrder[0],l=createLayer('panel',pageId);p.layers[l.id]=l;p.pages[pageId].roots.push(l.id);expect(replaceDocument(numberFixture(p)).ok).toBe(true);id=l.id;sessionStore.setState({activePageId:pageId,selection:[id],toolMode:'geometry',geometryConstraint:'parallelogram'});selectGeometryNode(id,0);});
describe('单节点与实际快捷提示',()=>{
  it('keeps the last legal simple-contour preview when the next point would self-intersect',()=>{
    const p=structuredClone(getProject()),l=p.layers[id];if(l.type!=='panel')throw Error('panel');l.geometryMode='simple';l.style.borderRadius=0;
    const legal=l.geometry.map((v,i)=>i===0?{x:10,y:10}:v),invalid=l.geometry.map((v,i)=>i===0?{x:700,y:300}:v);
    expect(constrainNodeGeometry(p,id,legal)).toEqual(legal);expect(constrainNodeGeometry(p,id,invalid,legal)).toEqual(legal);expect(p.layers[id]).toEqual(l);
  });
  it('moves only the selected vertex along page axes and groups held keys in one undo',()=>{
    const before=structuredClone(getProject()),layer=before.layers[id];if(layer.type!=='panel')throw Error('panel');
    for(let i=0;i<10;i++)expect(nodeKeyboard(new KeyboardEvent('keydown',{key:'ArrowRight',ctrlKey:true}))).toEqual({ok:true,value:true});
    expect(getDocument().history.past).toHaveLength(0);const preview=currentNodeEdit()!.preview.layers[id];if(preview.type!=='panel')throw Error('panel');expect(preview.geometry[0].x).toBe(10);expect(preview.geometry.slice(1)).toEqual(layer.geometry.slice(1));
    expect(nodeKeyUp('ArrowRight').ok).toBe(true);expect(getDocument().history.past).toHaveLength(1);expect(undo().ok).toBe(true);expect(getProject()).toEqual(before);
  });
  it('cycles nodes without document mutation and maps 10px shift movement through a rotated matrix',()=>{
    const p=structuredClone(getProject()),l=p.layers[id];l.matrix=[0,1,-1,0,400,0];expect(replaceDocument(p).ok).toBe(true);sessionStore.setState({activePageId:p.pageOrder[0],selection:[id],toolMode:'geometry'});selectGeometryNode(id,0);
    expect(nodeKeyboard(new KeyboardEvent('keydown',{key:'ArrowRight',altKey:true})).ok).toBe(true);expect(getProject()).toEqual(p);
    nodeKeyboard(new KeyboardEvent('keydown',{key:'ArrowRight',ctrlKey:true,shiftKey:true}));const n=currentNodeEdit()!.preview.layers[id];if(n.type!=='panel'||l.type!=='panel')throw Error('panel');expect(n.geometry[1].x).toBe(l.geometry[1].x);expect(n.geometry[1].y).toBe(l.geometry[1].y-10);expect(commitNodeEdit().ok).toBe(true);
  });
  it('uses CSS-pixel vertex distance and prevents hidden/locked targets from editing',()=>{
    const p=getProject();expect(pickPanelVertex(p,id,{x:7,y:0},{zoom:1,pan:{x:0,y:0}})).toBe(0);expect(pickPanelVertex(p,id,{x:9,y:0},{zoom:1,pan:{x:0,y:0}})).toBe(null);
    const copy=structuredClone(p);copy.layers[id].locked=true;expect(replaceDocument(copy).ok).toBe(true);sessionStore.setState({selection:[id],toolMode:'geometry'});selectGeometryNode(id,0);expect(nodeKeyboard(new KeyboardEvent('keydown',{key:'ArrowRight',ctrlKey:true}))).toEqual({ok:true,value:false});expect(currentNodeEdit()).toBeNull();
  });
  it('reads both current aliases and exposes context-specific material/panel gestures',()=>{
    const rows=getElementHints({kind:'canvas',projectId:getProject().id,layerId:id},{duplicate:[{key:'F3',primary:false,alt:false,shift:false}]});expect(rows.find(r=>r.label==='复制一份')!.binding).toBe('F3');expect(rows.some(r=>r.binding==='Ctrl＋拖动顶点')).toBe(true);expect(rows.some(r=>r.binding==='Alt＋单击')).toBe(true);
    const library=getElementHints({kind:'component',componentKind:'rect-panel',label:'矩形分镜'},{'tool-geometry':[{key:'F2',primary:false,alt:false,shift:false}]});
    expect(library.find(r=>r.label==='几何编辑工具')).toMatchObject({binding:'F2',note:'放置并选中后'});expect(library.some(r=>r.label==='复制')).toBe(true);expect(library.some(r=>r.label==='置于顶层')).toBe(true);
    expect(getElementHints({kind:'component',componentKind:'text',label:'文字'},{}).some(r=>r.label==='编辑文字')).toBe(true);
    expect(getElementHints({kind:'asset',projectId:getProject().id,assetId:'preview'},{}).some(r=>r.label==='拖动后关联到分镜')).toBe(true);
  });
  it('preserves an old custom G binding instead of resetting preferences when tools are added',()=>{
    localStorage.setItem(PREFERENCES_KEY,JSON.stringify({version:1,generation:'old',theme:'dark',snap16:true,showPanelNumbers:false,exportScale:2,shortcuts:{'fit-page':[{key:'g',primary:false,alt:false,shift:false}]}}));
    const p=readStoredPreferences()!;expect(p.theme).toBe('dark');expect(p.shortcuts['fit-page']![0].key).toBe('g');expect(p.shortcuts['tool-geometry']).toEqual([]);
  });
});
describe('滑块数值草稿',()=>{
  it('applies a confirmed number once, preserves invalid input and cancels with Escape',()=>{
    const apply=vi.fn(()=>({ok:true as const,value:undefined})),view=render(<RangeNumberValue label="透明度" value={100} min={0} max={100} unit="%" apply={apply}/>),input=view.getByLabelText('透明度数值');
    fireEvent.focus(input);fireEvent.change(input,{target:{value:'50'}});fireEvent.keyDown(input,{key:'Enter'});expect(apply).toHaveBeenCalledTimes(1);expect(apply).toHaveBeenCalledWith(50);
    fireEvent.focus(input);fireEvent.change(input,{target:{value:'101'}});fireEvent.keyDown(input,{key:'Enter'});expect(apply).toHaveBeenCalledTimes(1);expect(input.getAttribute('aria-invalid')).toBe('true');fireEvent.keyDown(input,{key:'Escape'});expect((input as HTMLInputElement).value).toBe('100');
  });
  it('does not accept composing Enter or commit a stale document draft',()=>{
    const apply=vi.fn(),view=render(<RangeNumberValue label="力度" value={0} min={-.45} max={.45} step={.001} apply={apply}/>),input=view.getByLabelText('力度数值');
    fireEvent.focus(input);fireEvent.change(input,{target:{value:'.2'}});fireEvent.compositionStart(input);fireEvent.keyDown(input,{key:'Enter'});expect(apply).not.toHaveBeenCalled();fireEvent.compositionEnd(input);replaceDocument(createProject());fireEvent.blur(input);expect(apply).not.toHaveBeenCalled();expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});
