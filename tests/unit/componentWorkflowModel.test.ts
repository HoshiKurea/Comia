import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer, createProject } from '../../src/domain/factories';
import { newId } from '../../src/domain/id';
import { validateProject } from '../../src/domain/validate';
import { emptyAssetLibrary, validateAssetLibrary } from '../../src/assets/folderModel';
import { createAssetFolder, moveAssetFolder, removeAssetFolder, renameAssetFolder } from '../../src/assets/folderCommands';
import { getProject } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';
import { replaceDocument, undo, redo } from '../../src/history/commandBus';
import { captureComponentPreset, describePresetCapture, renameUserTemplate, saveComponentRecipe, deleteUserTemplate } from '../../src/library/templates';
import { validateComponentPreset } from '../../src/library/presetModel';
import { createObjectDraft, placeObjectDraft } from '../../src/app/actions';
import { migrateProject } from '../../src/storage/migrateProject';
import { numberFixture } from '../helpers/numberFixture';
import { createAttachedTail } from '../../src/bubbles/tailCommands';

beforeEach(() => { const p=createProject(); expect(replaceDocument(p).ok).toBe(true); sessionStore.setState({activePageId:p.pageOrder[0],selection:[]}); });
describe('素材目录数据与事务',()=>{
  it('restores folders and rename/deletion through undo and redo without changing canvas',()=>{
    const a=createAssetFolder('人物',null);if(!a.ok)throw Error('folder'); const b=createAssetFolder('主角',a.value);if(!b.ok)throw Error('child');
    expect(renameAssetFolder(b.value,'角色').ok).toBe(true);const layers=getProject().layers;expect(removeAssetFolder(a.value).ok).toBe(true);
    expect(getProject().assetLibrary!.folders[b.value].parentId).toBe(null);expect(getProject().layers).toEqual(layers);
    expect(undo().ok).toBe(true);expect(getProject().assetLibrary!.folders[b.value].parentId).toBe(a.value);expect(redo().ok).toBe(true);
  });
  it('refuses cycles, normalized sibling duplicates and excessive depth atomically',()=>{
    const a=createAssetFolder('A',null);if(!a.ok)throw Error('a');const b=createAssetFolder('B',a.value);if(!b.ok)throw Error('b');
    const before=getProject();expect(moveAssetFolder(a.value,b.value).ok).toBe(false);expect(getProject()).toBe(before);expect(createAssetFolder(' a ',null).ok).toBe(false);
    let parent=b.value;for(let i=3;i<=8;i++){const f=createAssetFolder(String(i),parent);if(!f.ok)throw Error('depth');parent=f.value;}expect(createAssetFolder('9',parent).ok).toBe(false);
  });
  it('moves child folders up with collision-safe names and rejects orphan asset mappings',()=>{
    const a=createAssetFolder('A',null);if(!a.ok)throw Error('a');createAssetFolder('角色',null); const b=createAssetFolder('角色',a.value);if(!b.ok)throw Error('b');
    expect(removeAssetFolder(a.value).ok).toBe(true);expect(getProject().assetLibrary!.folders[b.value].name).toBe('角色 (2)');
    const id=newId(),org=emptyAssetLibrary([id]);org.assetFolder[id]=newId();expect(validateAssetLibrary(org,[id]).ok).toBe(false);
  });
  it('upgrades old v7 folders to an empty organization without mutating input',()=>{
    const p=createProject();p.schemaVersion=7;delete p.assetLibrary;const before=structuredClone(p),r=migrateProject(p);
    expect(r.ok).toBe(true);if(!r.ok)throw Error('migration');expect(r.value.schemaVersion).toBe(14);expect(r.value.assetLibrary).toEqual(emptyAssetLibrary());expect(p).toEqual(before);
  });
});
describe('可编辑组件配方',()=>{
  it('renames and updates a preset atomically without changing existing artwork and restores the recipe through undo/redo',()=>{
    const pageId=getProject().pageOrder[0],body=createObjectDraft('bubble-soft',pageId);if(!body.ok)throw Error('bubble');expect(placeObjectDraft(body.value,pageId,{x:200,y:200}).ok).toBe(true);
    const saved=captureComponentPreset([body.value.layer.id],'原预设');if(!saved.ok)throw Error('save');const source=structuredClone(getProject().layers);
    expect(renameUserTemplate(saved.value,' 新预设 ').ok).toBe(true);expect(getProject().templates[saved.value].name).toBe('新预设');expect(getProject().layers).toEqual(source);
    const other=captureComponentPreset([body.value.layer.id],'其他');if(!other.ok)throw Error('other');const before=getProject();expect(renameUserTemplate(saved.value,'其他').ok).toBe(false);expect(getProject()).toBe(before);
    const old=structuredClone(before.templates[saved.value]);if(!('recipe'in old)||old.recipe.kind!=='scene')throw Error('recipe');const next=structuredClone(old.recipe),bubble=Object.values(next.nodes).find(n=>n.type==='bubble');if(!bubble||bubble.type!=='bubble')throw Error('node');bubble.style.borderWidth=9;
    expect(saveComponentRecipe('新预设',next,saved.value).ok).toBe(true);expect(getProject().layers).toEqual(source);expect(undo().ok).toBe(true);expect(getProject().templates[saved.value]).toEqual(old);expect(redo().ok).toBe(true);
    const recipe=getProject().templates[saved.value];if(!('recipe'in recipe)||recipe.recipe.kind!=='scene')throw Error('recipe');expect(Object.values(recipe.recipe.nodes).find(n=>n.type==='bubble')).toMatchObject({style:{borderWidth:9}});
    expect(deleteUserTemplate(saved.value).ok).toBe(true);expect(getProject().layers).toEqual(source);expect(undo().ok).toBe(true);expect(getProject().templates[saved.value]).toEqual(recipe);
  });
  it('captures bubble/text and preserves independent IDs, parameters and one placement transaction',()=>{
    const pageId=getProject().pageOrder[0],draft=createObjectDraft('bubble-rough',pageId);if(!draft.ok)throw Error('bubble');expect(placeObjectDraft(draft.value,pageId,{x:200,y:300}).ok).toBe(true);
    const source=structuredClone(getProject().layers),r=captureComponentPreset([draft.value.layer.id],'粗糙气泡');if(!r.ok)throw Error(r.problems[0].message);
    const p=getProject(),t=p.templates[r.value];if(!('recipe'in t)||t.recipe.kind!=='scene')throw Error('recipe');
    expect(Object.keys(t.recipe.nodes)).toHaveLength(2);expect(Object.keys(t.recipe.nodes)).not.toContain(draft.value.layer.id);expect(getProject().layers).toEqual(source);
    const a=createObjectDraft(`template:${r.value}`,pageId),b=createObjectDraft(`template:${r.value}`,pageId);if(!a.ok||!b.ok)throw Error('instantiate');
    expect(a.value.independentRoots).toBe(true);expect(new Set([...a.value.descendants,...b.value.descendants].map(l=>l.id)).size).toBe(4);
    expect(placeObjectDraft(a.value,pageId,{x:600,y:500}).ok).toBe(true);expect(getProject().pages[pageId].roots).not.toContain(a.value.layer.id);
    const nodes=Object.values(getProject().layers);expect(nodes.filter(l=>l.type==='bubble')).toHaveLength(2);expect(undo().ok).toBe(true);expect(getProject().layers).toEqual(source);
  });
  it('captures a selected bound tail as an independent tail without changing its source owner',()=>{
    const pageId=getProject().pageOrder[0],body=createObjectDraft('bubble',pageId);if(!body.ok)throw Error('body');expect(placeObjectDraft(body.value,pageId,{x:200,y:300}).ok).toBe(true);
    const tail=createAttachedTail(body.value.layer.id,'triangle');if(!tail.ok)throw Error(tail.problems[0].message);
    const before=structuredClone(getProject()),result=describePresetCapture(getProject(),[tail.value]);expect(result.ok).toBe(true);if(!result.ok)throw Error('tail');
    const node=Object.values(result.value.recipe.nodes)[0];if(node.type!=='bubbleTail')throw Error('type');expect(node.attachment.mode).toBe('free');expect(node.style).not.toBe(null);expect(getProject()).toEqual(before);
    const child=body.value.descendants.find(l=>l.type==='text');if(!child||child.type!=='text')throw Error('owned text');
    const textCapture=describePresetCapture(getProject(),[child.id]);if(!textCapture.ok)throw Error(textCapture.problems[0].message);const freeText=Object.values(textCapture.value.recipe.nodes)[0];expect(freeText).toMatchObject({type:'text',parentId:null,text:child.text,box:child.box});expect(Object.keys(textCapture.value.recipe.nodes)).toHaveLength(1);expect(validateComponentPreset({id:newId(),name:'独立对白',recipe:textCapture.value.recipe}).ok).toBe(true);expect(getProject()).toEqual(before);
  });
  it('rejects external references and serialized editing numbers instead of creating partial objects',()=>{
    const p=createProject(),id=p.pageOrder[0],panel=createLayer('panel',id);p.layers[panel.id]=panel;p.pages[id].roots.push(panel.id);expect(replaceDocument(numberFixture(p)).ok).toBe(true);
    const r=captureComponentPreset([panel.id],'分镜形状');if(!r.ok)throw Error('save'); const raw=structuredClone(getProject().templates[r.value]);if(!('recipe'in raw)||raw.recipe.kind!=='scene')throw Error('scene');
    const node=raw.recipe.nodes[raw.recipe.roots[0]];Object.assign(node,{editorNumber:1});expect(validateComponentPreset(raw).ok).toBe(false);
    delete (node as unknown as Record<string,unknown>).editorNumber;node.parentId=newId();expect(validateComponentPreset(raw).ok).toBe(false);
  });
  it('keeps the v8 structure through validation and refuses missing library ownership',()=>{
    const p=createProject();expect(validateProject(p).ok).toBe(true);delete p.assetLibrary;expect(validateProject(p).ok).toBe(false);
  });
});
