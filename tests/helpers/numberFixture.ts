import type { Project } from '../../src/domain/types';
import { assignNewPanelNumbers } from '../../src/panels/numbering';
/** Raw graph fixtures still obey the current import contract. Production imports
 * must reject invalid format5; this explicit fixture builder is test-only. */
export function numberFixture(project: Project): Project {
  if (project.schemaVersion < 5) return project;
  const unnumbered = Object.values(project.layers).filter(layer => layer.type === 'panel' && layer.role === 'leaf' && layer.editorNumber === undefined).map(layer => layer.id);
  const result = assignNewPanelNumbers(project, unnumbered); if (!result.ok) throw Error(JSON.stringify(result.problems)); return project;
}
