import type { FreehandBubbleSourceV2, Mat, Point, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { apply, inverse } from '../geometry/matrix';
import { polyBounds } from '../geometry/polygon';
import { captureBubbleRing } from '../freehand/geometry';
export interface ClosedBubbleCapture { origin: Point; width: number; height: number; source: FreehandBubbleSourceV2; gapScreenPx: number }
/** The closing edge is part of ring validation; open ends never require manual confirmation. */
export function captureAutoClosedBubble(raw: readonly Point[], localToScreen: Mat): Result<ClosedBubbleCapture> {
  if (localToScreen.length !== 6 || localToScreen.some(n => !Number.isFinite(n)) || !inverse(localToScreen).ok) return fail(problem('bubble-brush/matrix', '绘画坐标系必须有效且可逆'));
  const ring = captureBubbleRing(raw); if (!ring.ok) return ring;
  const b = polyBounds(ring.value);
  if (b.width < 16 || b.height < 16 || b.width > 16384 || b.height > 16384) return fail(problem('bubble-brush/size', '气泡宽高需为16～16384像素；请画出有面积的轮廓'));
  const width = Math.min(4096, b.width), height = Math.min(4096, b.height), first = raw[0], last = raw.at(-1)!;
  const gap = apply(localToScreen, { x: last.x - first.x, y: last.y - first.y }), origin = apply(localToScreen, { x: 0, y: 0 });
  return ok({ origin: { x: b.x, y: b.y }, width: b.width, height: b.height, gapScreenPx: Math.hypot(gap.x - origin.x, gap.y - origin.y),
    source: { version: 2, width, height, baseRing: ring.value.map(p => ({ x: (p.x - b.x) * width / b.width, y: (p.y - b.y) * height / b.height })), edits: [], ink: [] } });
}
