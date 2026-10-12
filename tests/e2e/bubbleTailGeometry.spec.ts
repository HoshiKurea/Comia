import { menuCommand } from './menuHelpers';
import { expect, test, type Page } from '@playwright/test';
import type { Project, Point, Result } from '../../src/domain/types';
import type { DocumentStoreState } from '../../src/state/documentStore';
import type { RuntimeStoreState } from '../../src/state/runtimeStore';
import type { BubbleGeometry } from '../../src/bubbles/geometry';

async function fixture(page: Page, shape: 'rect' | 'roundRect' | 'circle' | 'cloud' | 'spiky') {
  if (page.url() === 'about:blank') await page.goto('/'); await expect(page.locator('.canvas-viewport')).toBeVisible();
  await page.evaluate(async (shape) => {
    const { createProject, createLayer } = await import('/src/' + 'domain/factories.ts'), { replaceDocument } = await import('/src/' + 'history/commandBus.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts'); const { numberFixture } = await import('/tests/helpers/' + 'numberFixture.ts');
    const p = createProject(), id = p.pageOrder[0], group = createLayer('group', id), bubble = createLayer('bubble', id);
    if (group.type !== 'group' || bubble.type !== 'bubble') throw Error('Bad factory'); Object.assign(p.pages[id], { width: 800, height: 600 });
    const theta = 37 * Math.PI / 180; group.matrix = [Math.cos(theta), Math.sin(theta), -Math.sin(theta), Math.cos(theta), 350, 140]; group.children = [bubble.id];
    bubble.parentId = group.id; bubble.matrix = [1, 0, 0, 1, 0, 0]; bubble.shape = shape; bubble.width = shape === 'circle' ? 240 : 300; bubble.height = shape === 'circle' ? 240 : 180; p.schemaVersion=5; bubble.tail = null;
    bubble.style.fill = '#FF000080'; bubble.style.borderColor = '#00000080'; bubble.children = [];
    p.layers[group.id] = group; p.layers[bubble.id] = bubble; p.pages[id].roots = [...p.pages[id].roots.filter((id: string) => p.layers[id]?.type === 'pageBackground'), ...([group.id])];
    const result = replaceDocument(numberFixture(p)); if (!result.ok) throw Error(result.problems[0].message);
    sessionStore.setState({ activePageId: id, selection: [bubble.id], scopeId: group.id, toolMode: 'select', snap16: false, expanded: [group.id], viewportByPage: { [id]: { zoom: 1, pan: { x: 20, y: 20 } } } });
    (window as any).__tailInput = {}; const root = document.querySelector('.canvas-viewport')!;
    for (const phase of ['pointerdown', 'pointermove']) root.addEventListener(phase, (event) => { const e = event as PointerEvent; (window as any).__tailInput[phase] = { x: e.clientX, y: e.clientY, trusted: e.isTrusted }; }, true);
  }, shape);
  await page.getByRole('button', { name: '三角尾', exact: true }).click();
}
async function state(page: Page) {
  return page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const { getDocument } = await import('/src/' + 'state/documentStore.ts'), { runtimeStore } = await import('/src/' + 'state/runtimeStore.ts'), { sessionStore } = await import('/src/' + 'state/sessionStore.ts'), { buildBubble, bubbleBodyPath, flattenPath } = await import('/src/' + 'bubbles/geometry.ts'), { tailBasePoint } = await import('/src/' + 'bubbles/tail.ts');
    const doc = getDocument() as DocumentStoreState, r = runtimeStore.getState() as RuntimeStoreState, p = r.previewProject ?? doc.project, b = Object.values(p.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((layer) => layer.type === 'bubble')!, s = sessionStore.getState(); if (b.type !== 'bubble') throw Error('No bubble');
    const geometry: Result<BubbleGeometry> = buildBubble(b.shape, b.width, b.height, b.style, b.tail), base: Result<Point> = tailBasePoint(b), body: Point[] = flattenPath(bubbleBodyPath(b.shape, b.width, b.height, b.style)), root = document.querySelector('.canvas-viewport')!.getBoundingClientRect();
    return { project: doc.project, history: doc.history, preview: r.previewProject, bubble: b, geometry, base, body, group: p.layers[b.parentId!], vp: s.viewportByPage[s.activePageId], root: { x: root.x, y: root.y }, events: (window as any).__tailInput, stats: r.renderStats, pixels: document.querySelector<HTMLCanvasElement>('.konvajs-content canvas')!.toDataURL() };
  });
}
function screen(s: Awaited<ReturnType<typeof state>>, point: { x: number; y: number }) {
  const m = s.group.matrix; return { x: s.root.x + s.vp.pan.x + (m[0] * point.x + m[2] * point.y + m[4]) * s.vp.zoom, y: s.root.y + s.vp.pan.y + (m[1] * point.x + m[3] * point.y + m[5]) * s.vp.zoom };
}
function local(s: Awaited<ReturnType<typeof state>>, point: { x: number; y: number }) {
  const m = s.group.matrix, x = (point.x - s.root.x - s.vp.pan.x) / s.vp.zoom - m[4], y = (point.y - s.root.y - s.vp.pan.y) / s.vp.zoom - m[5], det = m[0] * m[3] - m[1] * m[2];
  return { x: (m[3] * x - m[2] * y) / det, y: (-m[1] * x + m[0] * y) / det };
}
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + 4, from.y + 4);
  const started = await state(page); expect(started.preview).not.toBeNull();
  await page.evaluate(async () => (await import('/src/' + 'state/runtimeStore.ts')).resetRenderStats());
  await page.mouse.move(to.x, to.y); return state(page);
}
function bodyStable(before: Awaited<ReturnType<typeof state>>, during: Awaited<ReturnType<typeof state>>) {
  const { tail: _, ...initial } = before.bubble, { tail: __, ...next } = during.bubble; expect(next).toEqual(initial); expect(during.project).toEqual(before.project); expect(during.history).toEqual(before.history); expect(during.geometry.ok).toBe(true); expect(during.stats.mainDraws).toBe(0);
}
function distanceToBody(points: { x: number; y: number }[], p: { x: number; y: number }) {
  return Math.min(...points.map((a, i) => { const b = points[(i + 1) % points.length], dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); }));
}
function simpleContour(s: Awaited<ReturnType<typeof state>>) {
  if (!s.geometry.ok) throw Error('Invalid tail'); const points = s.geometry.value.outline.ops.flatMap((op) => op.op === 'M' || op.op === 'L' ? [op.p] : []);
  const cross = (a: {x:number;y:number}, b: {x:number;y:number}, c: {x:number;y:number}) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const on = (a:{x:number;y:number},b:{x:number;y:number},p:{x:number;y:number}) => Math.abs(cross(a,b,p))<1e-8 && p.x>=Math.min(a.x,b.x)-1e-8 && p.x<=Math.max(a.x,b.x)+1e-8 && p.y>=Math.min(a.y,b.y)-1e-8 && p.y<=Math.max(a.y,b.y)+1e-8;
  for (let i = 0; i < points.length; i++) for (let j = i + 2; j < points.length; j++) { if (i === 0 && j === points.length - 1) continue; const a = points[i], b = points[(i + 1) % points.length], c = points[j], d = points[(j + 1) % points.length]; expect(cross(a,b,c)*cross(a,b,d)<-1e-8 && cross(c,d,a)*cross(c,d,b)<-1e-8 || on(a,b,c) || on(a,b,d) || on(c,d,a) || on(c,d,b)).toBe(false); }
}

