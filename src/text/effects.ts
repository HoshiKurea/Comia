import type { Mat, Point, Rect, TextLayer } from '../domain/types';
import type { TextLayout } from './types';
import { apply, multiply, rectCorners, rotationRad, scaling, translation } from '../geometry/matrix';
import { polyBounds } from '../geometry/polygon';
import { unionBounds } from '../geometry/bounds';
import { maxSingularValue } from '../geometry/flattenForBoolean';
import { distanceToSegment } from '../geometry/simplePolygon';
export interface EffectGlyph {startUTF16:number;endUTF16:number;glyph:string;font:string;drawOrigin:Point;alignment:'left-baseline'|'center-middle';localMatrix:Mat;inkBounds:Rect;inkPolygon:Point[];selection:Point[]}
export interface EffectCaret {indexUTF16:number;a:Point;b:Point;runIndex:number}
export interface PreparedEffectText {glyphs:EffectGlyph[];bounds:Rect;caretSegments:EffectCaret[];legacy:boolean}
/** Whole graphemes come from the shared layout, never from splitting UTF16. */
export function compileEffectText(layer:TextLayer,layout:TextLayout,font:string,glyphFonts:ReadonlyMap<string,string>,ctx:CanvasRenderingContext2D):PreparedEffectText{
  const effects=layer.effects!;
  const glyphs:EffectGlyph[]=[],caretSegments:EffectCaret[]=[],vertical=layer.text.direction==='vertical',em=layer.text.font.size;
  const ink=(glyph:string,origin:Point,matrix:Mat,alignment:EffectGlyph['alignment']):{bounds:Rect;polygon:Point[]}=>{
    ctx.textAlign=alignment==='left-baseline'?'left':'center';ctx.textBaseline=alignment==='left-baseline'?'alphabetic':'middle';const metric=ctx.measureText(glyph);
    const left=metric.actualBoundingBoxLeft??0,right=metric.actualBoundingBoxRight??metric.width,ascent=metric.actualBoundingBoxAscent??em,descent=metric.actualBoundingBoxDescent??em*.25;
    const box=polyBounds(rectCorners({x:origin.x-left,y:origin.y-ascent,width:left+right,height:ascent+descent},matrix)),pad=effects.outlineWidth/2*maxSingularValue(matrix);
    const localPad=effects.outlineWidth/2;return{bounds:{x:box.x-pad,y:box.y-pad,width:box.width+2*pad,height:box.height+2*pad},polygon:rectCorners({x:origin.x-left-localPad,y:origin.y-ascent-localPad,width:left+right+2*localPad,height:ascent+descent+2*localPad},matrix)};
  };
  ctx.save();
  try{
    if(effects.recipe==='legacy-sfx-v5'){
      ctx.font=font;return{glyphs:[],caretSegments:layout.caretStops.map(stop=>({indexUTF16:stop.indexUTF16,runIndex:stop.runIndex,a:{x:stop.x,y:stop.y},b:{x:stop.x,y:stop.y+stop.extent}})),bounds:ink(layer.text.content,{x:0,y:em},[1,0,0,1,0,0],'left-baseline').bounds,legacy:true};
    }
    layout.runs.forEach((run,runIndex)=>{
      const first=run.cells[0],last=run.cells.at(-1),start=first?(vertical?first.box.y:first.box.x):0,L=first&&last?(vertical?last.box.y+last.box.height:last.box.x+last.box.width)-start:0;
      const matrices:Mat[]=[];
      for(const cell of run.cells){
        const advance=vertical?cell.box.y+cell.box.height/2:cell.box.x+cell.box.width/2,u=L>0?(advance-start)/L:.5,A=effects.amount*em,origin=vertical?{x:cell.box.x+cell.box.width/2,y:cell.box.y+cell.box.height/2}:{x:cell.box.x,y:run.baseline},anchor=vertical?origin:{x:cell.box.x+cell.box.width/2,y:run.baseline};
        let offset=0,theta=0,sx=1,sy=1;
        if(effects.deformation==='arc'){offset=A*(4*(u-.5)**2-1);theta=Math.atan2(8*A*(u-.5),Math.max(L,1));}
        if(effects.deformation==='wave'){offset=A*Math.sin(2*Math.PI*effects.cycles*u);theta=Math.atan2(2*Math.PI*effects.cycles*A*Math.cos(2*Math.PI*effects.cycles*u),Math.max(L,1));}
        if(effects.deformation==='impact'){sy=1+effects.amount*(2*u-1);sx=1+.5*effects.amount*(2*u-1);}
        if(vertical){[sx,sy]=[sy,sx];theta=-theta;}
        const H:Mat=[1,0,Math.tan(effects.shearDeg*Math.PI/180),1,0,0];
        const matrix=multiply(multiply(multiply(multiply(translation(anchor.x+(vertical?offset:0),anchor.y+(vertical?0:offset)),H),rotationRad(theta+cell.rotation)),scaling(sx,sy)),translation(-anchor.x,-anchor.y));
        matrices.push(matrix);const glyphFont=cell.fontFamily?glyphFonts.get(cell.fontFamily)??font:font;ctx.font=glyphFont;
        const alignment=vertical?'center-middle':'left-baseline',actualInk=ink(cell.glyph,origin,matrix,alignment);glyphs.push({startUTF16:cell.startUTF16,endUTF16:cell.endUTF16,glyph:cell.glyph,font:glyphFont,drawOrigin:origin,alignment,localMatrix:matrix,inkBounds:actualInk.bounds,inkPolygon:actualInk.polygon,selection:rectCorners(cell.box,matrix)});
      }
      for(const stop of layout.caretStops.filter(s=>s.runIndex===runIndex)){
        let index=run.cells.findIndex(c=>c.startUTF16===stop.indexUTF16);if(index<0)index=run.cells.findIndex(c=>c.endUTF16>=stop.indexUTF16);if(index<0)index=run.cells.length-1;
        const matrix=matrices[index]??[1,0,0,1,0,0],a=vertical?{x:stop.x-stop.extent/2,y:stop.y}:{x:stop.x,y:stop.y},b=vertical?{x:stop.x+stop.extent/2,y:stop.y}:{x:stop.x,y:stop.y+stop.extent};
        caretSegments.push({indexUTF16:stop.indexUTF16,runIndex,a:apply(matrix,a),b:apply(matrix,b)});
      }
    });
  }finally{ctx.restore();}
  if(!caretSegments.length)for(const stop of layout.caretStops)caretSegments.push({indexUTF16:stop.indexUTF16,runIndex:stop.runIndex,a:vertical?{x:stop.x-stop.extent/2,y:stop.y}:{x:stop.x,y:stop.y},b:vertical?{x:stop.x+stop.extent/2,y:stop.y}:{x:stop.x,y:stop.y+stop.extent}});
  return{glyphs,caretSegments,bounds:unionBounds(glyphs.map(g=>g.inkBounds))??layer.box,legacy:false};
}
export function effectCaretAt(prepared:PreparedEffectText,index:number):EffectCaret{
  const exact=prepared.caretSegments.filter(c=>c.indexUTF16===index).at(-1);return exact??prepared.caretSegments.reduce((a,b)=>Math.abs(a.indexUTF16-index)<=Math.abs(b.indexUTF16-index)?a:b,{indexUTF16:0,runIndex:0,a:{x:0,y:0},b:{x:0,y:0}});
}
export function hitEffectCaret(prepared:PreparedEffectText,p:Point):number{let distance=Infinity,best=0;for(const caret of prepared.caretSegments){const d=distanceToSegment(p,caret.a,caret.b);if(d<distance){distance=d;best=caret.indexUTF16;}}return best;}
