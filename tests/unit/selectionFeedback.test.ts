import {describe,it,expect} from 'vitest';
import {createLayer,createProject} from '../../src/domain/factories';
import {selectionOutlines,selectionPolygon} from '../../src/render/selectionOverlay';
import {compatibleShortcutDefaults} from '../../src/preferences/defaultShortcutCompatibility';
import {buildShortcutIndex,signature} from '../../src/commands/shortcutBinding';
import {numberFixture} from '../helpers/numberFixture';
const view={zoom:2,pan:{x:10,y:20}};
const digit=(key:string)=>({key,primary:true,alt:true,shift:false});
describe('canvas selection feedback and default dialogue keys',()=>{
  it('outlines every selected object once while preserving the document and selection order',()=>{
    const p=createProject(),pid=p.pageOrder[0],a=createLayer('panel',pid),b=createLayer('image',pid);if(a.type!=='panel'||b.type!=='image')throw Error('types');a.geometry=[{x:0,y:0},{x:100,y:0},{x:100,y:80},{x:0,y:80}];a.matrix=[1,0,0,1,20,30];b.width=50;b.height=40;b.matrix=[1,0,0,1,300,200];p.layers[a.id]=a;p.layers[b.id]=b;const before=structuredClone(p),ids=[a.id,b.id,a.id];const result=selectionOutlines(p,pid,ids,view);expect(result.map(o=>o.id)).toEqual([a.id,b.id]);expect(result[1].points).toEqual([{x:610,y:420},{x:710,y:420},{x:710,y:500},{x:610,y:500}]);expect(p).toEqual(before);expect(ids).toEqual([a.id,b.id,a.id]);
  });
  it('does not suppress a visible secondary object when the first ID is hidden, missing or from another page',()=>{
    const p=createProject(),pid=p.pageOrder[0],hidden=createLayer('panel',pid),other=createLayer('panel','other-page'),visible=createLayer('panel',pid);hidden.visible=false;for(const l of [hidden,other,visible])p.layers[l.id]=l;expect(selectionOutlines(p,pid,['missing',hidden.id,other.id,visible.id],view).map(x=>x.id)).toEqual([visible.id]);
  });
  it('respects ancestor visibility and shows a locked selected child as read only',()=>{
    const p=createProject(),pid=p.pageOrder[0],g=createLayer('group',pid),l=createLayer('panel',pid);if(g.type!=='group')throw Error('group');g.children=[l.id];g.locked=true;l.parentId=g.id;p.layers[g.id]=g;p.layers[l.id]=l;expect(selectionOutlines(p,pid,[l.id],view)[0].locked).toBe(true);g.visible=false;expect(selectionOutlines(p,pid,[l.id],view)).toEqual([]);
  });
  it('maps rotated and sheared ancestors through page then screen coordinates',()=>{
    const p=createProject(),pid=p.pageOrder[0],g=createLayer('group',pid),l=createLayer('panel',pid);if(g.type!=='group'||l.type!=='panel')throw Error('types');g.matrix=[.9,.2,.3,1,100,200];g.children=[l.id];l.parentId=g.id;l.matrix=[1,0,0,1,10,20];l.geometry=[{x:0,y:0},{x:50,y:0},{x:50,y:50},{x:0,y:50}];p.layers[g.id]=g;p.layers[l.id]=l;expect(selectionPolygon(p,l.id,view)[0]).toEqual({x:240,y:464});
  });
  it('uses complete preview geometry for secondary outlines rather than old base positions',()=>{
    const p=numberFixture(createProject()),id=p.pageOrder[0],a=createLayer('panel',id),b=createLayer('panel',id);p.layers[a.id]=a;p.layers[b.id]=b;const preview=structuredClone(p);preview.layers[a.id].matrix=[1,0,0,1,40,30];preview.layers[b.id].matrix=[1,0,0,1,80,60];expect(selectionOutlines(preview,id,[a.id,b.id],view).map(o=>o.points[0])).toEqual([{x:90,y:80},{x:170,y:140}]);expect(p.layers[b.id].matrix[4]).toBe(0);
  });
  it.each([['1','dialogue-connector'],['2','dialogue-fused'],['3','dialogue-overlap']]as const)('preserves an old custom %s key and only disables its conflicting new default', (key,id)=>{
    const old={copy:[digit(key)]},before=structuredClone(old),r=compatibleShortcutDefaults(old);if(!r.ok)throw Error('compat');expect(r.value.overrides.copy).toEqual(old.copy);expect(r.value.overrides[id]).toEqual([]);expect(r.value.conflicts).toContainEqual({commandId:id,occupiedBy:'copy'});const index=buildShortcutIndex(r.value.overrides);if(!index.ok)throw Error('index');expect(index.value.get(signature(digit(key)))).toBe('copy');expect(old).toEqual(before);
  });
  it('preserves explicit empty and alternative dialogue bindings',()=>{const r=compatibleShortcutDefaults({'dialogue-connector':[],'dialogue-fused':[digit('9')]});if(!r.ok)throw Error('compat');expect(r.value.overrides).toEqual({'dialogue-connector':[],'dialogue-fused':[digit('9')]});expect(r.value.conflicts).toEqual([]);});
  it('rejects unknown commands and malformed chords rather than hiding old corruption',()=>{for(const value of [null,[],{unknown:[]},{copy:[null]},{copy:[digit('1'),digit('1')]}])expect(compatibleShortcutDefaults(value).ok).toBe(false);});
});