test('all five tail tips use the independently inverted rotated parent, leave body fixed, stop outside the body and cancel Escape or undo one commit', async ({ page }) => {
  test.setTimeout(60_000);
  for (const shape of ['rect', 'roundRect', 'circle', 'cloud', 'spiky'] as const) {
    await fixture(page, shape); const before = await state(page), tip = before.bubble.tail!.tip;
    const moved = await drag(page, screen(before, tip), screen(before, { x: tip.x + 12, y: tip.y + 20 })); bodyStable(before, moved);
    const actual = local(before, moved.events.pointermove); expect(moved.events.pointermove.trusted).toBe(true); expect(moved.bubble.tail!.tip.x).toBeCloseTo(actual.x, 6); expect(moved.bubble.tail!.tip.y).toBeCloseTo(actual.y, 6);
    await page.mouse.up(); const committed = await state(page); expect(committed.history.past.length).toBe(before.history.past.length + 1); expect(committed.project).toEqual(moved.preview);
    await (await menuCommand(page, '撤销')).click(); const undone = await state(page); expect(undone.project).toEqual(before.project); expect(undone.pixels).toBe(before.pixels);
    const inside = await drag(page, screen(before, tip), screen(before, { x: before.bubble.width / 2, y: before.bubble.height / 2 })); bodyStable(undone, inside);
    expect(distanceToBody(inside.body, inside.bubble.tail!.tip)).toBeGreaterThanOrEqual(4 - 1e-6); expect(inside.bubble.tail!.tip).not.toEqual({ x: before.bubble.width / 2, y: before.bubble.height / 2 }); simpleContour(inside);
    await page.keyboard.press('Escape'); await page.mouse.up(); const cancelled = await state(page); expect(cancelled.project).toEqual(before.project); expect(cancelled.history).toEqual(undone.history); expect(cancelled.preview).toBeNull(); expect(cancelled.pixels).toBe(before.pixels);
  }
});

