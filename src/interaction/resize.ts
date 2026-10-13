import { validatePanelGeometry, polygonContained } from '../geometry/simplePolygon';
import type { Point, Project, Rect, Result, Id } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { OBJECT_WH } from '../domain/limits';
import { apply, multiply, translation, scaling } from '../geometry/matrix';
import { reflowCrop } from '../images/crop';
import { bubbleBodyPath, buildBubble, flattenPath, perimeter } from '../bubbles/geometry';
import { localLayerBounds } from './layerBounds';
import { bubbleTails, mainBubbleText } from '../bubbles/ownership';
import { composeBubble } from '../bubbles/composeBubble';
import { bubbleFrameBounds } from '../text/bubbleFrameBounds';

export function quantize16(value: number): number { return 16 * Math.max(1, Math.floor(value / 16 + .5)); }
export function rectHandle(box: Rect, index: number): Point {
  const x = [box.x, box.x + box.width / 2, box.x + box.width], y = [box.y, box.y + box.height / 2, box.y + box.height];
  const grid = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]][index];
  return { x: x[grid[0]], y: y[grid[1]] };
}
export function resizedRect(box: Rect, index: number, point: Point, options: { proportional: boolean; snap16: boolean }): Result<Rect> {
  if (!Number.isInteger(index) || index < 0 || index > 7 || !Number.isFinite(point.x) || !Number.isFinite(point.y) || box.width <= 0 || box.height <= 0) return fail(problem('resize/input', '尺寸手柄或坐标无效'));
  const handle = rectHandle(box, index), anchor = rectHandle(box, (index + 4) % 8);
  const xActive = handle.x !== anchor.x, yActive = handle.y !== anchor.y;
  let kx = xActive ? (point.x - anchor.x) / (handle.x - anchor.x) : 1;
  let ky = yActive ? (point.y - anchor.y) / (handle.y - anchor.y) : 1;
  if (kx <= 0 || ky <= 0) return fail(problem('resize/flip', '不能穿过固定点翻转对象'));
  const primaryX = xActive && (!yActive || Math.abs(kx - 1) >= Math.abs(ky - 1));
  if (options.proportional) {
    let ratio = primaryX ? kx : ky;
    ratio = Math.max(ratio, OBJECT_WH.min / box.width, OBJECT_WH.min / box.height);
    if (options.snap16) ratio = primaryX ? quantize16(box.width * ratio) / box.width : quantize16(box.height * ratio) / box.height;
    kx = ky = ratio;
  } else {
    kx = Math.max(kx, OBJECT_WH.min / box.width); ky = Math.max(ky, OBJECT_WH.min / box.height);
    if (options.snap16) { if (xActive) kx = quantize16(box.width * kx) / box.width; if (yActive) ky = quantize16(box.height * ky) / box.height; }
  }
  const width = box.width * kx, height = box.height * ky;
  if (width < OBJECT_WH.min || height < OBJECT_WH.min || width > OBJECT_WH.max || height > OBJECT_WH.max) return fail(problem('resize/range', '局部宽高必须在16～16384像素之间'));
  return ok({ x: anchor.x + (box.x - anchor.x) * kx, y: anchor.y + (box.y - anchor.y) * ky, width, height });
}

