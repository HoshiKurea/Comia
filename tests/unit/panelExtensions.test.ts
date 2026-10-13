import { describe, it, expect } from 'vitest';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import type { PanelLayer } from '../../src/domain/types';
import { migrateProject } from '../../src/storage/migrateProject';
import { validateProject } from '../../src/domain/validate';
import { containsSimplePolygon, polygonContained, validateSimplePolygon } from '../../src/geometry/simplePolygon';
import { PANEL_PRESETS, LAYOUT_PRESETS, makePanelPreset, makeLayoutPreset, makeGrid, rectangle } from '../../src/panels/presets';
import { splitPolygon } from '../../src/panels/lineCut';
import { generateRandomLayout } from '../../src/panels/randomLayout';
import { correctContour } from '../../src/panels/correctContour';
import { polyBounds, metrics } from '../../src/geometry/polygon';
import { encodeProject, decodeProject } from '../../src/storage/codec';
import { replaceDocument, undo, redo } from '../../src/history/commandBus';
import { getDocument } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';
import { beginDrawing, currentDrawing, setRawDrawing, finishDrawing, commitDrawing, cancelDrawing, setDrawingGeometry } from '../../src/panels/drawingController';
import { capturePanelTemplate, instantiateTemplate } from '../../src/library/templates';
import { previewCut, commitCut } from '../../src/panels/cutPanel';
import { applyIndependentLayout, separatePanelLayout } from '../../src/panels/independentLayout';
import { worldMatrix, apply } from '../../src/geometry/matrix';
import { resolveCrop } from '../../src/images/crop';
const u = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 70, y: 100 }, { x: 70, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 100 }, { x: 0, y: 100 }];
describe('general frame contract', () => {
  it('preserves a concave opening and rejects edges crossing it', () => {
    expect(validateSimplePolygon(u).ok).toBe(true); expect(containsSimplePolygon(u, { x: 50, y: 80 })).toBe(false);
    expect(containsSimplePolygon(u, { x: 20, y: 80 })).toBe(true);
    expect(polygonContained(u, rectangle({ x: 20, y: 50, width: 60, height: 20 }))).toBe(false);
  });
  it('rejects crossed, overlapping, too-small and nonfinite contours', () => {
    expect(validateSimplePolygon([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }]).ok).toBe(false);
    expect(validateSimplePolygon(rectangle({ x: 0, y: 0, width: 15, height: 30 })).ok).toBe(false);
    expect(validateSimplePolygon([{ x: NaN, y: 0 }, ...u]).ok).toBe(false);
    expect(validateSimplePolygon([...u, { x: 0, y: 120 }]).ok).toBe(false);
  });
  it('migrates a validated legacy project without allowing concavity in v1', () => {
    const p = createProject(); p.schemaVersion = 1; Object.values(p.pages).forEach(page => { page.background = '#FFFFFFFF'; }); const id = p.pageOrder[0]; const panel = createLayer('panel', id) as PanelLayer;
    p.layers[panel.id] = panel; p.pages[id].roots = [panel.id]; const migrated = migrateProject(p);
    expect(migrated).toMatchObject({ ok: true, value: { schemaVersion: 13 } }); expect(p.schemaVersion).toBe(1);
    panel.geometry = u; panel.geometryMode = 'simple'; expect(migrateProject(p).ok).toBe(false);
    p.schemaVersion = 2; expect(validateProject(p).ok).toBe(true); panel.style.borderRadius = 12; expect(validateProject(p).ok).toBe(false);
  });
  it('creates every shape and every layout with valid convex geometry', () => {
    for (const [kind] of PANEL_PRESETS) expect(makePanelPreset(kind).ok, kind).toBe(true);
    for (const [kind] of LAYOUT_PRESETS) { const result = makeLayoutPreset(kind, { x: 0, y: 0, width: 600, height: 800 }); expect(result.ok, kind).toBe(true); }
    expect(makeGrid({ x: 0, y: 0, width: 20, height: 20 }, 2, 2, 16, 16).ok).toBe(false);
  });
  it('retains all three connected pieces of a concave cut and rejects grazing cuts', () => {
    const cut = splitPolygon(u, 'simple', { a: { x: -10, y: 50 }, b: { x: 110, y: 50 }, gap: 0 });
    expect(cut.ok).toBe(true); if (cut.ok) { expect(cut.value).toHaveLength(3); expect(cut.value.every(p => validateSimplePolygon(p).ok)).toBe(true); }
    expect(splitPolygon(u, 'simple', { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, gap: 0 }).ok).toBe(false);
  });
  it('preserves valid closed corners during correction and rejects crossed strokes', () => {
    const options = { mode: 'contour' as const, toleranceScreenPx: 1.5, closeDistanceScreenPx: 16 };
    expect(correctContour([...u, u[0]], options, 1)).toEqual({ ok: true, value: u });
    expect(correctContour([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }], options, 1).ok).toBe(false);
    expect(correctContour(u, { ...options, mode: 'smooth' }, 1).ok).toBe(true);
    expect(correctContour(u, { ...options, mode: 'straighten' }, 1).ok).toBe(true);
  });
  it('generates exact, bounded, reproducible layouts across 200 seeds and all requested counts', () => {
    const countLeaves = (node: import('../../src/domain/types').PanelTemplateNode): number => node.children.length ? node.children.reduce((n, child) => n + countLeaves(child), 0) : 1;
    for (let seed = 0; seed < 200; seed++) {
      const options = { count: 2 + seed % 23, margin: 48, gapX: 16, gapY: 24, maxAngleDeg: 25, seed, style: 'dynamic' as const };
      const result = generateRandomLayout({ x: 0, y: 0, width: 1800, height: 2400 }, options);
      expect(result.ok, `seed ${seed}`).toBe(true); if (!result.ok) continue;
      expect(countLeaves(result.value)).toBe(options.count);
      expect(generateRandomLayout({ x: 0, y: 0, width: 1800, height: 2400 }, options)).toEqual(result);
      const visit = (node: import('../../src/domain/types').PanelTemplateNode) => {
        expect(validateProjectGeometry(node.geometry)).toBe(true);
        for (const child of node.children) { expect(polygonContained(node.geometry, child.geometry)).toBe(true); visit(child); }
        if (node.children.length === 2) {
          const areas = node.children.map(c => { const m = metrics(c.geometry); return m.ok ? Math.abs(m.value.signedArea) : 0; });
          const m = metrics(node.geometry); expect(areas[0] + areas[1]).toBeLessThanOrEqual((m.ok ? Math.abs(m.value.signedArea) : 0) + 1e-5);
        }
      }; visit(result.value);
    }
    const options = { count: 24, margin: 0, gapX: 256, gapY: 256, maxAngleDeg: 0, seed: 42, style: 'regular' as const };
    expect(generateRandomLayout({ x: 0, y: 0, width: 32, height: 32 }, options).ok).toBe(false);
  });
  it('persists concave geometry and its mode through actual project encoding', async () => {
    const p = createProject(), id = p.pageOrder[0], layer = createLayer('panel', id) as PanelLayer; layer.geometry = u; layer.geometryMode = 'simple'; p.layers[layer.id] = layer; p.pages[id].roots = [layer.id];
    const encoded = await encodeProject(p, new Map()); expect(encoded.ok).toBe(true);
    if (encoded.ok) {
      // jsdom File lacks text(); preserve actual encoded bytes using its FileReader.
      const text = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(encoded.value); });
      const file = new File([text], 'test.comia'); Object.defineProperty(file, 'text', { value: async () => text });
      const decoded = await decodeProject(file); expect(decoded).toMatchObject({ ok: true }); if (decoded.ok) expect(decoded.value.project).toEqual((migrateProject(p) as { ok: true; value: typeof p }).value);
    }
  });
  it('commits a drawing once and restores the entire project on undo/redo', () => {
    const p = createProject(); replaceDocument(p); const id = p.pageOrder[0]; sessionStore.setState({ activePageId: id });
    const before = getDocument().project; expect(beginDrawing('freehand').ok).toBe(true); setRawDrawing(u, 1); expect(finishDrawing().ok).toBe(true);
    expect(getDocument().history.past).toHaveLength(0); expect(commitDrawing().ok).toBe(true); const after = getDocument().project;
    expect(getDocument().history.past).toHaveLength(1); undo(); expect(getDocument().project).toEqual(before); redo(); expect(getDocument().project).toEqual(after);
  });
  it('cancels drafts on replacement and retains the last valid shape on invalid edits', () => {
    const p = createProject(); replaceDocument(p); sessionStore.setState({ activePageId: p.pageOrder[0] }); beginDrawing('polygon'); setRawDrawing(u, 1); finishDrawing();
    expect(setDrawingGeometry([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }]).ok).toBe(false); expect(currentDrawing()?.points).toEqual(u);
    replaceDocument(createProject()); expect(currentDrawing()).toBeNull(); cancelDrawing(); expect(getDocument().history.past).toHaveLength(0);
  });
  it('keeps all connected concave pieces through the original parameter cut and complete undo', () => {
    const p = createProject(), id = p.pageOrder[0], layer = createLayer('panel', id) as PanelLayer; layer.geometry = u; layer.geometryMode = 'simple'; p.layers[layer.id] = layer; p.pages[id].roots = [layer.id];
    replaceDocument(p); sessionStore.setState({ activePageId: id, selection: [layer.id] }); const before = getDocument().project;
    const spec = { axis: 'horizontal' as const, ratio: .5, gap: 0 }, preview = previewCut(layer.id, spec); expect(preview.ok && preview.value.polygons.length).toBe(3);
    const result = commitCut(layer.id, spec); expect(result.ok && result.value.length).toBe(3); const after = getDocument().project;
    expect(validateProject(after).ok).toBe(true); undo(); expect(getDocument().project).toEqual(before); redo(); expect(getDocument().project).toEqual(after);
  });
  it('captures and instantiates a free contour template without flattening its concavity or mode', () => {
    const p = createProject(), id = p.pageOrder[0], layer = createLayer('panel', id) as PanelLayer; layer.geometry = u; layer.geometryMode = 'simple'; p.layers[layer.id] = layer; p.pages[id].roots = [layer.id];
    replaceDocument(p); sessionStore.setState({ activePageId: id, selection: [layer.id] }); const captured = capturePanelTemplate(layer.id, '自由U形'); expect(captured.ok).toBe(true); if (!captured.ok) return;
    const instantiated = instantiateTemplate(captured.value, id); expect(instantiated.ok).toBe(true); if (!instantiated.ok) throw Error('missing template');
    const panel=instantiated.value.descendants.find(l=>l.type==='panel');if(panel?.type!=='panel')throw Error('panel');
    expect(panel.geometryMode).toBe('simple'); expect(panel.geometry).toEqual(u); expect(panel.id).not.toBe(layer.id);
    expect(validateProject(getDocument().project).ok).toBe(true);
  });
  it('handles the maximum raw sample budget without recursive overflow and rejects invalid generator targets', () => {
    const raw = Array.from({ length: 4096 }, (_, i) => ({ x: 500 + 300 * Math.cos(i * Math.PI / 2048), y: 500 + 300 * Math.sin(i * Math.PI / 2048) }));
    const result = correctContour(raw, { mode: 'contour', toleranceScreenPx: 1.5, closeDistanceScreenPx: 16 }, 1); expect(result.ok).toBe(true); if (result.ok) expect(result.value.length).toBeLessThanOrEqual(256);
    const options = { count: 6, margin: 0, gapX: 16, gapY: 16, maxAngleDeg: 12, seed: 42, style: 'dynamic' as const };
    expect(generateRandomLayout({ x: 0, y: 0, width: 100, height: 100 }, options, u).ok).toBe(false);
    expect(generateRandomLayout({ x: 0, y: 0, width: 100, height: 100 }, { ...options, seed: NaN }).ok).toBe(false);
  });
  it('owns validated preview points even when the next pointer sample mutates its original array', () => {
    const p = createProject(), pageId = p.pageOrder[0], layer = createLayer('panel', pageId) as PanelLayer;
    layer.geometry = structuredClone(u); layer.geometryMode = 'simple'; p.layers[layer.id] = layer; p.pages[pageId].roots = [layer.id];
    replaceDocument(p); sessionStore.setState({ activePageId: pageId }); expect(beginDrawing('edit', layer.id).ok).toBe(true);
    const samples = structuredClone(u); samples[1].x = 95; expect(setDrawingGeometry(samples).ok).toBe(true);
    const legal = structuredClone(currentDrawing()!.preview), previous = currentDrawing()!.preview;
    samples[1] = { x: 0, y: 100 }; expect(setDrawingGeometry(samples).ok).toBe(false);
    expect(previous).toEqual(legal); expect(currentDrawing()!.preview).toEqual(legal); expect(getDocument().project).toEqual(p);
    expect(getDocument().history.past).toHaveLength(0); cancelDrawing();
  });
  it('replaces a nested illustrated target with independently editable siblings while preserving page mapping and atomic undo', () => {
    const p = createProject(), pageId = p.pageOrder[0], group = createLayer('group', pageId), outer = createLayer('panel', pageId), target = createLayer('panel', pageId), image = createLayer('image', pageId);
    if (group.type !== 'group' || outer.type !== 'panel' || target.type !== 'panel' || image.type !== 'image') throw Error('factory');
    group.matrix = [1.1,.2,-.1,.9,70,80]; group.children = [outer.id]; outer.parentId = group.id; outer.matrix = [1,0,0,1,30,40]; outer.role = 'split'; outer.children = [target.id]; target.parentId = outer.id; target.children = [image.id]; image.parentId = target.id;
    const assetId = crypto.randomUUID(); p.assets[assetId] = { id: assetId, name: 'test.png', originalMime: 'image/png', renderMime: 'image/png', originalHash: 'a'.repeat(64), renderHash: 'b'.repeat(64), width: 800, height: 600, originalBytes: 10, renderBytes: 10, framePolicy: 'still', normalizedOrientation: true }; image.assetId = assetId; image.width = 800; image.height = 600; image.crop = { focus: {u:.4,v:.6}, zoom:1.5 };
    for (const l of [group,outer,target,image]) p.layers[l.id] = l; p.pages[pageId].roots = [group.id]; expect(replaceDocument(p).ok).toBe(true); sessionStore.setState({activePageId:pageId});
    const tree = makeGrid(polyBounds(target.geometry),2,2,16,16); if (!tree.ok) throw Error('grid'); const oldWorld = worldMatrix(p,target.id), oldMap = resolveCrop(target.geometry,{x:800,y:600},image.crop);
    const result = applyIndependentLayout(pageId,tree.value,target.id); expect(result.ok).toBe(true); if (!result.ok) return; const after = getDocument().project;
    expect(after.layers[target.id]).toBeUndefined(); expect(result.value).toHaveLength(4);
    for (const id of result.value) { const panel = after.layers[id] as PanelLayer, child = after.layers[panel.children[0]]; if(child.type!=='image'||!child.crop)throw Error('image'); expect(panel.parentId).toBe(group.id);const m=resolveCrop(panel.geometry,{x:800,y:600},child.crop);for(const key of ['scale','tx','ty']as const)expect(m[key]).toBeCloseTo(oldMap[key],10); const a=apply(worldMatrix(after,id),{x:123,y:234}),b=apply(oldWorld,{x:123,y:234});expect(a.x).toBeCloseTo(b.x,10);expect(a.y).toBeCloseTo(b.y,10); }
    expect(getDocument().history.past).toHaveLength(1);undo();expect(getDocument().project).toEqual(p);redo();expect(getDocument().project).toEqual(after);
  });
  it('keeps seed provenance in independent frames and templates, including seed zero, and rejects invalid file metadata', () => {
    for (const seed of [0, 4294967295]) {
      const p = createProject(), pageId = p.pageOrder[0]; replaceDocument(p); sessionStore.setState({ activePageId: pageId });
      const tree = generateRandomLayout({ x: 0, y: 0, width: 600, height: 800 }, { count: 2, margin: 0, gapX: 16, gapY: 16, maxAngleDeg: 0, seed, style: 'regular' });
      if (!tree.ok) throw Error('generator'); const made = applyIndependentLayout(pageId, tree.value); if (!made.ok) throw Error('apply');
      for (const id of made.value) expect((getDocument().project.layers[id] as PanelLayer).randomSeed).toBe(seed);
      const captured = capturePanelTemplate(made.value[0], '带来源的分镜'); if (!captured.ok) throw Error('capture');
      const instance = instantiateTemplate(captured.value, pageId); if (!instance.ok) throw Error('instantiate'); const savedPanel = instance.value.descendants.find(l=>l.type==='panel'); if (savedPanel?.type !== 'panel') throw Error('panel'); expect(savedPanel.randomSeed).toBe(seed);
      expect(validateProject(getDocument().project).ok).toBe(true);
      for (const bad of [NaN, -1, .5, 4294967296]) {
        const invalid = structuredClone(getDocument().project); (invalid.layers[made.value[0]] as PanelLayer).randomSeed = bad; expect(validateProject(invalid).ok).toBe(false);
        const invalidTemplate = structuredClone(getDocument().project); const template=invalidTemplate.templates[captured.value]; if (!('recipe' in template)||template.recipe.kind!=='scene')throw Error('recipe'); const node=Object.values(template.recipe.nodes).find(n=>n.type==='panel'); if(node?.type!=='panel')throw Error('panel');node.randomSeed = bad; expect(validateProject(invalidTemplate).ok).toBe(false);
      }
    }
  });
  it('refuses to separate locked descendants and removes only split parents when separation succeeds', () => {
    const p=createProject(),pageId=p.pageOrder[0],root=createLayer('panel',pageId)as PanelLayer,leaf=createLayer('panel',pageId)as PanelLayer;root.role='split';root.children=[leaf.id];root.matrix=[1,0,0,1,35,67];leaf.parentId=root.id;leaf.locked=true;p.layers[root.id]=root;p.layers[leaf.id]=leaf;p.pages[pageId].roots=[root.id];replaceDocument(p);sessionStore.setState({activePageId:pageId});
    expect(separatePanelLayout(root.id).ok).toBe(false);expect(getDocument().history.past).toHaveLength(0);leaf.locked=false;replaceDocument(p);const result=separatePanelLayout(root.id);expect(result.ok).toBe(true);const after=getDocument().project;expect(after.layers[root.id]).toBeUndefined();expect(after.layers[leaf.id].matrix).toEqual(root.matrix);expect(after.layers[leaf.id].parentId).toBeNull();undo();expect(getDocument().project).toEqual(p);
  });
});
function validateProjectGeometry(points: import('../../src/domain/types').Point[]) { const b = polyBounds(points); return b.width >= 16 && b.height >= 16 && validateSimplePolygon(points).ok; }
