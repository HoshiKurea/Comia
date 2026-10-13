import { createPage, createPageBackground, createProject } from '../domain/factories';
import { validateProject } from '../domain/validate';
import { fail, ok, problem, type Project, type Result } from '../domain/types';
import { resolvePageSize, type PageSizeInput } from '../pages/commands';
import { parseManuscript, type ManuscriptSettings } from '../pages/manuscript';

export interface NewProjectInput {
  name: string;
  page: Omit<PageSizeInput, 'snap16'>;
  background: 'white' | 'transparent';
  paperColor?: import('../domain/types').RGBA;
  manuscript?: ManuscriptSettings;
  pageCount?: number;
  readingDirection?: 'rtl' | 'ltr';
}
export function buildNewProject(input: NewProjectInput): Result<Project> {
  const name = input.name.trim();
  if (!name || [...name].length > 80) return fail(problem('project/name', '项目名称须为 1～80 码点且不能为空'));
  if (!['white', 'transparent'].includes(input.background)) return fail(problem('project/background', '请选择白色或透明背景'));
  // Custom axes already describe the final dimensions; never swap them again at submission.
  const size = resolvePageSize({ ...input.page, orientation: input.page.preset === 'custom' ? 'portrait' : input.page.orientation, snap16: false });
  if (!size.ok) return size;
  const count = input.pageCount ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 100) return fail(problem('project/pages', '页数必须是1～100的整数'));
  const guides = input.manuscript === undefined ? null : parseManuscript(input.manuscript, size.value);
  if (guides && !guides.ok) return guides;
  const readingDirection = input.readingDirection ?? 'rtl';
  if (!['rtl', 'ltr'].includes(readingDirection)) return fail(problem('project/direction', '阅读方向无效'));
  const project = createProject(), page = project.pages[project.pageOrder[0]];
  project.name = name; Object.assign(page, size.value); project.settings.defaultDpi = size.value.dpi;
  project.settings.readingDirection = readingDirection;
  if (guides?.ok) page.manuscript = guides.value;
  const background = project.layers[page.roots[0]];
  if (background.type === 'pageBackground') background.fill = input.background === 'white' ? input.paperColor ?? '#FFFFFFFF' : '#FFFFFF00';
  for (let n = 2; n <= count; n++) {
    const next = createPage({ name: `第${n}页`, ...size.value });
    if (guides?.ok) next.manuscript = structuredClone(guides.value);
    const paper = createPageBackground(next.id, background.type === 'pageBackground' ? background.fill : '#FFFFFFFF');
    next.roots.push(paper.id); project.pages[next.id] = next; project.layers[paper.id] = paper; project.pageOrder.push(next.id);
  }
  const valid = validateProject(project); return valid.ok ? ok(project) : valid;
}
