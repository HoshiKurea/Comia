import type { BubbleContour, BubbleLayer, BubbleShape, BubbleStyle, HandDrawnStyle, Id, Point, Result } from '../domain/types';
import { fail, problem } from '../domain/types';
import { beginMangaEdit, cancelMangaEdit, commitMangaEdit, currentMangaEdit, mangaEditGuard, publishMangaPreview } from './mangaEditController';
import { generateContour, handDrawnPreset } from './handDrawn';
import { composeBubble } from './composeBubble';
import { bubbleTails, mainBubbleText } from './ownership';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { parseHandDrawn, parseBubbleContour,parseBubbleStyle } from '../domain/mangaValidation';
import { bubbleBodyPath, flattenPath, perimeter } from './geometry';
import { closestTailU } from './tailCommands';
import { buildTailAppearance, tailAnchors } from './tailGeometry';
import { editorGeometryTarget } from './editorTarget';
import { bubbleFrameBounds } from '../text/bubbleFrameBounds';

export const beginBubbleShapeEdit=(id:Id):Result<void>=>beginMangaEdit(id,'shape');
export const commitBubbleShapeEdit=commitMangaEdit;
export const cancelBubbleShapeEdit=cancelMangaEdit;
export function editableContour(bubble:BubbleLayer):Result<BubbleContour>{
  if(bubble.shape==='freehand')return fail(problem('drawing/no-nodes','自由绘画气泡请在绘画窗口补画或擦除修形'));
  const source=bubble.edgeStyle?.recipe==='normal-offset-v1'&&bubble.edgeStyle.wobble>0&&bubble.handDrawn?{...bubble,handDrawn:{...bubble.handDrawn,wobble:0}}:bubble;
  return generateContour({...source,handDrawn:source.handDrawn??(['handOval','handPolygon','wave'].includes(bubble.shape)?handDrawnPreset('soft'):{preset:'custom',seed:42,wobble:0,irregularity:0,pressure:0})});
}
function updateShape(mutate:(bubble:BubbleLayer)=>void):Result<void>{
  const guard=mangaEditGuard();if(!guard.ok)return guard;const active=guard.value;if(active.kind!=='shape')return fail(problem('bubble/edit-kind','当前编辑不是气泡轮廓'));
  const old=active.preview.layers[active.id];if(old.type!=='bubble')return fail(problem('bubble/target','气泡已不存在'));
  const target=structuredClone(old);try{mutate(target);}catch(error){return fail(problem('bubble/edit',(error as Error).message));}
  const signature=(b:BubbleLayer)=>[b.shape,b.width,b.height,b.contour,b.contour?null:[b.handDrawn?.wobble,b.handDrawn?.irregularity,b.handDrawn?.seed],b.edgeStyle];
  const contourChanged=JSON.stringify(signature(old))!==JSON.stringify(signature(target));
  if(contourChanged&&bubbleTails(active.preview,old.id).some(t=>effectiveLayerFlags(active.preview,t.id).locked))return fail(problem('bubble/tail-locked','轮廓变化会移动锁定尾巴的底座，请先解锁'));
  const hand=parseHandDrawn(target.handDrawn,'handDrawn'),contour=parseBubbleContour(target.contour,'contour');if(!hand.ok)return hand;if(!contour.ok)return contour;
  const preview={...active.preview,layers:{...active.preview.layers,[target.id]:target}};
  if(target.width!==old.width||target.height!==old.height){
    const sx=target.width/old.width,sy=target.height/old.height;
    let total:number;try{total=perimeter(flattenPath(bubbleBodyPath(target.shape,target.width,target.height,target.style,target))).total;}catch(error){return fail(problem('bubble/size-geometry',(error as Error).message));}
    for(const tail of bubbleTails(preview,target.id)){
      if(effectiveLayerFlags(active.preview,tail.id).locked)return fail(problem('bubble/tail-locked','尺寸变化影响锁定尾巴，请先解锁'));
      if(tail.attachment.mode!=='bubble')return fail(problem('bubble/tail-owner','尾巴归属非法'));
      preview.layers[tail.id]={...tail,tip:{x:tail.tip.x*sx,y:tail.tip.y*sy},attachment:{...tail.attachment,baseWidth:Math.max(4,Math.min(128,total*.2,tail.attachment.baseWidth*Math.min(sx,sy)))},route:tail.route.kind==='polyline'?{kind:'polyline',knots:tail.route.knots.map(p=>({x:p.x*sx,y:p.y*sy}))}:tail.route.kind==='spline'?{kind:'spline',c1:{x:tail.route.c1.x*sx,y:tail.route.c1.y*sy},c2:{x:tail.route.c2.x*sx,y:tail.route.c2.y*sy}}:{kind:'straight'}};
    }
  }
  for(const tail of bubbleTails(preview,target.id))if(tail.legacySplice&&(target.handDrawn||target.contour||['handOval','handPolygon','wave'].includes(target.shape))){if(effectiveLayerFlags(active.preview,tail.id).locked)return fail(problem('bubble/tail-locked','新轮廓需要更新已锁定尾巴的绘制方式，请先解锁'));preview.layers[tail.id]={...tail,legacySplice:false};}
  if(target.shape!==old.shape){
    for(const tail of bubbleTails(preview,target.id)){
      if(buildTailAppearance(preview,tail.id).ok)continue;
      if(effectiveLayerFlags(active.preview,tail.id).locked)return fail(problem('bubble/tail-locked','换形需要调整锁定尾巴底座，请先解锁'));
      if(tail.attachment.mode!=='bubble')return fail(problem('bubble/tail-owner','尾巴归属非法'));
      const originalTail=active.preview.layers[tail.id],oldBase=tailAnchors(originalTail?.type==='bubbleTail'?originalTail:tail,old),anchor=closestTailU(target,tail.tip);if(!anchor.ok)return anchor;
      const adjusted={...tail,legacySplice:false,attachment:{...tail.attachment,attachU:anchor.value.u,baseWidth:Math.max(4,Math.min(tail.attachment.baseWidth,anchor.value.total*.2,128))}},newBase=tailAnchors(adjusted,target);if(!newBase.ok)return newBase;
      if(oldBase.ok){const dx=newBase.value.base.x-oldBase.value.base.x*target.width/old.width,dy=newBase.value.base.y-oldBase.value.base.y*target.height/old.height;
        if(tail.route.kind==='spline')adjusted.route={kind:'spline',c1:{x:tail.route.c1.x+dx*2/3,y:tail.route.c1.y+dy*2/3},c2:{x:tail.route.c2.x+dx/3,y:tail.route.c2.y+dy/3}};
        else if(tail.route.kind==='polyline')adjusted.route={kind:'polyline',knots:tail.route.knots.map((p,i)=>({x:p.x+dx*(1-(i+1)/(tail.route.kind==='polyline'?tail.route.knots.length+1:1)),y:p.y+dy*(1-(i+1)/(tail.route.kind==='polyline'?tail.route.knots.length+1:1))}))};
      }
      preview.layers[tail.id]=adjusted;
    }
  }
  const geometry=composeBubble(preview,target.id,editorGeometryTarget(preview,target.id));if(!geometry.ok)return geometry;
  const text=mainBubbleText(preview,target.id);
  if(text){const beforeFrame=bubbleFrameBounds(active.preview,text.id),frame=bubbleFrameBounds(preview,text.id),beforeGeometry=composeBubble(active.preview,old.id,editorGeometryTarget(active.preview,old.id)),box=text.bubbleFrame?frame?.box??text.box:geometry.value.textBox,changed=text.bubbleFrame?text.bubbleFrame.placement==='center'&&(JSON.stringify(beforeFrame)!==JSON.stringify(frame)||beforeGeometry.ok&&JSON.stringify(beforeGeometry.value.textBox)!==JSON.stringify(geometry.value.textBox)):JSON.stringify(text.box)!==JSON.stringify(box);if(changed&&effectiveLayerFlags(active.preview,text.id).locked)return fail(problem('bubble/text-locked','轮廓变化影响锁定对白的安全区，请先解锁'));preview.layers[text.id]={...text,box:{...box}};}
  return publishMangaPreview(preview);
}
export function updateBubbleContour(nodes:Point[],tension?:number):Result<void>{return updateShape(b=>{b.contour={nodes:structuredClone(nodes),tension:tension??b.contour?.tension??.2};});}
export function updateEditedBubbleStyle(patch:Partial<BubbleStyle>):Result<void>{
 const a=currentMangaEdit(),b=a?.preview.layers[a.id];if(!a||b?.type!=='bubble')return fail(problem('bubble/edit','请先编辑气泡'));
 if(Object.keys(patch).some(k=>!['fill','borderColor','borderWidth','radius','innerStroke','outerStroke'].includes(k)))return fail(problem('bubble/style-field','气泡样式包含未知属性'));
 const style=parseBubbleStyle({...b.style,...patch},'style');if(!style.ok)return style;
 if(JSON.stringify(style.value)!==JSON.stringify(b.style)&&bubbleTails(a.preview,b.id).some(t=>effectiveLayerFlags(a.preview,t.id).locked))return fail(problem('bubble/tail-locked','样式影响锁定尾巴，请先解锁'));
 return updateShape(b=>{b.style=style.value;});
}
export function updateHandDrawn(patch:Partial<HandDrawnStyle>):Result<void>{return updateShape(b=>{if(patch.wobble!==undefined||patch.seed!==undefined){if(!b.contour&&b.handDrawn?.wobble&&(b.edgeStyle?.recipe==='legacy-baked'||!b.edgeStyle?.wobble)){const frozen=generateContour(b);if(!frozen.ok)throw Error(frozen.problems[0].message);b.contour=frozen.value;}b.edgeStyle={recipe:'normal-offset-v1',wobble:patch.wobble??b.edgeStyle?.wobble??0,seed:patch.seed??b.edgeStyle?.seed??b.handDrawn?.seed??42};}b.handDrawn={...(b.handDrawn??{preset:'custom',seed:42,wobble:0,irregularity:0,pressure:0}),...patch,preset:patch.preset??'custom'};});}
export function applyHandDrawnPreset(preset:'soft'|'rough'):Result<void>{return updateShape(b=>{b.handDrawn=handDrawnPreset(preset,b.handDrawn?.seed??42);b.edgeStyle={recipe:'normal-offset-v1',wobble:b.handDrawn.wobble,seed:b.handDrawn.seed};});}
export function regenerateBubbleContour():Result<void>{return updateShape(b=>{b.contour=null;b.handDrawn={...(b.handDrawn??handDrawnPreset('soft')),seed:(b.handDrawn?.seed??42)+1>>>0};if(b.edgeStyle?.recipe==='normal-offset-v1')b.edgeStyle={...b.edgeStyle,seed:b.handDrawn.seed};});}
export function resetBubbleShape():Result<void>{return updateShape(b=>{b.contour=null;b.handDrawn=null;b.edgeStyle={recipe:'normal-offset-v1',wobble:0,seed:b.edgeStyle?.seed??42};if(['handOval','handPolygon','wave'].includes(b.shape))b.shape='roundRect';});}
export function setEditedBubbleShape(shape:BubbleShape):Result<void>{
  if(!['rect','roundRect','circle','cloud','spiky','ellipse','handOval','handPolygon','wave'].includes(shape))return fail(problem('bubble/shape','未知气泡形状'));
  return updateShape(b=>{
    if(shape==='circle'&&b.width!==b.height){const w=Math.max(b.width,b.height),dx=(b.width-w)/2,dy=(b.height-w)/2;b.matrix=[b.matrix[0],b.matrix[1],b.matrix[2],b.matrix[3],b.matrix[4]+b.matrix[0]*dx+b.matrix[2]*dy,b.matrix[5]+b.matrix[1]*dx+b.matrix[3]*dy];b.width=b.height=w;}
    b.shape=shape;b.contour=null;delete b.freehandSource;delete b.penOutline;if(['handOval','handPolygon','wave'].includes(shape)&&!b.handDrawn)b.handDrawn=handDrawnPreset('soft');
  });
}
export function currentBubbleShapeEdit(){const active=currentMangaEdit();return active?.kind==='shape'?active:null;}
