import { fail, ok, problem, type Id, type Point, type Project, type Rect, type Result, type TextContent } from '../domain/types';
import { composeBubble } from '../bubbles/composeBubble';
import { mainBubbleText } from '../bubbles/ownership';
import { graphemes, layoutHorizontal, layoutVertical, layoutText, type Measurer } from './layout';
import type { TextLayout } from './types';
import { fontStyle } from './fontStyle';
import { unionBounds } from '../geometry/bounds';
import { resolveVerticalGlyph } from './verticalGlyphs';

export interface ResolvedBubbleTextFrame { box: Rect; safeBox: Rect; layout: TextLayout; inkBounds: Rect; overflow: boolean }
type FrameMeasurer = Measurer & { font?: string; textAlign?: CanvasTextAlign; textBaseline?: CanvasTextBaseline };
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
function advance(text: TextContent, value: string, m: Measurer): number {
  const glyphs = graphemes(value); if (!glyphs.length) return 0;
  return text.letterSpacing === 0 ? m.measureText(value).width : glyphs.reduce((n,g)=>n+m.measureText(g.glyph).width,0)+(glyphs.length-1)*text.letterSpacing;
}
function inkBox(m: FrameMeasurer, value: string, origin: Point, rotation = 0, fallback?: Rect): Rect | null {
  if (!value || !value.trim()) return null;
  const t = m.measureText(value);
  if (![t.actualBoundingBoxAscent,t.actualBoundingBoxDescent,t.actualBoundingBoxLeft,t.actualBoundingBoxRight].every(finite)) return fallback ?? { x: origin.x, y: origin.y - (t.actualBoundingBoxAscent || 0), width: t.width, height: 0 };
  const left=-t.actualBoundingBoxLeft,right=t.actualBoundingBoxRight,top=-t.actualBoundingBoxAscent,bottom=t.actualBoundingBoxDescent;
  if(right<=left||bottom<=top)return null;
  const a=rotation*Math.PI/180,points=[{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}].map(p=>({x:origin.x+Math.cos(a)*p.x-Math.sin(a)*p.y,y:origin.y+Math.sin(a)*p.x+Math.cos(a)*p.y}));
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);return{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
}
/** Measure visible glyphs and all interaction coordinates through one frame resolver. */
export function resolveBubbleTextFrame(project: Project, textId: Id, measurer: Measurer, resolvedFont: string): Result<ResolvedBubbleTextFrame> {
  const layer=project.layers[textId],parent=layer?.parentId?project.layers[layer.parentId]:null;
  if(layer?.type!=='text'||parent?.type!=='bubble'||mainBubbleText(project,parent.id)?.id!==textId)return fail(problem('text/bubble-frame-target','此文字不是气泡主对白'));
  const geometry=composeBubble(project,parent.id);if(!geometry.ok)return geometry;
  const safeBox=geometry.value.textBox,frame=layer.bubbleFrame;
  if(!frame||frame.placement==='legacy'){const layout=layoutText(layer.text,layer.box,measurer);return ok({box:layer.box,safeBox,layout,inkBounds:layout.usedBounds,overflow:layout.overflow});}
  const text={...layer.text,align:'center' as const},m=measurer as FrameMeasurer;
  const old={font:m.font,align:m.textAlign,baseline:m.textBaseline};
  try {
    if(typeof m.font==='string')m.font=fontStyle(resolvedFont,text.font.size,text.font.bold,text.font.italic);
    if(typeof m.textAlign==='string')m.textAlign=text.direction==='horizontal'?'left':'center';
    if(typeof m.textBaseline==='string')m.textBaseline=text.direction==='horizontal'?'alphabetic':'middle';
    const paragraphs=text.content.replace(/\r\n?/g,'\n').split('\n'),vertical=text.direction==='vertical',em=text.font.size;
    const naturalWidth=vertical?Math.max(1,paragraphs.length)*em*text.lineHeight:Math.max(em,...paragraphs.map(p=>advance(text,p,m)));
    const naturalHeight=vertical?Math.max(1,...paragraphs.map(p=>graphemes(p).length))*em:Math.max(1,paragraphs.length)*em*text.lineHeight;
    const w=frame.mode==='manual'?frame.manualSize!.width:naturalWidth,h=frame.mode==='manual'?frame.manualSize!.height:naturalHeight;
    const rawBox={x:0,y:0,width:w,height:h};
    const raw=vertical?layoutVertical(text,rawBox,glyph=>resolveVerticalGlyph(glyph,resolvedFont)):layoutHorizontal(text,rawBox,m,{wordWrap:frame.mode==='manual',noWrap:frame.mode==='auto'}),ink:Rect[]=[];
    for(const run of raw.runs){
      if(!vertical&&text.letterSpacing===0){const b=inkBox(m,run.paintText??run.text,{x:run.origin.x,y:run.baseline},0,{x:run.origin.x,y:run.origin.y,width:advance(text,run.paintText??run.text,m),height:em*text.lineHeight});if(b)ink.push(b);}
      else for(const cell of run.cells){
        if(typeof m.font==='string')m.font=fontStyle(cell.fontFamily??resolvedFont,em,text.font.bold,text.font.italic);
        const origin=vertical?{x:cell.box.x+cell.box.width/2,y:cell.box.y+cell.box.height/2}:{x:cell.box.x,y:run.baseline};
        const b=inkBox(m,cell.glyph,origin,cell.rotation,cell.box);if(b)ink.push(b);
      }
    }
    const content=unionBounds(ink)??(text.content?raw.usedBounds:null)??{x:0,y:0,width:w,height:h};
    const center={x:safeBox.x+safeBox.width/2,y:safeBox.y+safeBox.height/2},dx=center.x-content.x-content.width/2,dy=center.y-content.y-content.height/2;
    const move=(r:Rect):Rect=>({...r,x:r.x+dx,y:r.y+dy});
    const layout:TextLayout={...raw,runs:raw.runs.map(r=>({...r,origin:{x:r.origin.x+dx,y:r.origin.y+dy},baseline:r.baseline+dy,cells:r.cells.map(c=>({startUTF16:c.startUTF16,endUTF16:c.endUTF16,glyph:c.glyph,rotation:c.rotation,...(c.fontFamily?{fontFamily:c.fontFamily}:{}),get box(){return move(c.box);}}))})),caretStops:raw.caretStops.map(c=>({indexUTF16:c.indexUTF16,runIndex:c.runIndex,extent:c.extent,get x(){return c.x+dx;},y:c.y+dy})),usedBounds:move(content)};
    let width=w,height=h;
    if(frame.mode==='auto')for(const r of [move(content),...(vertical||text.letterSpacing!==0?layout.runs.flatMap(r=>r.cells.map(c=>c.box)):[move(raw.usedBounds)])]){width=Math.max(width,2*Math.max(Math.abs(r.x-center.x),Math.abs(r.x+r.width-center.x)));height=Math.max(height,2*Math.max(Math.abs(r.y-center.y),Math.abs(r.y+r.height-center.y)));}
    const box={x:center.x-width/2,y:center.y-height/2,width,height},inkBounds=move(content);
    const overflow=raw.overflow||safeBox.width<=0||safeBox.height<=0||box.x<safeBox.x-1e-6||box.y<safeBox.y-1e-6||box.x+box.width>safeBox.x+safeBox.width+1e-6||box.y+box.height>safeBox.y+safeBox.height+1e-6;
    layout.overflow=overflow;layout.frameBox=box;layout.safeClipBox=safeBox;return ok({box,safeBox,layout,inkBounds,overflow});
  } finally {if(old.font!==undefined)m.font=old.font;if(old.align!==undefined)m.textAlign=old.align;if(old.baseline!==undefined)m.textBaseline=old.baseline;}
}
