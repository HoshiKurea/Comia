import { beforeEach, expect, it } from 'vitest';
import type { DecorationLayer, PanelLayer, Point, SpeedBrushSpec } from '../../src/domain/types';
import { createLayer, createProject } from '../../src/domain/factories';
import { validateProject } from '../../src/domain/validate';
import { migrateProject } from '../../src/storage/migrateProject';
import { encodeProject, decodeProject } from '../../src/storage/codec';
import { getDocument, getProject } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';
import { execute, redo, replaceDocument, undo } from '../../src/history/commandBus';
import { buildSpeedBrush, DEFAULT_SPEED_BRUSH, speedBrushContains } from '../../src/library/speedBrushGeometry';
import { activateSpeedBrush, appendSpeedSamples, beginSpeedStroke, cancelSpeedStroke, commitSpeedStroke, currentSpeedStroke, previewSpeedStroke, setSpeedBrushOptions } from '../../src/library/speedBrushController';
import { buildDecoration } from '../../src/library/decorations';
import { componentCategories } from '../../src/library/componentCatalog';
import { sortPanelReadingOrder } from '../../src/panels/readingOrder';
import { addObject, deleteSelected } from '../../src/app/actions';
import { copyToClipboard, pasteFromClipboard } from '../../src/layers/clipboard';
import { apply, worldMatrix } from '../../src/geometry/matrix';
import { applyIndependentLayout } from '../../src/panels/independentLayout';
import { makeGrid } from '../../src/panels/presets';
import { generateRandomLayout } from '../../src/panels/randomLayout';
import { commitCut } from '../../src/panels/cutPanel';
import { beginDrawing, finishDrawing, setRawDrawing } from '../../src/panels/drawingController';

