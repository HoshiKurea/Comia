import { beforeEach, expect, it } from 'vitest';
import { createLayer, createPageBackground, createProject } from '../../src/domain/factories';
import type { PageBackgroundLayer, PanelLayer, Project } from '../../src/domain/types';
import { validateProject } from '../../src/domain/validate';
import { migrateProject } from '../../src/storage/migrateProject';
import { replaceDocument, undo, redo, execute } from '../../src/history/commandBus';
import { getDocument, getProject } from '../../src/state/documentStore';
import { sessionStore, setSelection } from '../../src/state/sessionStore';
import { deleteSelected } from '../../src/app/actions';
import { addPageBackground, applyBackgroundTemplate, updatePageBackground } from '../../src/pages/backgroundCommands';
import { currentBackgroundEdit, previewPageBackground, commitBackgroundEdit, cancelBackgroundEdit } from '../../src/pages/backgroundController';
import { backgroundFrames, validateBackgroundBudget, validateBackgroundValues, watermarkLayout } from '../../src/pages/backgroundGeometry';
import { backgroundTemplates } from '../../src/pages/backgroundTemplates';
import { groupLayers } from '../../src/layers/group';
import { reparent } from '../../src/layers/reparent';
import { copyLayers } from '../../src/layers/clipboard';
import { moveLayers, reorderSiblings } from '../../src/layers/reorder';
import { resizeProject } from '../../src/interaction/resize';
import { setDimensions, setRotation } from '../../src/interaction/transformCommands';
import { moveByKeyboard as previewKeyboardMove } from '../../src/interaction/keyboardMove';
import { addPage, resizePage, activatePage } from '../../src/pages/commands';
import { setLocked } from '../../src/layers/visibility';
const background = (p: Project = getProject()) => Object.values(p.layers).find(l => l.type === 'pageBackground') as PageBackgroundLayer;
beforeEach(() => { cancelBackgroundEdit(); expect(replaceDocument(createProject()).ok).toBe(true); setSelection([background().id]); });

