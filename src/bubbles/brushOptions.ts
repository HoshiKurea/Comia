import {fail,ok,problem,type BubbleBrushOptions,type Result} from '../domain/types';
import {parseHandDrawn,parseBubbleStyle} from '../domain/mangaValidation';
export const DEFAULT_BUBBLE_BRUSH:BubbleBrushOptions={borderWidth:3,borderColor:'#000000FF',fill:'#FFFFFFFF',smoothing:.2,simplifyScreenPx:1,closeScreenPx:12,handDrawn:null,innerStroke:{enabled:false,width:0,color:'#000000FF'},outerStroke:{enabled:false,width:0,color:'#000000FF'}};
export function parseBubbleBrushOptions(input:unknown):Result<BubbleBrushOptions>{
 if(!input||typeof input!=='object'||Array.isArray(input))return fail(problem('bubble-brush/options','气泡笔刷参数无效'));
 const o=input as BubbleBrushOptions,style=parseBubbleStyle({...o,radius:0},'brush.style'),hand=parseHandDrawn(o.handDrawn,'brush.handDrawn');if(!style.ok)return style;if(!hand.ok)return hand;
 if(!o.innerStroke||!o.outerStroke||!Number.isFinite(o.smoothing)||o.smoothing<0||o.smoothing>.5||!Number.isFinite(o.simplifyScreenPx)||o.simplifyScreenPx<.25||o.simplifyScreenPx>4||!Number.isFinite(o.closeScreenPx)||o.closeScreenPx<2||o.closeScreenPx>24)return fail(problem('bubble-brush/options','平滑0～0.5、拟合容差0.25～4屏幕px、闭合距离2～24屏幕px'));
 return ok({borderWidth:style.value.borderWidth,borderColor:style.value.borderColor,fill:style.value.fill,smoothing:o.smoothing,simplifyScreenPx:o.simplifyScreenPx,closeScreenPx:o.closeScreenPx,handDrawn:hand.value,innerStroke:style.value.innerStroke!,outerStroke:style.value.outerStroke!});
}
