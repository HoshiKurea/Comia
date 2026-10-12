import { useStore } from 'zustand';
import { associationStore, acceptAssociation, clearAssociation } from './associationController';
import { pushNotice } from '../state/sessionStore';
export function AssociationRecommendation() {
  const hint = useStore(associationStore, s => s.hint?.kind === 'recommend' ? s.hint : null);
  if (!hint?.panelId) return null;
  const panel = hint.project.layers[hint.panelId], label = panel.type === 'panel' ? panel.editorNumber ?? panel.name : panel.name;
  return <div className="association-recommendation" role="status"><button onClick={() => { const r = acceptAssociation(); if (!r.ok) pushNotice('error', r.problems[0].message); }}>一键关联到分镜 {label}</button><button aria-label="忽略关联建议" onClick={clearAssociation}>×</button></div>;
}