it('defaults to a real editable bottom white background and produces canonical schema5', () => {
  const p = getProject(), b = background(p); expect(b.fill).toBe('#FFFFFFFF'); expect(b.locked).toBe(false); expect(p.pages[b.pageId].roots[0]).toBe(b.id); expect(p.pages[b.pageId]).not.toHaveProperty('background'); expect(validateProject(p).ok).toBe(true);
});
it.each([1, 2, 3] as const)('migrates version %i colors and transparent pages without mutating input or content IDs', version => {
  const p = createProject(), b = background(p), page = p.pages[b.pageId]; delete p.layers[b.id]; page.roots = []; p.schemaVersion = version; delete p.nextPanelNumber; page.background = '#193B5C00'; if (version < 3) delete p.libraryAssetIds;
  const text = createLayer('text', page.id); p.layers[text.id] = text; page.roots.push(text.id); const original = structuredClone(p), result = migrateProject(p);
  expect(result.ok).toBe(true); if (!result.ok) return; expect(background(result.value).fill).toBe('#193B5C00'); expect(result.value.layers[text.id]).toEqual(text); expect(result.value.pages[page.id].roots[1]).toBe(text.id); expect(p).toEqual(original); expect(result.value.schemaVersion).toBe(14);
});
it('rejects duplicate, moved, nested and nonidentity backgrounds without accepting a second color source', () => {
  const p = getProject(), b = background(p), page = p.pages[b.pageId], other = createPageBackground(page.id); p.layers[other.id] = other; page.roots.push(other.id); expect(validateProject(p).ok).toBe(false);
  delete p.layers[other.id]; page.roots.pop(); b.matrix = [1, 0, 0, 1, 1, 0]; expect(validateProject(p).ok).toBe(false); b.matrix = [1, 0, 0, 1, 0, 0]; page.background = '#FFFFFFFF'; expect(validateProject(p).ok).toBe(false);
});
it('deletes only the selected background, restores its parameters and selection on undo, and readds at bottom', () => {
  const b = background(); expect(applyBackgroundTemplate(b.id, 'doubleFrame').ok).toBe(true); const before = structuredClone(getProject()), count = getDocument().history.past.length;
  expect(deleteSelected().ok).toBe(true); expect(background()).toBeUndefined(); expect(getDocument().history.past).toHaveLength(count + 1); expect(undo().ok).toBe(true); expect(getProject()).toEqual(before); expect(sessionStore.getState().selection).toEqual([b.id]); expect(redo().ok).toBe(true); const added = addPageBackground(b.pageId); expect(added.ok).toBe(true); expect(background().fill).toBe('#FFFFFFFF'); expect(addPageBackground(b.pageId).ok).toBe(false);
});
it('replaces all template parameters while preserving content and restores them with one undo', () => {
  const b = background(), text = createLayer('text', b.pageId); execute({ label: 'fixture', context: { pageId: b.pageId, selection: [b.id] }, mutate(p) { p.layers[text.id] = text; p.pages[b.pageId].roots.push(text.id); } });
  expect(applyBackgroundTemplate(b.id, 'watermark').ok).toBe(true); const before = structuredClone(getProject()); expect(applyBackgroundTemplate(b.id, 'transparent').ok).toBe(true); expect(background().watermark).toBeNull(); expect(background().frame).toBeNull(); expect(background().fill.slice(-2)).toBe('00'); expect(getProject().layers[text.id]).toEqual(text); undo(); expect(getProject()).toEqual(before);
});
it('keeps previews outside the document/history, commits once and cancels on selection or page change', () => {
  const b = background(), p = getProject(), count = getDocument().history.past.length;
  for (let i = 0; i < 100; i++) expect(previewPageBackground(b.id, { fill: '#123456' + i.toString(16).padStart(2, '0') }).ok).toBe(true);
  expect(getProject()).toBe(p); expect(getDocument().history.past).toHaveLength(count); expect(commitBackgroundEdit().ok).toBe(true); expect(getDocument().history.past).toHaveLength(count + 1); expect(undo().ok).toBe(true); expect(background().fill).toBe('#FFFFFFFF');
  previewPageBackground(b.id, { fill: '#112233FF' }); setSelection([]); expect(currentBackgroundEdit()).toBeNull(); expect(background().fill).toBe('#FFFFFFFF');
  setSelection([b.id]); previewPageBackground(b.id, { fill: '#112233FF' }); const page = addPage(b.pageId); expect(page.ok).toBe(true); expect(currentBackgroundEdit()).toBeNull(); if (page.ok) { activatePage(page.value); expect(getProject().layers[getProject().pages[page.value].roots[0]]).toMatchObject({ type: 'pageBackground', fill: '#FFFFFFFF' }); }
});
it('cancels stale previews for competing transactions, locks and project replacement', () => {
  const b = background(); previewPageBackground(b.id, { fill: '#112233FF' }); setLocked([b.id], true); expect(currentBackgroundEdit()).toBeNull(); expect(updatePageBackground(b.id, { fill: '#123456FF', frame: null, watermark: null }).ok).toBe(false); expect(deleteSelected().ok).toBe(false); expect(background().fill).toBe('#FFFFFFFF');
  setLocked([b.id], false); previewPageBackground(b.id, { fill: '#112233FF' }); replaceDocument(createProject()); expect(currentBackgroundEdit()).toBeNull(); expect(background().fill).toBe('#FFFFFFFF');
});
it('rejects background transforms, copying and grouping before creating any history', () => {
  const b = background(), count = getDocument().history.past.length;
  expect(setDimensions(b.id, 400, 300).ok).toBe(false); expect(setRotation(b.id, 20).ok).toBe(false); expect(resizeProject(getProject(), b.id, { x: 10, y: 10, width: 100, height: 100 }).ok).toBe(false); expect(copyLayers([b.id]).ok).toBe(false); expect(reparent([b.id], null).ok).toBe(false); expect(moveLayers([b.id], 'top').ok).toBe(false); expect(previewKeyboardMove(1, 0).ok).toBe(false); expect(groupLayers([b.id, b.id]).ok).toBe(false); expect(getDocument().history.past).toHaveLength(count);
});
it('moves content to the bottom above background and rejects a direct insertion below it', () => {
  const b = background(), a = createLayer('text', b.pageId), z = createLayer('text', b.pageId);
  execute({ label: 'fixture', context: { pageId: b.pageId, selection: [] }, mutate(p) { p.layers[a.id] = a; p.layers[z.id] = z; p.pages[b.pageId].roots.push(a.id, z.id); } });
  expect(moveLayers([z.id], 'bottom').ok).toBe(true); expect(getProject().pages[b.pageId].roots).toEqual([b.id, z.id, a.id]); expect(reorderSiblings({ draggedIds: [a.id], parentId: null, beforeId: b.id }).ok).toBe(false); expect(moveLayers([z.id], 'down').ok).toBe(true); expect(getProject().pages[b.pageId].roots[0]).toBe(b.id);
});
it('retains requested border widths on tiny pages and draws no negative inner rectangle', () => {
  const frame = { kind: 'double' as const, color: '#000000FF', width: 256, insetRatio: .45, gap: 256 }, result = backgroundFrames(16, 16, frame);
  expect(result.effectiveWidth).toBe(4); expect(result.boxes).toEqual([{ x: 7.5, y: 7.5, width: 1, height: 1 }]); expect(result.innerOmitted).toBe(true); expect(frame.width).toBe(256);
});
it('rejects invalid colors, numeric extremes, controls, empty watermarks and excessive grids without modifying history', () => {
  const b = background(), p = getProject(), count = getDocument().history.past.length;
  for (const fill of ['', '#fff', 'red']) expect(previewPageBackground(b.id, { fill }).ok).toBe(false);
  const w = backgroundTemplates.find(t => t.id === 'watermark')!.values.watermark!;
  for (const content of ['', 'a\nb', 'x'.repeat(81)]) expect(validateBackgroundValues({ fill: '#FFFFFFFF', frame: null, watermark: { ...w, content } }).ok).toBe(false);
  expect(validateBackgroundValues({ fill: '#FFFFFFFF', frame: { kind: 'single', color: '#FFFFFFFF', width: NaN, insetRatio: 0, gap: 0 }, watermark: null }).ok).toBe(false);
  expect(validateBackgroundBudget(16384, 16384, { ...w, spacingX: 16, spacingY: 16 }).ok).toBe(false); expect(getProject()).toBe(p); expect(getDocument().history.past).toHaveLength(count);
});
it('calculates centered rotated single and bounded repeat centers with explicit spacing', () => {
  const w = backgroundTemplates.find(t => t.id === 'watermark')!.values.watermark!;
  expect(watermarkLayout(640, 480, { ...w, repeat: false, angleDeg: 90 }, 100, 64)).toEqual({ ok: true, value: { centers: [{ x: 320, y: 240 }], angle: Math.PI / 2 } });
  const tiled = watermarkLayout(640, 480, w, 100, 64); expect(tiled.ok).toBe(true); if (tiled.ok) { expect(tiled.value.centers).toHaveLength(3); expect(tiled.value.centers.map(c => c.y)).toEqual([20, 240, 460]); }
});
it('rejects page enlargement that would exceed the watermark budget in the same transaction', () => {
  const b = background(); resizePage(b.pageId, { preset: 'custom', widthPx: 64, heightPx: 64, orientation: 'portrait', dpi: 72 });
  const w = backgroundTemplates.find(t => t.id === 'watermark')!.values.watermark!; expect(updatePageBackground(b.id, { fill: b.fill, frame: null, watermark: { ...w, spacingX: 16, spacingY: 16 } }).ok).toBe(true);
  const before = getProject(), count = getDocument().history.past.length; expect(resizePage(b.pageId, { preset: 'custom', widthPx: 16384, heightPx: 16384, orientation: 'portrait', dpi: 72 }).ok).toBe(false); expect(getProject()).toBe(before); expect(getDocument().history.past).toHaveLength(count);
});
it('migrates a valid 5000-content-layer legacy document without dropping any content', () => {
  const p = createProject(), b = background(p), page = p.pages[b.pageId]; delete p.layers[b.id]; page.roots = []; p.schemaVersion = 3; delete p.nextPanelNumber; page.background = '#FFFFFFFF';
  for (let i = 0; i < 5000; i++) { const panel = createLayer('panel', page.id) as PanelLayer; p.layers[panel.id] = panel; page.roots.push(panel.id); }
  const result = migrateProject(p); expect(result.ok).toBe(true); if (result.ok) { expect(Object.keys(result.value.layers)).toHaveLength(5001); expect(result.value.pages[page.id].roots.slice(1)).toEqual(page.roots); }
});
