import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer } from '../../src/domain/factories';
import { createContentProject as createProject } from '../helpers/contentProject';
import type { PanelLayer } from '../../src/domain/types';
import { execute, replaceDocument, undo, redo } from '../../src/history/commandBus';
import { getDocument, getProject } from '../../src/state/documentStore';
import { cancelPanelStyle, commitPanelStyle, currentPanelStyle, effectivePanelRadius, previewPanelColor, previewPanelStyle, setPanelStyle } from '../../src/panels/style';
import { runtimeStore } from '../../src/state/runtimeStore';

function fixture() {
  const project = createProject(), pageId = project.pageOrder[0], a = createLayer('panel', pageId) as PanelLayer, b = createLayer('panel', pageId) as PanelLayer;
  a.style.borderRadius = 4; b.style.borderRadius = 20; a.style.fill = '#FF000080'; b.style.fill = '#00FF00FF';
  project.layers[a.id] = a; project.layers[b.id] = b; project.pages[pageId].roots = [a.id, b.id]; replaceDocument(project); return { project, pageId, a, b, ids: [a.id, b.id] };
}
beforeEach(cancelPanelStyle);
describe('batch panel style transactions and draft channels', () => {
  it('updates mixed requested radii once, undo restores both old values and redo restores the batch', () => {
    const { project, ids } = fixture(); expect(setPanelStyle(ids, { borderRadius: 12 }).ok).toBe(true); expect(getDocument().history.past).toHaveLength(1);
    for (const id of ids) expect((getProject().layers[id] as PanelLayer).style.borderRadius).toBe(12);
    undo(); expect(getProject()).toEqual(project); redo(); for (const id of ids) expect((getProject().layers[id] as PanelLayer).style.borderRadius).toBe(12);
  });
  it('rejects a partially locked selection, mixed types, cross-page and invalid numeric/color values atomically', () => {
    const { project, ids, b, pageId } = fixture(); const mixed = createLayer('text', pageId); project.layers[mixed.id] = mixed; project.pages[pageId].roots.push(mixed.id); b.locked = true; replaceDocument(project);
    const before = getProject(); expect(setPanelStyle(ids, { borderWidth: 0 }).ok).toBe(false); expect(setPanelStyle([ids[0], mixed.id], { fill: '#FF000000' }).ok).toBe(false);
    for (const patch of [{ borderRadius: NaN }, { borderRadius: 4097 }, { borderWidth: -1 }, { borderWidth: 257 }, { fill: '#ffffff' }, { fill: '#FF0000gg' }]) expect(setPanelStyle([ids[0]], patch).ok).toBe(false);
    expect(getProject()).toEqual(before); expect(getDocument().history.past).toHaveLength(0);
  });
  it('100 intermediate slider events never mutate the document and commit as one undo step', () => {
    const { project, ids } = fixture(); for (let radius = 1; radius <= 100; radius++) expect(previewPanelStyle(ids, { borderRadius: radius }).ok).toBe(true);
    expect(getProject()).toEqual(project); expect(getDocument().history.past).toHaveLength(0); expect(runtimeStore.getState().gestureActive).toBe(true); expect((currentPanelStyle()!.preview.layers[ids[0]] as PanelLayer).style.borderRadius).toBe(100);
    commitPanelStyle(); expect(getDocument().history.past).toHaveLength(1); expect(currentPanelStyle()).toBeNull(); undo(); expect(getProject()).toEqual(project);
  });
  it('RGB changes retain each mixed alpha and alpha changes retain each RGB', () => {
    const { ids } = fixture(); previewPanelColor(ids, 'fill', 'rgb', '#123456'); let active = currentPanelStyle()!;
    expect((active.preview.layers[ids[0]] as PanelLayer).style.fill).toBe('#12345680'); expect((active.preview.layers[ids[1]] as PanelLayer).style.fill).toBe('#123456FF');
    cancelPanelStyle(); previewPanelColor(ids, 'fill', 'alpha', 0); active = currentPanelStyle()!;
    expect((active.preview.layers[ids[0]] as PanelLayer).style.fill).toBe('#FF000000'); expect((active.preview.layers[ids[1]] as PanelLayer).style.fill).toBe('#00FF0000'); commitPanelStyle(); expect(getDocument().history.past).toHaveLength(1);
  });
  it('Escape cancellation and a competing transaction leave no style draft or extra history entry', () => {
    const { project, ids, pageId } = fixture(); previewPanelStyle(ids, { borderWidth: 0, fill: '#AA001100' }); cancelPanelStyle(); expect(getProject()).toEqual(project);
    previewPanelStyle(ids, { borderRadius: 99 }); execute({ label: '竞争编辑', context: { pageId, selection: ids }, mutate(draft) { draft.layers[ids[0]].name = '新名称'; } });
    expect(currentPanelStyle()).toBeNull(); expect((getProject().layers[ids[0]] as PanelLayer).style.borderRadius).toBe(4); expect(getDocument().history.past).toHaveLength(1);
  });
  it('preserves a huge requested radius while reporting the same effective clamp used in geometry', () => {
    const { ids } = fixture(); setPanelStyle([ids[0]], { borderRadius: 4096, borderWidth: 0, fill: '#11223300' }); const panel = getProject().layers[ids[0]] as PanelLayer;
    expect(panel.style.borderRadius).toBe(4096); expect(effectivePanelRadius(panel)).toBeCloseTo(200, 6); expect(panel.style.fill).toBe('#11223300'); expect(panel.style.borderWidth).toBe(0);
  });
});