test('cloud base movement stays on the independently projected body arc without crossing fill and undo restores the entire original tail', async ({ page }) => {
  await fixture(page, 'cloud'); const before = await state(page); if (!before.base.ok) throw Error('Missing base');
  const base = before.base.value, target = { x: base.x + 15, y: base.y + 2 }, moved = await drag(page, screen(before, base), screen(before, target)); bodyStable(before, moved); simpleContour(moved);
  expect(moved.bubble.tail!.tip).toEqual(before.bubble.tail!.tip); expect(moved.bubble.tail!.attachU).not.toBe(before.bubble.tail!.attachU);
  const q = local(before, moved.events.pointermove), points = before.body, lengths = points.map((a,i) => Math.hypot(points[(i+1)%points.length].x-a.x,points[(i+1)%points.length].y-a.y)), total = lengths.reduce((a,b)=>a+b,0);
  let best = Infinity, expected = 0, accumulated = 0;
  for (const [i,a] of points.entries()) { const b=points[(i+1)%points.length], dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((q.x-a.x)*dx+(q.y-a.y)*dy)/(dx*dx+dy*dy))), distance=(q.x-a.x-t*dx)**2+(q.y-a.y-t*dy)**2; if(distance<best-1e-8){ best=distance;expected=((accumulated+t*lengths[i])/total)%1; } accumulated+=lengths[i]; }
  expect(moved.bubble.tail!.attachU).toBeCloseTo(expected,6); await page.mouse.up(); const after = await state(page); expect(after.history.past.length).toBe(before.history.past.length+1);
  await (await menuCommand(page, '撤销')).click(); const undone = await state(page); expect(undone.project).toEqual(before.project); expect(undone.pixels).toBe(before.pixels);
});

test('five translucent triangular joins contain only fill at the removed body border and the old no-tail control retains a visible border', async ({ page }) => {
  test.setTimeout(60_000);
  for (const shape of ['rect','roundRect','circle','cloud','spiky'] as const) {
    await fixture(page,shape); const s = await state(page); if (!s.base.ok) throw Error('No base'); const base=s.base.value;
    const samples=await page.evaluate(async ({ base })=>{
      const { getProject }=await import('/src/'+'state/documentStore.ts'),{ sessionStore }=await import('/src/'+'state/sessionStore.ts'),{ drawPage }=await import('/src/'+'render/drawScene.ts'),{ worldMatrix,apply }=await import('/src/'+'geometry/matrix');
      const p=getProject() as Project,s=sessionStore.getState(),b=Object.values(p.layers).filter((layer) => (layer as { type: string }).type !== 'pageBackground').find((l)=>l.type==='bubble')!;if(b.type!=='bubble')throw Error('No bubble'); const vp=s.viewportByPage[s.activePageId],world=worldMatrix(p,b.id),main=document.querySelector<HTMLCanvasElement>('.konvajs-content canvas')!,ctx=main.getContext('2d')!;
      const pixel=(context:CanvasRenderingContext2D,local:{x:number;y:number})=>{const q=apply(world,local);return [...context.getImageData(Math.floor(vp.pan.x+q.x*vp.zoom),Math.floor(vp.pan.y+q.y*vp.zoom),1,1).data];};
      const reference=document.createElement('canvas');reference.width=main.width;reference.height=main.height;const ref=reference.getContext('2d')!,body=structuredClone(p);(body.layers[b.id] as typeof b).tail=null;ref.translate(vp.pan.x,vp.pan.y);ref.scale(vp.zoom,vp.zoom);drawPage(ref,body,s.activePageId,new Map());
      const result={join:pixel(ctx,base),fill:pixel(ctx,{x:b.width/2,y:b.height/2}),oldBorder:pixel(ref,base)};reference.width=reference.height=0;return result;
    },{base});
    expect(samples.join).toEqual(samples.fill); expect(samples.oldBorder).not.toEqual(samples.fill); expect(samples.fill).toEqual([255,127,127,255]);
  }
});
