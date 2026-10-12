import { createLayer, createProject } from '../../src/domain/factories';
import { replaceDocument } from '../../src/history/commandBus';
import { replaceRuntimeResources } from '../../src/storage/blobRepository';
import { decodeImage } from '../../src/assets/importImage';
import { sessionStore } from '../../src/state/sessionStore';
import { rectangle } from '../../src/panels/presets';
import { numberFixture } from '../helpers/numberFixture';
import type { PanelLayer, ImageLayer } from '../../src/domain/types';

export async function panelBindingScene() {
 const project=createProject({background:false}),pageId=project.pageOrder[0];Object.assign(project.pages[pageId],{width:640,height:480,dpi:72});
 const c=document.createElement('canvas');c.width=320;c.height=240;const ctx=c.getContext('2d')!;ctx.fillStyle='#ff000080';ctx.fillRect(0,0,320,240);ctx.clearRect(200,160,20,20);
 const blob=await new Promise<Blob>(r=>c.toBlob(b=>r(b!),'image/png'));c.width=c.height=0;const decoded=await decodeImage(new File([blob],'人物.png',{type:'image/png'}),new AbortController().signal);if(!decoded.ok)throw Error(JSON.stringify(decoded)); const a=decoded.value;project.assets[a.meta.id]=a.meta;project.libraryAssetIds=[a.meta.id];project.assetLibrary!.assetFolder[a.meta.id]=null;
 const outer=createLayer('panel',pageId) as PanelLayer,panel=createLayer('panel',pageId) as PanelLayer,upper=createLayer('panel',pageId) as PanelLayer,image=createLayer('image',pageId) as ImageLayer;
 outer.geometry=rectangle({x:0,y:0,width:140,height:140});outer.matrix=[1,0,0,1,100,100];outer.role='split';outer.children=[panel.id];outer.style.borderWidth=3;
 panel.geometry=rectangle({x:0,y:0,width:120,height:120});panel.parentId=outer.id;panel.children=[image.id];panel.style.borderWidth=6;
 upper.geometry=rectangle({x:0,y:0,width:100,height:140});upper.matrix=[1,0,0,1,330,80];upper.style.fill='#0000FFFF';upper.style.borderWidth=0;
 image.width=320;image.height=240;image.assetId=a.meta.id;image.parentId=panel.id;image.matrix=[1,0,0,1,-50,-50];
 for(const l of[outer,panel,upper,image])project.layers[l.id]=l;project.pages[pageId].roots=[outer.id,upper.id];numberFixture(project);const r=replaceDocument(project);if(!r.ok)throw Error(JSON.stringify(r));
 replaceRuntimeResources(new Map([[a.meta.originalHash,a.original],[a.meta.renderHash,a.render]]),new Map([[a.meta.renderHash,a.bitmap]]));
 sessionStore.setState({activePageId:pageId,selection:[image.id],scopeId:null,snap16:false,viewportByPage:{[pageId]:{zoom:1,pan:{x:20,y:20}}}});
 await document.fonts.ready;await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));
 return {pageId,outerId:outer.id,panelId:panel.id,upperId:upper.id,imageId:image.id,assetId:a.meta.id};
}
