import { createStore } from 'zustand/vanilla';
import type { Id, Project, Result } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { documentStore, getDocument } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { bindImagesToPanel, rankPanelOverlaps } from './panelAssociation';

export interface AssociationHint { project: Project; pageId: Id; panelId: Id | null; imageId: Id | null; kind: 'library' | 'move' | 'recommend'; free: boolean }
export const associationStore = createStore<{ hint: AssociationHint | null }>(() => ({ hint: null }));
export function clearAssociation(): void { associationStore.setState({ hint: null }); }
export function suggestAssociation(project: Project, imageId: Id, kind: 'move' | 'recommend'): Id | null {
  const panelId = rankPanelOverlaps(project, imageId)[0]?.panelId ?? null;
  associationStore.setState({ hint: panelId ? { project, pageId: project.layers[imageId].pageId, panelId, imageId, kind, free: false } : null }); return panelId;
}
export function acceptAssociation(): Result<void> {
  const hint = associationStore.getState().hint, doc = getDocument();
  if (!hint || hint.kind !== 'recommend' || !hint.imageId || !hint.panelId || hint.project !== doc.project || hint.pageId !== sessionStore.getState().activePageId) { clearAssociation(); return fail(problem('association/stale', '关联建议已失效，请重新移动素材')); }
  const result = bindImagesToPanel([hint.imageId], hint.panelId); clearAssociation(); return result.ok ? ok(undefined) : result;
}
// Never let an action from an old document, history branch or workspace persist.
documentStore.subscribe((s, previous) => { if (s.project !== previous.project || s.epoch !== previous.epoch) clearAssociation(); });
sessionStore.subscribe((s, previous) => { if (s.activePageId !== previous.activePageId) clearAssociation(); });
