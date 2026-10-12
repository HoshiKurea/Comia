import type { FreehandBubbleSource, FreehandMaterialSource, InkStroke, Point, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { isUuid } from '../domain/id';

export const DRAWING_LIMITS = { objects: 16, strokePoints: 8192, points: 65536, operations: 256, axis: 4096, bytes: 256 * 1024 * 1024 } as const;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const range = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const point = (v: unknown): v is Point => record(v) && range(v.x, -8192, 8192) && range(v.y, -8192, 8192);
const bad = (message: string) => fail(problem('drawing/source', message));
export function parseInkStroke(v: unknown): Result<InkStroke> {
  if (!record(v) || !isUuid(v.id) || !['pen', 'eraser'].includes(String(v.tool)) || !['fixed', 'pen'].includes(String(v.pressureMode)) || !range(v.width, 1, 512) || !range(v.opacity, 0, 1) || typeof v.color !== 'string' || !/^#[0-9a-f]{8}$/i.test(v.color) || !Array.isArray(v.points) || !v.points.length || v.points.length > DRAWING_LIMITS.strokePoints) return bad('笔迹工具、颜色、宽度、透明度或点数非法');
  if (!v.points.every(p => point(p) && record(p) && range(p.pressure, 0, 1) && range(p.dt, 0, Number.MAX_SAFE_INTEGER))) return bad('笔迹坐标、压力或时间非法');
  return ok({ id: v.id, tool: v.tool as InkStroke['tool'], pressureMode: v.pressureMode as InkStroke['pressureMode'], width: v.width, opacity: v.opacity, color: v.color.toUpperCase(), points: v.points.map(p => ({ x: p.x, y: p.y, pressure: p.pressure, dt: p.dt })) });
}
export function parseDrawingSource(v: unknown, kind: 'bubble'): Result<FreehandBubbleSource>;
export function parseDrawingSource(v: unknown, kind: 'material'): Result<FreehandMaterialSource>;
export function parseDrawingSource(v: unknown, kind: 'bubble' | 'material'): Result<FreehandBubbleSource | FreehandMaterialSource> {
  if (!record(v) || v.version !== 1 || !range(v.width, 16, DRAWING_LIMITS.axis) || !range(v.height, 16, DRAWING_LIMITS.axis)) return bad('绘画源版本或尺寸非法（16～4096）');
  const source: FreehandBubbleSource | FreehandMaterialSource = kind === 'bubble' ? { version: 1, width: v.width, height: v.height, baseRing: [], edits: [] } : { version: 1, width: v.width, height: v.height, strokes: [] };
  let total = 0;
  if ('baseRing' in source) {
    if (!Array.isArray(v.baseRing) || v.baseRing.length < 3 || v.baseRing.length > DRAWING_LIMITS.strokePoints || !v.baseRing.every(point) || !Array.isArray(v.edits) || v.edits.length > DRAWING_LIMITS.operations) return bad('气泡需要有效轮廓和修形笔迹');
    source.baseRing = v.baseRing.map(p => ({ x: p.x, y: p.y })); total = source.baseRing.length;
    for (const edit of v.edits) {
      if (!record(edit) || !isUuid(edit.id) || !['add', 'subtract'].includes(String(edit.mode))) return bad('气泡修形记录非法');
      const stroke = parseInkStroke(edit.stroke); if (!stroke.ok) return stroke;
      source.edits.push({ id: edit.id, mode: edit.mode as 'add' | 'subtract', stroke: stroke.value }); total += stroke.value.points.length;
    }
    if (new Set(source.edits.map(e => e.id)).size !== source.edits.length) return bad('修形记录编号重复');
  } else {
    if (!Number.isInteger(v.width) || !Number.isInteger(v.height) || !Array.isArray(v.strokes) || !v.strokes.length || v.strokes.length > DRAWING_LIMITS.operations) return bad('素材需要整数画板尺寸和1～256笔');
    for (const raw of v.strokes) {
      const stroke = parseInkStroke(raw); if (!stroke.ok) return stroke;
      if (stroke.value.points.some(p => p.x < 0 || p.y < 0 || p.x > source.width || p.y > source.height)) return bad('素材笔迹超出画板');
      source.strokes.push(stroke.value); total += stroke.value.points.length;
    }
  }
  const strokes = 'strokes' in source ? source.strokes : source.edits.map(e => e.stroke);
  if (total > DRAWING_LIMITS.points || new Set(strokes.map(s => s.id)).size !== strokes.length) return bad('绘画源点数超限或笔迹编号重复');
  return ok(source);
}
/** IDs and event timings do not affect authored pixels; order, pressure and coordinates do. */
export function canonicalDrawingSource(source: FreehandMaterialSource): string {
  return JSON.stringify({ version: source.version, width: source.width, height: source.height, strokes: source.strokes.map(s => ({ tool: s.tool, points: s.points.map(p => [p.x || 0, p.y || 0, p.pressure]), color: s.color.toUpperCase(), width: s.width, opacity: s.opacity, pressureMode: s.pressureMode })) });
}
export async function drawingSourceHash(source: FreehandMaterialSource): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalDrawingSource(source)));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
export async function verifyDrawingSources(project: Project): Promise<Result<void>> {
  for(const asset of Object.values(project.assets))if(asset.drawingSource && await drawingSourceHash(asset.drawingSource)!==asset.drawingSourceHash)return fail(problem('drawing/hash',`手绘素材“${asset.name}”的笔迹摘要不符，未载入或保存`));
  return ok(undefined);
}
