import { beforeEach, afterEach, it, expect } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { MaskEditor } from '../../src/images/MaskEditor';
import { beginMaskEdit, cancelMaskEdit, selectMaskTarget, currentMaskEdit, previewMaskImage, commitMaskEdit } from '../../src/images/maskController';
import { createLayer, createProject } from '../../src/domain/factories';
import { replaceDocument, undo } from '../../src/history/commandBus';
import { getProject } from '../../src/state/documentStore';
import type { ImageLayer } from '../../src/domain/types';

let id: string;
beforeEach(() => {
  const p=createProject({background:false}),pageId=p.pageOrder[0],image=createLayer('image',pageId) as ImageLayer,assetId=crypto.randomUUID();
  p.assets[assetId]={id:assetId,name:'输入原图.png',width:320,height:240,originalMime:'image/png',renderMime:'image/png',originalHash:'a'.repeat(64),renderHash:'b'.repeat(64),originalBytes:1,renderBytes:1,framePolicy:'still',normalizedOrientation:true};
  image.assetId=assetId;image.width=320;image.height=240;image.matrix=[1,0,0,1,160,120];p.layers[image.id]=image;p.pages[pageId].roots=[image.id];id=image.id;
  expect(replaceDocument(p).ok).toBe(true);expect(beginMaskEdit(id,'rect').ok).toBe(true);
  render(<MaskEditor viewport={{zoom:1,pan:{x:0,y:0}}}/>);
});
afterEach(()=>{cleanup();cancelMaskEdit();});
it('switching image/mask numeric targets immediately exposes the target value and committing typed input preserves one-step undo',()=>{
  const before=structuredClone(getProject());
  for(let i=0;i<20;i++){
    act(()=>selectMaskTarget('image'));expect((screen.getByLabelText('遮罩编辑X') as HTMLInputElement).value).toBe('160');
    act(()=>selectMaskTarget('mask'));expect((screen.getByLabelText('遮罩编辑X') as HTMLInputElement).value).toBe('0');
  }
  act(()=>selectMaskTarget('image'));const input=screen.getByLabelText('遮罩编辑X');fireEvent.focus(input);fireEvent.change(input,{target:{value:'190'}});fireEvent.blur(input);
  expect((currentMaskEdit()!.preview.layers[id] as ImageLayer).matrix[4]).toBe(190);expect(getProject()).toEqual(before);
  act(()=>{expect(commitMaskEdit().ok).toBe(true);});expect((getProject().layers[id] as ImageLayer).matrix[4]).toBe(190);expect(undo().ok).toBe(true);expect(getProject()).toEqual(before);
});
it('a preview synchronization does not overwrite an in-progress focused numeric draft',()=>{
  act(()=>selectMaskTarget('image'));const input=screen.getByLabelText('遮罩编辑X') as HTMLInputElement;fireEvent.focus(input);fireEvent.change(input,{target:{value:'190'}});
  act(()=>{const image=currentMaskEdit()!.preview.layers[id] as ImageLayer;expect(previewMaskImage({...image,matrix:[1,0,0,1,200,120]}).ok).toBe(true);});
  expect(input.value).toBe('190');fireEvent.blur(input);expect((currentMaskEdit()!.preview.layers[id] as ImageLayer).matrix[4]).toBe(190);
});
