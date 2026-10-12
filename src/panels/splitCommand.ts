import type { Id, PanelTemplateNode, Result } from '../domain/types';
import { fail, problem } from '../domain/types';
import { getProject } from '../state/documentStore';
import { applyIndependentLayout } from './independentLayout';

/** All replacement entry points persist independent leaf panels in one transaction. */
export function replaceLeafWithLayout(id: Id, tree: PanelTemplateNode): Result<Id[]> {
  const panel = getProject().layers[id];
  if (panel?.type !== 'panel' || panel.role !== 'leaf' || !tree.children.length) return fail(problem('panel/layout-target', '只能替换叶子分镜'));
  return applyIndependentLayout(panel.pageId, tree, id);
}
