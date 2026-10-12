import { describe, expect, it } from 'vitest';
import { buildNewProject, type NewProjectInput } from '../../src/projects/newProject';
const base: NewProjectInput = { name: '新漫画', background: 'white', page: { preset: 'A4', orientation: 'portrait', dpi: 300 } };
describe('independent project creation', () => {
  it('creates unique A4 documents with one editable bottom background and no old content', () => {
    const a = buildNewProject(base), b = buildNewProject(base); if (!a.ok || !b.ok) throw Error('creation');
    expect(a.value.id).not.toBe(b.value.id); expect(a.value.pageOrder[0]).not.toBe(b.value.pageOrder[0]);
    const p = a.value.pages[a.value.pageOrder[0]]; expect(p).toMatchObject({ name: '第1页', width: 2480, height: 3508, dpi: 300 });
    expect(a.value.layers[p.roots[0]]).toMatchObject({ type: 'pageBackground', fill: '#FFFFFFFF' });
    expect(a.value.assets).toEqual({}); expect(a.value.templates).toEqual({});
  });
  it('computes ISO B4 and landscape, preserving custom final axes and transparent alpha', () => {
    const p = buildNewProject({ ...base, page: { preset: 'B4-ISO', orientation: 'landscape', dpi: 300 } }); if (!p.ok) throw Error('paper');
    expect(p.value.pages[p.value.pageOrder[0]]).toMatchObject({ width: 4169, height: 2953 });
    const c = buildNewProject({ ...base, background: 'transparent', page: { preset: 'custom', orientation: 'landscape', widthPx: 113, heightPx: 79, dpi: 72 } }); if (!c.ok) throw Error('custom');
    expect(c.value.pages[c.value.pageOrder[0]]).toMatchObject({ width: 113, height: 79 }); expect(Object.values(c.value.layers)[0]).toMatchObject({ fill: '#FFFFFF00' });
  });
  it('accepts exact numeric/name limits and rejects missing, fractional or nonfinite input', () => {
    for (const n of [16, 16384]) for (const dpi of [72, 600]) expect(buildNewProject({ ...base, page: { preset: 'custom', orientation: 'portrait', dpi, widthPx: n, heightPx: n } }).ok).toBe(true);
    for (const n of [undefined, 15, 16385, NaN, Infinity, 20.5]) expect(buildNewProject({ ...base, page: { preset: 'custom', orientation: 'portrait', dpi: 300, widthPx: n, heightPx: 200 } }).ok).toBe(false);
    for (const dpi of [71, 601, NaN, Infinity, 72.5]) expect(buildNewProject({ ...base, page: { ...base.page, dpi } }).ok).toBe(false);
    expect(buildNewProject({ ...base, name: '😀'.repeat(80) }).ok).toBe(true); expect(buildNewProject({ ...base, name: '😀'.repeat(81) }).ok).toBe(false);
    for (const name of ['', '   ', '\n']) expect(buildNewProject({ ...base, name }).ok).toBe(false);
  });
});
