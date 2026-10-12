import {fail,problem,type Id,type ImageLayer,type ImageMask,type Result} from '../domain/types';
import {getProject} from '../state/documentStore';
import {beginMaskEdit,currentMaskEdit,previewMaskImage} from '../images/maskController';
import {polyBounds} from '../geometry/polygon';
import {sessionStore} from '../state/sessionStore';
export function beginImageMaskTarget(id:Id):Result<void>{
  const image=getProject().layers[id];if(image?.type!=='image'||image.pageId!==sessionStore.getState().activePageId)return fail(problem('tool/crop-target','请点击当前画布上的素材图片'));
  const hadMask=!!image.mask,r=beginMaskEdit(id,undefined,'image-mask');if(!r.ok||hadMask)return r;
  const a=currentMaskEdit()!,free=a.preview.layers[id] as ImageLayer;
  return previewMaskImage({...free,mask:{...free.mask!,matrix:[1,0,0,1,0,0],geometry:[{x:0,y:0},{x:free.width,y:0},{x:free.width,y:free.height},{x:0,y:free.height}]}});
}
export function setImageMaskShape(shape:ImageMask['shape']):Result<void>{
  const active=currentMaskEdit();if(!active)return fail(problem('tool/crop-inactive','请先点击素材图片'));
  const image=active.preview.layers[active.imageId] as ImageLayer,mask=image.mask!,b=polyBounds(mask.geometry);
  return previewMaskImage({...image,mask:{...mask,shape,geometry:shape==='polygon'?mask.geometry:[{x:b.x,y:b.y},{x:b.x+b.width,y:b.y},{x:b.x+b.width,y:b.y+b.height},{x:b.x,y:b.y+b.height}]}});
}