const options = { ...DEFAULT_SPEED_BRUSH }, rect = { x: 40, y: 80, width: 1000, height: 800 }, viewport = { zoom: 2, pan: { x: 10, y: 20 } };
const client = (p: Point) => ({ x: rect.x + viewport.pan.x + p.x * viewport.zoom, y: rect.y + viewport.pan.y + p.y * viewport.zoom });
function built(points: Point[] = [{ x: 100, y: 100 }, { x: 400, y: 100 }], seed = 31) { const r = buildSpeedBrush(points, options, seed, .375); if (!r.ok) throw Error(JSON.stringify(r)); return r.value; }
function start() { expect(activateSpeedBrush().ok).toBe(true); expect(beginSpeedStroke(client({ x: 100, y: 100 }), 1, rect, viewport).ok).toBe(true); }
function draw() { start(); expect(appendSpeedSamples([client({ x: 300, y: 130 })]).ok).toBe(true); const r = commitSpeedStroke(); if (!r.ok || !r.value) throw Error(JSON.stringify(r)); return r.value; }
beforeEach(() => { cancelSpeedStroke(); expect(replaceDocument(createProject()).ok).toBe(true); expect(setSpeedBrushOptions(options).ok).toBe(true); });
it('builds deterministic irregular ribbons, changes with seed, and reconstructs normalized fill paths', () => {
  const a = built(), b = built(); expect(a).toEqual(b); expect(built(undefined, 32)).not.toEqual(a);
  expect(a.spec.ribbons.length).toBeGreaterThan(options.density); const paths = buildDecoration(a.spec); expect(paths).toHaveLength(a.spec.ribbons.length);
  expect(paths.every(p => p.ops.at(-1)?.op === 'Z')).toBe(true);
  for (const ring of a.spec.ribbons) for (const p of ring) expect(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1).toBe(true);
  const first = a.spec.centerline[0]; expect(a.bounds.x + first.x * a.spec.width).toBeCloseTo(100); expect(a.bounds.y + first.y * a.spec.height).toBeCloseTo(100);
});
it('turns curved, sharp, vertical and reverse pointer trajectories into parallel straight ink axes', () => {
  for (const points of [Array.from({ length: 40 }, (_, i) => ({ x: 150 + i * 5, y: 200 - 70 * Math.sin(i / 20) })), [{ x: 200, y: 200 }, { x: 400, y: 200 }, { x: 150, y: 210 }], [{ x: 200, y: 200 }, { x: 300, y: 300 }, { x: 200, y: 450 }]]) {
    const r = built(points); expect(r.spec.ribbons.flat().every(p => Number.isFinite(p.x + p.y))).toBe(true);
    expect(r.bounds.width).toBeLessThan(450); expect(r.bounds.height).toBeLessThan(300);
    expect(r.spec.centerline).toHaveLength(2);
    r.spec.centerline.forEach((p, i) => {
      const expected = i ? points.at(-1)! : points[0];
      expect(r.bounds.x + p.x * r.spec.width).toBeCloseTo(expected.x);
      expect(r.bounds.y + p.y * r.spec.height).toBeCloseTo(expected.y);
    });
    const end = points.at(-1)!, dx = end.x - points[0].x, dy = end.y - points[0].y, length = Math.hypot(dx, dy);
    for (const ring of r.spec.ribbons) {
      const centers = ring.slice(0, ring.length / 2).map((p, i) => {
        const opposite = ring[ring.length - 1 - i];
        return { x: (p.x + opposite.x) * r.spec.width / 2, y: (p.y + opposite.y) * r.spec.height / 2 };
      });
      for (const p of centers) expect(Math.abs((dx * (p.y - centers[0].y) - dy * (p.x - centers[0].x)) / length)).toBeLessThan(1e-8);
    }
  }
});
it('varies spacing between straight tracks without displacing an individual ink axis', () => {
  const r = built(), offsets = [...new Set(r.spec.ribbons.map(ring => Number(((ring[0].y + ring.at(-1)!.y) * r.spec.height / 2).toFixed(8))))].sort((a,b) => a-b);
  expect(offsets).toHaveLength(options.density);
  const gaps = offsets.slice(1).map((y,i) => y-offsets[i]);
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(.1);
  expect(gaps.every(gap => gap > 0)).toBe(true);
});
it('rejects a closed or almost closed drag instead of turning it into a curved stroke', () => {
  for (const end of [{x:100,y:100},{x:102,y:101}]) {
    const r = buildSpeedBrush([{x:100,y:100},{x:400,y:300},end], options,31,.375);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.problems[0].code).toBe('brush/short');
  }
});
it('uses evenly spaced unbroken tracks when irregularity is zero', () => {
  const r = buildSpeedBrush([{ x: 0, y: 100 }, { x: 300, y: 100 }], { ...options, irregularity: 0 }, 55, .5); if (!r.ok) throw Error('build');
  expect(r.value.spec.ribbons).toHaveLength(options.density); const centers = r.value.spec.ribbons.map(ring => (ring[0].y + ring.at(-1)!.y) / 2);
  for (let i = 2; i < centers.length; i++) expect(centers[i] - centers[i - 1]).toBeCloseTo(centers[1] - centers[0]);
});
it('rejects nonfinite inputs, invalid options, long and oversized sample arrays without truncating', () => {
  expect(buildSpeedBrush([{ x: NaN, y: 0 }, { x: 100, y: 0 }], options, 1, 1).ok).toBe(false);
  expect(buildSpeedBrush([{ x: 0, y: 0 }, { x: 4000, y: 0 }], options, 1, .5).ok).toBe(false);
  expect(buildSpeedBrush(Array.from({ length: 4097 }, (_, i) => ({ x: i, y: 0 })), options, 1, .5).ok).toBe(false);
  expect(setSpeedBrushOptions({ ...options, density: 2.5 }).ok).toBe(false); expect(setSpeedBrushOptions({ ...options, radius: Infinity }).ok).toBe(false);
});
it('hits actual ink while leaving gaps and the surrounding selection rectangle empty', () => {
  const { spec } = built(); const ring = spec.ribbons[0], middle = ring[Math.floor(ring.length / 4)], opposite = ring[ring.length - 1 - Math.floor(ring.length / 4)];
  expect(speedBrushContains(spec, { x: (middle.x + opposite.x) * spec.width / 2, y: (middle.y + opposite.y) * spec.height / 2 })).toBe(true);
  expect(speedBrushContains(spec, { x: 0, y: 0 })).toBe(false);
});
it('keeps preview out of history and commits a whole stroke once with matching undo/redo and selection', () => {
  const before = structuredClone(getProject()); start();
  expect(appendSpeedSamples([client({ x: 180, y: 100 }), client({ x: 260, y: 125 })]).ok).toBe(true); expect(previewSpeedStroke().ok).toBe(true);
  expect(getProject()).toEqual(before); expect(getDocument().history.past).toHaveLength(0);
  const preview = structuredClone(currentSpeedStroke()!.layer), r = commitSpeedStroke(); expect(r.ok).toBe(true); if (!r.ok || !r.value) throw Error('commit');
  expect(getProject().layers[r.value]).toEqual(preview); expect(getDocument().history.past).toHaveLength(1); expect(sessionStore.getState().selection).toEqual([r.value]);
  const after = structuredClone(getProject()); expect(undo().ok).toBe(true); expect(getProject()).toEqual(before); expect(redo().ok).toBe(true); expect(getProject()).toEqual(after);
});
it('freezes options per stroke, cancels on competing transaction, page, tool, scope, pan and document replacement', () => {
  start(); expect(setSpeedBrushOptions({ ...options, color: '#CC0000FF', density: 12 }).ok).toBe(true); expect(currentSpeedStroke()!.options).toEqual(options); cancelSpeedStroke();
  for (const action of [() => execute({ label: '竞争修改', context: { pageId: getProject().pageOrder[0], selection: [] }, mutate(d) { d.name += 'x'; } }),
    () => sessionStore.setState({ toolMode: 'select' }), () => sessionStore.setState({ scopeId: 'new' }), () => sessionStore.setState({ spacePan: true }), () => replaceDocument(createProject())]) {
    expect(replaceDocument(createProject()).ok).toBe(true); sessionStore.setState({ scopeId: null, spacePan: false }); start(); action(); expect(currentSpeedStroke()).toBeNull();
  }
});
it('does not commit clicks, sub-four-CSS-pixel strokes or an overflowed sampling stream', () => {
  start(); expect(commitSpeedStroke()).toEqual({ ok: true, value: null }); expect(getDocument().history.past).toHaveLength(0);
  start(); appendSpeedSamples([client({ x: 101, y: 100 })]); expect(commitSpeedStroke()).toEqual({ ok: true, value: null });
  start(); expect(appendSpeedSamples(Array.from({ length: 4097 }, (_, i) => client({ x: 101 + i / 100, y: 100 + i % 2 }))).ok).toBe(false);
  expect(commitSpeedStroke().ok).toBe(false); expect(getDocument().history.past).toHaveLength(0); expect(currentSpeedStroke()).toBeNull();
});
it('preserves page-space brush size inside rotated and scaled ordinary groups', () => {
  const group = createLayer('group', getProject().pageOrder[0]); if (group.type !== 'group') throw Error('group'); group.matrix = [1.2, .4, -.2, .8, 30, 50];
  expect(execute({ label: '组', context: { pageId: group.pageId, selection: [] }, mutate(d) { d.layers[group.id] = group; d.pages[group.pageId].roots.push(group.id); } }).ok).toBe(true);
  sessionStore.setState({ scopeId: group.id }); const id = draw(), layer = getProject().layers[id] as DecorationLayer;
  expect(layer.parentId).toBe(group.id); const spec = layer.spec as SpeedBrushSpec, q = spec.centerline[0], p = apply(worldMatrix(getProject(), id), { x: q.x * spec.width, y: q.y * spec.height });
  expect(p.x).toBeCloseTo(100); expect(p.y).toBeCloseTo(100);
});
it('rejects locked ordinary groups and preserves the document on invalid starting coordinates', () => {
  const group = createLayer('group', getProject().pageOrder[0]); group.locked = true; expect(execute({ label: '组', context: { pageId: group.pageId, selection: [] }, mutate(d) { d.layers[group.id] = group; d.pages[group.pageId].roots.push(group.id); } }).ok).toBe(true);
  sessionStore.setState({ scopeId: group.id }); activateSpeedBrush(); expect(beginSpeedStroke(client({ x: 100, y: 100 }), 1, rect, viewport).ok).toBe(false);
  sessionStore.setState({ scopeId: null }); expect(beginSpeedStroke(client({ x: -1, y: 0 }), 1, rect, viewport).ok).toBe(false); expect(currentSpeedStroke()).toBeNull();
});
it('round trips vectors through real single-file serialization, copying and deletion without reseeding', async () => {
  const id = draw(), project = structuredClone(getProject()), encoded = await encodeProject(project, new Map()); if (!encoded.ok) throw Error('encode');
  const text = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(encoded.value); });
  const file = new File([text], 'brush.Comia.json'); Object.defineProperty(file, 'text', { value: async () => text });
  const decoded = await decodeProject(file); if (!decoded.ok) throw Error('decode'); expect(decoded.value.project).toEqual(project);
  expect(copyToClipboard([id]).ok).toBe(true); expect(pasteFromClipboard(project.pageOrder[0]).ok).toBe(true);
  const copy = getProject().layers[sessionStore.getState().selection[0]] as DecorationLayer; expect(copy.spec).toEqual((project.layers[id] as DecorationLayer).spec);
  expect(deleteSelected().ok).toBe(true); expect(undo().ok).toBe(true); expect((getProject().layers[copy.id] as DecorationLayer).spec).toEqual(copy.spec);
});
it('opens previously stored curved format7 ink without rebuilding it as straight lines', async () => {
  const id = draw(), project = structuredClone(getProject()), layer = project.layers[id] as DecorationLayer;
  if (layer.spec.kind !== 'speed-brush') throw Error('brush');
  // A pre-existing curved vector fixture; opening must preserve its actual ink.
  layer.spec.centerline = [{x:.1,y:.2},{x:.5,y:.8},{x:.9,y:.2}];
  layer.spec.ribbons = [[{x:.1,y:.18},{x:.5,y:.78},{x:.9,y:.18},{x:.9,y:.22},{x:.5,y:.82},{x:.1,y:.22}]];
  const paths = buildDecoration(layer.spec), encoded = await encodeProject(project,new Map()); if (!encoded.ok) throw Error('encode');
  const text = await new Promise<string>((resolve,reject) => {const reader = new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsText(encoded.value);});
  const file = new File([text],'previous-curved.Comia.json');Object.defineProperty(file,'text',{value:async()=>text});
  const decoded = await decodeProject(file);if(!decoded.ok)throw Error('decode');
  const restored = decoded.value.project.layers[id] as DecorationLayer;
  expect(decoded.value.project).toEqual(project);expect(buildDecoration(restored.spec)).toEqual(paths);
});
it('rejects damaged format7 geometry and format6 brush objects without changing caller input', () => {
  const id = draw(), p = structuredClone(getProject()); p.schemaVersion = 6; expect(validateProject(p).ok).toBe(false);
  p.schemaVersion = 7; const s = (p.layers[id] as DecorationLayer).spec as SpeedBrushSpec; s.ribbons[0][0].x = NaN; expect(validateProject(p).ok).toBe(false);
  s.ribbons[0][0].x = 2; expect(validateProject(p).ok).toBe(false); s.ribbons[0] = Array.from({ length: 1025 }, () => ({ x: .1, y: .1 })); expect(validateProject(p).ok).toBe(false);
});
it('migrates format6 direction once without renumbering panels or overwriting manga fields', () => {
  expect(addObject('layout:grid-2x2', getProject().pageOrder[0], { x: 0, y: 0 }).ok).toBe(true);
  expect(addObject('bubble-rough', getProject().pageOrder[0], { x: 200, y: 100 }).ok).toBe(true);
  expect(addObject('sfx:impact', getProject().pageOrder[0], { x: 200, y: 200 }).ok).toBe(true);
  const p = structuredClone(getProject()); p.schemaVersion = 6; p.settings.readingDirection = 'ltr';
  // Author a real format6 fixture, excluding metadata that did not exist then.
  for (const layer of Object.values(p.layers)) {
    if (layer.type === 'panel') delete layer.nameMode;
    if (layer.type === 'image') delete layer.sourceRect;
    if (layer.type === 'text') delete layer.bubbleFrame;
    if (layer.type === 'bubble') { delete layer.edgeStyle; delete layer.style.innerStroke; delete layer.style.outerStroke; }
  }
  const before = structuredClone(p);
  const result = migrateProject(p); if (!result.ok) throw Error('migrate'); expect(result.value.schemaVersion).toBe(13); expect(result.value.settings.readingDirection).toBe('rtl'); expect(result.value.layers).toMatchObject(before.layers); expect(p).toEqual(before);
  result.value.settings.readingDirection = 'ltr'; expect(migrateProject(result.value)).toEqual({ ok: true, value: result.value });
});
it('uses the same right-first numbering and first selection for grid, random, proportional cut and drawn line cut', () => {
  const pid = () => getProject().pageOrder[0];
  const verify = () => {
    const list = Object.values(getProject().layers).filter((l): l is PanelLayer => l.type === 'panel');
    const byX = [...list].sort((a,b) => Math.min(...a.geometry.map(p => p.x)) - Math.min(...b.geometry.map(p => p.x)));
    expect(byX.map(p => p.editorNumber)).toEqual([2,1]); expect(byX.map(p => p.name)).toEqual(['分镜 2','分镜 1']); expect(sessionStore.getState().selection).toEqual([byX[1].id]);
  };
  const box = { x: 0, y: 0, width: 800, height: 200 }, grid = makeGrid(box,1,2,16,16), random = generateRandomLayout(box, { count: 2, margin: 0, gapX: 16, gapY: 16, style: 'regular', maxAngleDeg: 0, seed: 42 });
  for (const tree of [grid,random]) { expect(replaceDocument(createProject()).ok).toBe(true); if (!tree.ok) throw Error('layout'); expect(applyIndependentLayout(pid(),tree.value).ok).toBe(true); verify(); }
  expect(replaceDocument(createProject()).ok).toBe(true); const made = addObject('rect-panel',pid(),{x:0,y:0}); if (!made.ok) throw Error('panel'); expect(commitCut(made.value,{axis:'vertical',ratio:.5,gap:16}).ok).toBe(true); verify();
  expect(replaceDocument(createProject()).ok).toBe(true); const line = addObject('rect-panel',pid(),{x:0,y:0}); if (!line.ok) throw Error('panel'); expect(beginDrawing('line',line.value).ok).toBe(true); setRawDrawing([{x:300,y:-50},{x:300,y:500}],1); expect(finishDrawing().ok).toBe(true); verify();
});
it('rejects project-wide brush vertex overflow before recursive normalization and leaves the original valid project intact', () => {
  const before = structuredClone(getProject()), p = structuredClone(before), pid = p.pageOrder[0], spec = built().spec;
  for (let i = 0; i < 16; i++) {
    const layer = createLayer('decoration',pid) as DecorationLayer; layer.spec = { ...spec, ribbons: Array.from({ length: 32 }, () => Array.from({ length: 1000 }, (_, k) => ({ x: k % 2 ? .1 : .9, y: .5 }))) }; p.layers[layer.id] = layer; p.pages[pid].roots.push(layer.id);
  }
  const result = validateProject(p); expect(result.ok).toBe(false); if (!result.ok) expect(result.problems[0].code).toBe('brush/project-budget'); expect(getProject()).toEqual(before);
});
it('rejects an excessively scaled group-local stroke as a whole without changing the document or adding history', () => {
  const pid = getProject().pageOrder[0], g = createLayer('group',pid); if (g.type !== 'group') throw Error('group'); g.matrix = [.001,0,0,.001,0,0];
  expect(execute({label:'小比例组',context:{pageId:pid,selection:[]},mutate(d){d.layers[g.id]=g;d.pages[pid].roots.push(g.id);}}).ok).toBe(true); sessionStore.setState({scopeId:g.id}); const before=getDocument(); start(); appendSpeedSamples([client({x:300,y:100})]); expect(commitSpeedStroke().ok).toBe(false); expect(getDocument()).toBe(before); expect(currentSpeedStroke()).toBeNull();
});
it('merges text/SFX categories while exposing the speed brush as a tool only', () => {
  const catalog = componentCategories({}), merged = catalog.find(c => c.id === 'text-decoration')!;
  expect(catalog.some(c => c.label === '声效字')).toBe(false); expect(merged.items).toHaveLength(8); expect(new Set(merged.items.map(i => i.kind)).size).toBe(8);
  expect(merged.items.find(i => i.kind === 'speed')?.tool).toBe('speed-brush'); expect(merged.items.filter(i => i.kind.startsWith('sfx:'))).toHaveLength(4);
});
it('offers all nine unique standard and emotional presets in the single bubble category', () => {
  const catalog = componentCategories({}), bubbles = catalog.find(c => c.id === 'bubbles')!;
  expect(catalog.some(c => c.id === 'emotion-bubbles' || c.label === '情绪气泡')).toBe(false);
  expect(bubbles.items.map(i => i.kind)).toEqual(['bubble','bubble-rect','bubble-circle','bubble-cloud','bubble-spiky','bubble-soft','bubble-rough','bubble-hand-polygon','bubble-wave']);
  expect(new Set(bubbles.items.map(i => i.kind)).size).toBe(9);
});
it('sorts unequal widths and fixed rows in both directions, rejects duplicate IDs, and retains live-number tail reuse', () => {
  const entries = [{ id: 'wide', bounds: { x: 20, y: 0, width: 200, height: 100 }, paintIndex: 2 }, { id: 'short', bounds: { x: 100, y: 10, width: 80, height: 100 }, paintIndex: 0 }, { id: 'next', bounds: { x: 300, y: 60, width: 10, height: 20 }, paintIndex: 1 }];
  expect(sortPanelReadingOrder(entries, 'rtl')).toEqual({ ok: true, value: ['wide', 'short', 'next'] }); expect(sortPanelReadingOrder(entries, 'ltr')).toEqual({ ok: true, value: ['wide', 'short', 'next'] });
  expect(sortPanelReadingOrder([...entries, entries[0]]).ok).toBe(false);
  const pid = getProject().pageOrder[0]; for (let i = 0; i < 3; i++) expect(addObject('rect-panel', pid, { x: 0, y: 0 }).ok).toBe(true);
  const panels = Object.values(getProject().layers).filter((l): l is PanelLayer => l.type === 'panel'); sessionStore.setState({ selection: [panels[2].id] }); expect(deleteSelected().ok).toBe(true); expect(addObject('rect-panel', pid, { x: 0, y: 0 }).ok).toBe(true);
  expect(Object.values(getProject().layers).filter((l): l is PanelLayer => l.type === 'panel').map(l => l.editorNumber)).toEqual([1, 2, 3]);
});
