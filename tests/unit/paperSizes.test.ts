import { describe, expect, it } from 'vitest';
import { createProject } from '../../src/domain/factories';
import { pageDimensionsMm, trimSizePreset, paperPresetLabel } from '../../src/pages/paperSizes';
import { createPageSetupDraft, resolvePageSetup } from '../../src/pages/PageSetupFields';

describe('paper units and finished B5 recognition', () => {
  it('reopens the default comic as mm and B5 finished paper, without changing rounded pixels', () => {
    const p = createProject({ comic: true }), page = p.pages[p.pageOrder[0]], before = structuredClone(page), draft = createPageSetupDraft(page);
    expect(createPageSetupDraft()).toMatchObject({ preset: 'comic-B5', unit: 'mm', trimPreset: 'B5-JIS', width: '210', height: '297' });
    expect(draft).toMatchObject({ unit: 'mm', width: '210', height: '297', trimPreset: 'B5-JIS', trimWidth: '182', trimHeight: '257', dpi: '600' });
    expect(resolvePageSetup(draft)).toMatchObject({ ok: true, value: { width: 4961, height: 7016, manuscript: page.manuscript } }); expect(page).toEqual(before);
  });
  it('recognizes portrait and landscape standard canvases at 300 and 600dpi without fractional mm drift', () => {
    expect(pageDimensionsMm({ width: 2480, height: 3508, dpi: 300 })).toEqual({ width: 210, height: 297 });
    expect(pageDimensionsMm({ width: 7016, height: 4961, dpi: 600 })).toEqual({ width: 297, height: 210 });
    expect(pageDimensionsMm({ width: 4299, height: 6071, dpi: 600 })).toEqual({ width: 182, height: 257 });
    const p = createProject({ comic: true }), page = p.pages[p.pageOrder[0]]; [page.width, page.height] = [page.height, page.width];
    const m = page.manuscript!; [m.trim.widthMm, m.trim.heightMm] = [m.trim.heightMm, m.trim.widthMm]; [m.basicFrame.widthMm, m.basicFrame.heightMm] = [m.basicFrame.heightMm, m.basicFrame.widthMm];
    const draft = createPageSetupDraft(page); expect(draft).toMatchObject({ orientation: 'landscape', width: '297', height: '210', trimPreset: 'B5-JIS' }); expect(resolvePageSetup(draft)).toMatchObject({ ok: true, value: { width: 7016, height: 4961 } });
  });
  it('keeps JIS and ISO B5 distinct, preserves custom trim sizes and recognizes landscape', () => {
    expect(trimSizePreset(182, 257)).toBe('B5-JIS'); expect(trimSizePreset(257, 182)).toBe('B5-JIS');
    expect(trimSizePreset(176, 250)).toBe('B5-ISO'); expect(trimSizePreset(180, 260)).toBe('custom');
    expect(paperPresetLabel(trimSizePreset(182, 257))).toBe('B5（JIS）');
  });
  it('round-trips custom pixel sizes through displayed millimetres without changing integer canvas boundaries', () => {
    for (const dpi of [72, 300, 600]) for (const width of [16, 113, 8123, 16384]) {
      const mm = pageDimensionsMm({ width, height: 79, dpi }); expect(Math.round(mm.width * dpi / 25.4)).toBe(width); expect(Math.round(mm.height * dpi / 25.4)).toBe(79);
    }
  });
});