/** Returns a pure preview tree. Group/image scales stay in the matrix; panel/image crop changes stay in one subtree. */
export function resizeProject(start: Project, id: Id, next: Rect): Result<Project> {
  const layer = start.layers[id], box = localLayerBounds(start, id);
  if (!layer || !box || box.width <= 0 || box.height <= 0) return fail(problem('resize/empty', '空编组或无尺寸对象不能缩放'));
  if (![next.x, next.y, next.width, next.height].every(Number.isFinite) || next.width < 16 || next.height < 16 || next.width > 16384 || next.height > 16384) return fail(problem('resize/range', '局部宽高必须在16～16384像素之间'));
  if (layer.type === 'pageBackground') return fail(problem('background/transform', '页面背景尺寸跟随纸张'));
  const parent = layer.parentId ? start.layers[layer.parentId] : null;
  if (parent?.type === 'bubble' || (parent?.type === 'panel' && layer.type === 'image' && !!layer.crop)) return fail(problem('resize/owned', '容器控制的内容请使用文字或裁剪模式'));
  const kx = next.width / box.width, ky = next.height / box.height;
  const affine = multiply(multiply(translation(next.x, next.y), scaling(kx, ky)), translation(-box.x, -box.y));
  const project = { ...start, layers: { ...start.layers } }, target = structuredClone(layer); project.layers[id] = target;
  if (target.type === 'group' || target.type === 'image' || target.type === 'bubbleTail' || target.type==='decoration'&&target.spec.kind==='shape') target.matrix = multiply(layer.matrix, affine);
  else if (target.type === 'panel') {
    const visit = (panelId: Id) => {
      const original = start.layers[panelId]; if (original.type !== 'panel') return;
      const panel = structuredClone(original); project.layers[panelId] = panel;
      panel.geometry = original.geometry.map((point) => apply(affine, point));
      const valid = validatePanelGeometry(panel); if (!valid.ok) throw new Error(valid.problems[0].message);
      for (const childId of original.children) {
        const child = start.layers[childId];
        if (child.type === 'panel') visit(childId);
        else if (child.type === 'image' && child.crop) project.layers[childId] = { ...child, crop: reflowCrop(panel.geometry, { x: child.width, y: child.height }, child.crop) };
      }
    };
    try { visit(id); } catch (error) { return fail(problem('resize/polygon', (error as Error).message)); }
    const resized = project.layers[id];
    if (parent?.type === 'panel' && resized.type === 'panel' && !polygonContained(parent.geometry, resized.geometry)) return fail(problem('resize/parent', '子分镜必须保持在父分镜轮廓内'));
  } else if (target.type === 'bubble') {
    // Freehand bounds may include an off-origin contour or detail ink. Scale
    // the author basis, not the visual bounding-box dimensions themselves.
    target.matrix = multiply(layer.matrix, translation(next.x - box.x * kx, next.y - box.y * ky)); target.width = target.width * kx; target.height = target.height * ky;
    if (target.width < 16 || target.height < 16 || target.width > 16384 || target.height > 16384) return fail(problem('resize/range', '气泡宽高必须在16～16384像素之间'));
    if (layer.type === 'bubble' && layer.tail) {
      let total: number;
      try { total = perimeter(flattenPath(bubbleBodyPath(target.shape, target.width, target.height, target.style, target))).total; }
      catch { return fail(problem('resize/bubble-budget', '气泡轮廓超出几何预算，尺寸未修改')); }
      target.tail = { ...layer.tail, tip: { x: layer.tail.tip.x * kx, y: layer.tail.tip.y * ky }, baseWidth: Math.max(4, Math.min(128, total * .2, layer.tail.baseWidth * Math.min(kx, ky))) };
    }
    if(start.schemaVersion>=6){
      let total:number;try{total=perimeter(flattenPath(bubbleBodyPath(target.shape,target.width,target.height,target.style,target))).total;}catch(error){return fail(problem('resize/bubble-body',(error as Error).message));}
      for(const tail of bubbleTails(start,id)){
        if(tail.attachment.mode!=='bubble')return fail(problem('resize/tail-owner','气泡包含非绑定尾巴'));
        const nextTail=structuredClone(tail);nextTail.tip={x:tail.tip.x*kx,y:tail.tip.y*ky};nextTail.attachment={...tail.attachment,baseWidth:Math.max(4,Math.min(128,.2*total,tail.attachment.baseWidth*Math.min(kx,ky)))};
        if(tail.route.kind==='polyline')nextTail.route={kind:'polyline',knots:tail.route.knots.map(p=>({x:p.x*kx,y:p.y*ky}))};
        else if(tail.route.kind==='spline')nextTail.route={kind:'spline',c1:{x:tail.route.c1.x*kx,y:tail.route.c1.y*ky},c2:{x:tail.route.c2.x*kx,y:tail.route.c2.y*ky}};
        project.layers[tail.id]=nextTail;
      }
    }
    const geometry = start.schemaVersion>=6?composeBubble(project,id):buildBubble(target.shape, target.width, target.height, target.style, target.tail); if (!geometry.ok) return geometry;
    const child = mainBubbleText(start,id);
    if (child?.type === 'text') project.layers[child.id] = { ...child, box: child.bubbleFrame?bubbleFrameBounds(project,child.id)?.box??child.box:geometry.value.textBox };
  } else if (target.type === 'text') target.box = next;
  else if (target.type === 'decoration') { target.matrix = multiply(layer.matrix, translation(next.x, next.y)); target.spec.width = next.width; target.spec.height = next.height; }
  else return fail(problem('background/transform', '页面背景尺寸跟随纸张，请使用页面设置'));
  return ok(project);
}
