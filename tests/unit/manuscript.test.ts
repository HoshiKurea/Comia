import { describe, expect, it } from 'vitest';
import { createLayer, createProject, mmToPx } from '../../src/domain/factories';
import { defaultManuscript, manuscriptGeometry, manuscriptSegments, parseManuscript } from '../../src/pages/manuscript';
import { createPageSetupDraft, resolvePageSetup } from '../../src/pages/PageSetupFields';
import { buildNewProject } from '../../src/projects/newProject';
import { addPage, configurePage, resizePage } from '../../src/pages/commands';
import { getDocument, getProject } from '../../src/state/documentStore';
import { replaceDocument, redo, undo } from '../../src/history/commandBus';
import { migrateProject } from '../../src/storage/migrateProject';
import { validateProject } from '../../src/domain/validate';
import { sessionStore } from '../../src/state/sessionStore';
import { createDefaultPreferences, validatePreferences } from '../../src/preferences/model';
import { documentHasWork } from '../../src/projects/workspaces';
import { numberFixture } from '../helpers/numberFixture';

describe('comic manuscript setup and guides', () => {
  it('creates A4 600dpi pages with exact B5/bleed/basic physical geometry and no artwork guide layers', () => {
    const draft = createPageSetupDraft(), r = resolvePageSetup(draft); if (!r.ok) throw Error(JSON.stringify(r));
    expect(r.value).toMatchObject({ width: 4961, height: 7016, dpi: 600, manuscript: defaultManuscript() });
    const p = createProject({ comic: true }), page = p.pages[p.pageOrder[0]], k = 600 / 25.4, g = manuscriptGeometry(page, page.manuscript!);
    expect(g.trim.x).toBeCloseTo((4961 - 182 * k) / 2, 8); expect(g.trim.height).toBeCloseTo(257 * k, 8);
    expect(g.bleed.x).toBeCloseTo(g.trim.x - 5 * k, 8); expect(g.basic.y).toBeCloseTo((7016 - 219 * k) / 2, 8);
    expect(Object.values(p.layers).map(l => l.type)).toEqual(['pageBackground']); expect(validateProject(p).ok).toBe(true);
    expect(documentHasWork({ ...getDocument(), project: p, history: { past: [], future: [], stateId: p.id } })).toBe(false);
  });
  it('uses rounded final canvas pixels but exact mm guide coordinates, including offsets and safety inset', () => {
    const p = createProject({ comic: true }), page = p.pages[p.pageOrder[0]], m = defaultManuscript();
    m.basicFrame.offsetXMm = 3.25; m.basicFrame.offsetYMm = -2; m.safeInsetMm = 7;
    const r = parseManuscript(m, page); expect(r.ok).toBe(true); const g = manuscriptGeometry(page, m), k = 600 / 25.4;
    expect(g.basic.x).toBeCloseTo((page.width - 149 * k) / 2 + 3.25 * k, 8);
    expect(g.basic.y).toBeCloseTo((page.height - 219 * k) / 2 - 2 * k, 8);
    expect(g.safe!.width).toBeCloseTo((182 - 14) * k, 8);
    const draft = createPageSetupDraft(page); draft.width = '210.015666666667'; draft.height = String(page.height * 25.4 / page.dpi);
    expect(resolvePageSetup(draft)).toMatchObject({ ok: true, value: { width: page.width, height: page.height } });
    draft.preset = 'custom'; draft.unit = 'px'; draft.width = '20.5'; draft.height = '200'; draft.manuscript = false; expect(resolvePageSetup(draft).ok).toBe(false);
  });
  it('rejects missing/nonfinite, negative, overflowing bleed/basic/offset/safety settings without mutating inputs', () => {
    const p = createProject({ comic: true }), page = p.pages[p.pageOrder[0]];
    for (const v of [null, {}, [], { ...defaultManuscript(), trim: { widthMm: Infinity, heightMm: 257 } }, { ...defaultManuscript(), bleedMm: 51 },
      { ...defaultManuscript(), bleedMm: -1 }, { ...defaultManuscript(), bleedMm: 20 }, { ...defaultManuscript(), safeInsetMm: 100 },
      { ...defaultManuscript(), basicFrame: { widthMm: 149, heightMm: 219, offsetXMm: 50, offsetYMm: 0 } },
      { ...defaultManuscript(), basicFrame: { widthMm: .001, heightMm: 219, offsetXMm: 0, offsetYMm: 0 } }]) expect(parseManuscript(v, page).ok).toBe(false);
    const raw = defaultManuscript(), before = structuredClone(raw), r = parseManuscript(raw, page); if (!r.ok) throw Error('settings');
    r.value.basicFrame.offsetXMm = 2; expect(raw).toEqual(before);
    for (const n of ['', 'NaN', 'Infinity', '0', '-1']) { const draft = createPageSetupDraft(); draft.trimWidth = n; expect(resolvePageSetup(draft).ok).toBe(false); }
  });
  it('produces straight corners and four centre crosses, clips marks to paper, handles zero bleed and tight margins', () => {
    const p = createProject({ comic: true }), page = p.pages[p.pageOrder[0]];
    let segments = manuscriptSegments(page); expect(segments.filter(s => s.kind === 'mark')).toHaveLength(24);
    for (const s of segments) { expect(s.a.x === s.b.x || s.a.y === s.b.y).toBe(true); for (const q of [s.a, s.b]) { expect(q.x).toBeGreaterThanOrEqual(0); expect(q.x).toBeLessThanOrEqual(page.width); expect(q.y).toBeGreaterThanOrEqual(0); expect(q.y).toBeLessThanOrEqual(page.height); } }
    page.manuscript!.cropMarks = false; expect(manuscriptSegments(page)).toHaveLength(12);
    page.manuscript!.cropMarks = true; page.manuscript!.bleedMm = 0; segments = manuscriptSegments(page); expect(segments.filter(s => s.kind === 'mark')).toHaveLength(16);
    page.width = mmToPx(182, 600); page.height = mmToPx(257, 600); expect(parseManuscript(page.manuscript, page).ok).toBe(true);
    expect(manuscriptSegments(page).filter(s => s.kind === 'mark')).toHaveLength(0);
    delete page.manuscript; expect(manuscriptSegments(page)).toEqual([]);
  });
  it('builds 8 independent pages with cloned guide settings, editable colored/transparent paper and RTL order', () => {
    const r = buildNewProject({ name: '漫画', page: { preset: 'A4', orientation: 'portrait', dpi: 600 }, background: 'white', paperColor: '#AACCFFFF', pageCount: 8, manuscript: defaultManuscript() });
    if (!r.ok) throw Error(JSON.stringify(r)); const p = r.value; expect(p.pageOrder).toHaveLength(8); expect(p.settings.readingDirection).toBe('rtl');
    expect(new Set(Object.keys(p.pages)).size).toBe(8); expect(new Set(p.pageOrder.flatMap(id => p.pages[id].roots)).size).toBe(8);
    for (const [i, id] of p.pageOrder.entries()) { expect(p.pages[id].name).toBe(`第${i + 1}页`); expect(p.layers[p.pages[id].roots[0]]).toMatchObject({ type: 'pageBackground', fill: '#AACCFFFF' }); }
    p.pages[p.pageOrder[0]].manuscript!.basicFrame.offsetXMm = 2; expect(p.pages[p.pageOrder[1]].manuscript!.basicFrame.offsetXMm).toBe(0);
    for (const pageCount of [0, 101, NaN, Infinity, 1.5]) expect(buildNewProject({ name: '漫画', page: { preset: 'A4', orientation: 'portrait', dpi: 600 }, background: 'white', pageCount }).ok).toBe(false);
  });
  it('inherits the active manuscript and paper color, with atomic page addition undo/redo and no shared references', () => {
    const p = createProject({ comic: true }), id = p.pageOrder[0]; (p.layers[p.pages[id].roots[0]] as { fill: string }).fill = '#12345600';
    expect(replaceDocument(p).ok).toBe(true); sessionStore.setState({ activePageId: id });
    const r = addPage(id); if (!r.ok) throw Error(JSON.stringify(r)); const next = r.value;
    expect(getProject().pages[next].manuscript).toEqual(defaultManuscript()); expect(getProject().layers[getProject().pages[next].roots[0]]).toMatchObject({ fill: '#12345600' });
    expect(undo().ok).toBe(true); expect(getProject().pages[next]).toBeUndefined(); expect(redo().ok).toBe(true); expect(getProject().pages[next].manuscript).toEqual(defaultManuscript());
  });
  it('applies/disables guides in one undoable edit without shifting content and refuses incompatible direct resizing', () => {
    const p = createProject({ comic: true }), id = p.pageOrder[0], layer = createLayer('panel', id); p.layers[layer.id] = layer; p.pages[id].roots.push(layer.id);
    expect(replaceDocument(numberFixture(p)).ok).toBe(true); const initial = structuredClone(getProject()), m = defaultManuscript(); m.basicFrame.offsetXMm = 4;
    expect(configurePage(id, { width: 4961, height: 7016, dpi: 600 }, m).ok).toBe(true); expect(getDocument().history.past).toHaveLength(1);
    expect(getProject().layers[layer.id]).toEqual(initial.layers[layer.id]); expect(undo().ok).toBe(true); expect(getProject()).toEqual(initial); expect(redo().ok).toBe(true);
    const unchanged = getDocument(); expect(resizePage(id, { preset: 'custom', orientation: 'portrait', dpi: 600, widthPx: 100, heightPx: 100 }).ok).toBe(false); expect(getDocument()).toBe(unchanged);
    expect(configurePage(id, { width: 100, height: 100, dpi: 600 }, undefined).ok).toBe(true); expect(getProject().pages[id].manuscript).toBeUndefined(); expect(getProject().layers[layer.id]).toEqual(initial.layers[layer.id]);
    expect(undo().ok).toBe(true); expect(getProject().pages[id].manuscript).toEqual(m);
  });
  it('upgrades old projects without injecting guides or changing pixels and rejects guide payloads in older schemas', () => {
    const p = createProject(); p.schemaVersion = 12; const before = structuredClone(p), r = migrateProject(p); if (!r.ok) throw Error(JSON.stringify(r));
    expect(r.value.schemaVersion).toBe(14); expect(r.value.pages).toEqual(p.pages); expect(r.value.layers).toEqual(p.layers); expect(p).toEqual(before);
    const comic = createProject({ comic: true }); comic.schemaVersion = 12; expect(validateProject(comic).ok).toBe(false);
    comic.schemaVersion = 13; expect(validateProject(comic).ok).toBe(true); comic.pages[comic.pageOrder[0]].manuscript!.bleedMm = 50; expect(validateProject(comic).ok).toBe(false);
  });
  it('restores guide visibility for existing preferences while preserving shortcuts and rejects invalid new values', () => {
    const p = createDefaultPreferences(), { showManuscriptGuides: _old, ...legacy } = p;
    expect(validatePreferences(legacy)).toMatchObject({ ok: true, value: { showManuscriptGuides: true, shortcuts: p.shortcuts, generation: p.generation } });
    expect(validatePreferences({ ...p, showManuscriptGuides: 'yes' }).ok).toBe(false);
  });
});
