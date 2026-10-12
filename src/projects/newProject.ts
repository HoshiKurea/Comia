import { createProject } from '../domain/factories';
import { validateProject } from '../domain/validate';
import { fail, ok, problem, type Project, type Result } from '../domain/types';
import { resolvePageSize, type PageSizeInput } from '../pages/commands';

export interface NewProjectInput {
  name: string;
  page: Omit<PageSizeInput, 'snap16'>;
  background: 'white' | 'transparent';
}
export function buildNewProject(input: NewProjectInput): Result<Project> {
  const name = input.name.trim();
  if (!name || [...name].length > 80) return fail(problem('project/name', '项目名称须为 1～80 码点且不能为空'));
  if (!['white', 'transparent'].includes(input.background)) return fail(problem('project/background', '请选择白色或透明背景'));
  // Custom axes already describe the final dimensions; never swap them again at submission.
  const size = resolvePageSize({ ...input.page, orientation: input.page.preset === 'custom' ? 'portrait' : input.page.orientation, snap16: false });
  if (!size.ok) return size;
  const project = createProject(), page = project.pages[project.pageOrder[0]];
  project.name = name; Object.assign(page, size.value); project.settings.defaultDpi = size.value.dpi;
  const background = project.layers[page.roots[0]];
  if (background.type === 'pageBackground') background.fill = input.background === 'white' ? '#FFFFFFFF' : '#FFFFFF00';
  const valid = validateProject(project); return valid.ok ? ok(project) : valid;
}
