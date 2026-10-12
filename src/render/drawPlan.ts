import { drawPage, type ImageResources } from './drawScene';
import type { RenderPlan } from './compileScene';

export function drawPlan(ctx: CanvasRenderingContext2D, plan: RenderPlan, images: ImageResources): void {
  drawPage(ctx, plan.project, plan.pageId, images, undefined, true, undefined, undefined, plan.text);
}
