import { beforeEach, expect, it } from 'vitest';
import { createProject, createPage, createLayer } from '../../src/domain/factories';
import type { BubbleLayer, BubbleTailLayer, GroupLayer } from '../../src/domain/types';
import { replaceDocument, undo } from '../../src/history/commandBus';
import { getDocument, getProject } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';
import { createAttachedTail } from '../../src/bubbles/tailCommands';
import { createDialogue } from '../../src/bubbles/dialogueCommands';
import { copyLayers, pasteLayers } from '../../src/layers/clipboard';
import { deleteSelected } from '../../src/app/actions';
import { validateProject } from '../../src/domain/validate';
import { worldMatrix } from '../../src/geometry/matrix';
import { beginBubbleShapeEdit, updateBubbleContour, editableContour } from '../../src/bubbles/shapeController';
import { cancelMangaEdit } from '../../src/bubbles/mangaEditController';
import { affectedMangaIds } from '../../src/bubbles/affectedMangaIds';
let bodies:BubbleLayer[];
beforeEach(()=>{cancelMangaEdit();const p=createProject({background:false}),pid=p.pageOrder[0];bodies=[0,1,2].map(i=>{const b=createLayer('bubble',pid) as BubbleLayer;b.matrix=[1,0,0,1,80+i*160,80];p.layers[b.id]=b;p.pages[pid].roots.push(b.id);return b;});const second=createPage({width:800,height:600});p.pages[second.id]=second;p.pageOrder.push(second.id);expect(replaceDocument(p).ok).toBe(true);sessionStore.setState({activePageId:pid,selection:[]});});
it('copies a whole dialogue into another page with fresh relation, body/text/tail IDs and no cross-copy references',()=>{
  const tail=createAttachedTail(bodies[1].id,'curved');if(!tail.ok)throw Error(JSON.stringify(tail));const group=createDialogue(bodies.map(b=>b.id),'connector');if(!group.ok)throw Error(JSON.stringify(group));const source=getProject(),copy=copyLayers([group.value]);if(!copy.ok)throw Error(JSON.stringify(copy));const originalIDs=Object.keys(copy.value.layers),pageId=source.pageOrder[1],pasted=pasteLayers(copy.value,pageId,{x:16,y:16});expect(pasted.ok).toBe(true);if(!pasted.ok)throw Error(JSON.stringify(pasted));const g=getProject().layers[pasted.value[0]] as GroupLayer;expect(g.dialogue!.links.every(e=>g.children.includes(e.from)&&g.children.includes(e.to)&&!originalIDs.includes(e.from)&&!originalIDs.includes(e.to))).toBe(true);for(const id of g.children){const b=getProject().layers[id] as BubbleLayer;expect(b.pageId).toBe(pageId);expect(b.parentId).toBe(g.id);for(const cid of b.children){expect(getProject().layers[cid].parentId).toBe(b.id);expect(originalIDs).not.toContain(cid);}}
  const cloned=getProject();sessionStore.setState({activePageId:source.pageOrder[0],selection:[group.value]});expect(deleteSelected().ok).toBe(true);expect(validateProject(getProject()).ok).toBe(true);expect(getProject().layers[g.id]).toEqual(cloned.layers[g.id]);undo();undo();expect(getProject()).toEqual(source);
});
it('copying only a bound tail leaves the source intact and pastes a free tail with frozen appearance in world space',()=>{
  const r=createAttachedTail(bodies[0].id,'triangle');if(!r.ok)throw Error(JSON.stringify(r));const source=getProject(),tail=source.layers[r.value] as BubbleTailLayer,copy=copyLayers([tail.id]);if(!copy.ok)throw Error(JSON.stringify(copy));expect(getProject()).toBe(source);expect(copy.value.layers[tail.id]).toMatchObject({parentId:null,attachment:{mode:'free'},style:(source.layers[bodies[0].id] as BubbleLayer).style});expect(copy.value.layers[tail.id].matrix).toEqual(worldMatrix(source,tail.id));const p=pasteLayers(copy.value,source.pageOrder[1],{x:0,y:0});expect(p.ok).toBe(true);expect(validateProject(getProject()).ok).toBe(true);undo();expect(getProject()).toEqual(source);
});
it('a locked tail blocks contour movement while every tentative update leaves document and history intact',()=>{const r=createAttachedTail(bodies[0].id,'triangle');if(!r.ok)throw Error(JSON.stringify(r));const p=structuredClone(getProject());p.layers[r.value].locked=true;replaceDocument(p);const before=getDocument();expect(beginBubbleShapeEdit(bodies[0].id).ok).toBe(true);const b=p.layers[bodies[0].id] as BubbleLayer,c=editableContour(b);if(!c.ok)throw Error('contour');const points=structuredClone(c.value.nodes);points[0].x-=.01;expect(updateBubbleContour(points).ok).toBe(false);expect(getDocument()).toBe(before);cancelMangaEdit();});
it('expands a changed bound tail to its complete dialogue dependency without unrelated roots or duplicate IDs',()=>{
  const tail=createAttachedTail(bodies[0].id,'line');if(!tail.ok)throw Error(JSON.stringify(tail));const group=createDialogue([bodies[0].id,bodies[1].id],'connector');if(!group.ok)throw Error(JSON.stringify(group));const affected=affectedMangaIds(getProject(),[tail.value,tail.value]);expect(affected).toEqual(expect.arrayContaining([tail.value,group.value,bodies[0].id,bodies[1].id]));expect(affected).not.toContain(bodies[2].id);expect(new Set(affected).size).toBe(affected.length);
});
