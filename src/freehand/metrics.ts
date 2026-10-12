/** Optional diagnostics, independent of document/session history and disabled by default. */
export const drawingMetrics={enabled:false,inputs:[] as number[],frames:[] as number[],commits:[] as number[]};
export function resetDrawingMetrics(enabled=true):void{drawingMetrics.enabled=enabled;drawingMetrics.inputs=[];drawingMetrics.frames=[];drawingMetrics.commits=[];}
export function recordDrawingInput(start:number):void{if(drawingMetrics.enabled&&drawingMetrics.inputs.length<512)drawingMetrics.inputs.push(performance.now()-start);}
export function recordDrawingFrame(start:number):void{if(drawingMetrics.enabled&&drawingMetrics.frames.length<512)drawingMetrics.frames.push(performance.now()-start);}
export function recordDrawingCommit(start:number):void{if(drawingMetrics.enabled&&drawingMetrics.commits.length<512)drawingMetrics.commits.push(performance.now()-start);}
