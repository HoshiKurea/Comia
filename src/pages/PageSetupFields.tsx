import type { Page } from '../domain/types';
import { fail, ok, problem, type Result } from '../domain/types';
import { mmToPx } from '../domain/factories';
import { resolvePageSize } from './commands';
import { DEFAULT_COMIC_DPI, defaultManuscript, manuscriptSegments, parseManuscript, type ManuscriptSettings } from './manuscript';
import './manuscript.css';

import { PAPER_SIZES, CANVAS_PRESETS, canvasPresetLabel, isB5Manuscript, pageDimensionsMm, trimSizePreset, type SizePreset, type CanvasPreset } from './paperSizes';
export interface PageSetupDraft {
  preset: CanvasPreset; orientation: 'portrait' | 'landscape'; unit: 'mm' | 'px'; width: string; height: string; dpi: string;
  manuscript: boolean; trimPreset: SizePreset; trimWidth: string; trimHeight: string; bleed: string;
  basicWidth: string; basicHeight: string; offsetX: string; offsetY: string; safe: boolean; safeInset: string; cropMarks: boolean;
}
export function createPageSetupDraft(page?: Page): PageSetupDraft {
  const m = page?.manuscript ?? defaultManuscript(), dpi = page?.dpi ?? DEFAULT_COMIC_DPI;
  const mm = page ? pageDimensionsMm(page) : { width: 210, height: 297 };
  return { preset: !page || isB5Manuscript(page) ? 'comic-B5' : 'custom', orientation: page && page.width > page.height ? 'landscape' : 'portrait', unit: 'mm', width: String(mm.width), height: String(mm.height), dpi: String(dpi),
    manuscript: page ? !!page.manuscript : true, trimPreset: trimSizePreset(m.trim.widthMm, m.trim.heightMm), trimWidth: String(m.trim.widthMm), trimHeight: String(m.trim.heightMm), bleed: String(m.bleedMm),
    basicWidth: String(m.basicFrame.widthMm), basicHeight: String(m.basicFrame.heightMm), offsetX: String(m.basicFrame.offsetXMm), offsetY: String(m.basicFrame.offsetYMm),
    safe: m.safeInsetMm !== null, safeInset: String(m.safeInsetMm ?? 5), cropMarks: m.cropMarks };
}
const number = (value: string): number => value.trim() ? Number(value) : NaN;
export function resolvePageSetup(draft: PageSetupDraft): Result<{ width: number; height: number; dpi: number; manuscript?: ManuscriptSettings }> {
  const dpi = number(draft.dpi), paper = draft.preset === 'custom' ? null : CANVAS_PRESETS[draft.preset];
  let width = paper ? mmToPx(paper[0], dpi) : draft.unit === 'mm' ? mmToPx(number(draft.width), dpi) : number(draft.width);
  let height = paper ? mmToPx(paper[1], dpi) : draft.unit === 'mm' ? mmToPx(number(draft.height), dpi) : number(draft.height);
  if (paper && draft.orientation === 'landscape') [width, height] = [height, width];
  if (draft.preset === 'custom' && draft.unit === 'mm' && (!Number.isFinite(number(draft.width)) || !Number.isFinite(number(draft.height)) || number(draft.width) <= 0 || number(draft.height) <= 0)) return fail(problem('page/mm', '画布宽高必须是正数'));
  const size = resolvePageSize({ preset: 'custom', orientation: 'portrait', widthPx: width, heightPx: height, dpi }); if (!size.ok) return size;
  if (!draft.manuscript) return size;
  const settings = parseManuscript({ trim: { widthMm: number(draft.trimWidth), heightMm: number(draft.trimHeight) }, bleedMm: number(draft.bleed),
    basicFrame: { widthMm: number(draft.basicWidth), heightMm: number(draft.basicHeight), offsetXMm: number(draft.offsetX), offsetYMm: number(draft.offsetY) },
    safeInsetMm: draft.safe ? number(draft.safeInset) : null, cropMarks: draft.cropMarks }, size.value);
  return settings.ok ? ok({ ...size.value, manuscript: settings.value }) : settings;
}
export function PageSetupPreview({ page, notice }: { page: Pick<Page, 'width' | 'height' | 'dpi' | 'manuscript'> | null; notice?: string }) {
  return <div className="manuscript-preview"><span>原稿预览</span>{page ? <svg role="img" aria-label="漫画原稿定位线预览" viewBox={`0 0 ${page.width} ${page.height}`}>
    <rect width={page.width} height={page.height} fill="#fff" />
    {manuscriptSegments(page as Page).map((s, i) => <line key={i} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} vectorEffect="non-scaling-stroke" stroke={s.kind === 'basic' ? '#9691cc' : '#8a81e5'} strokeWidth=".8" strokeDasharray={s.kind === 'safe' ? '4 3' : undefined} />)}
  </svg> : <div className="manuscript-preview-empty">请先修正参数</div>}
    {page && <small>{page.width} × {page.height} px · {page.dpi} DPI</small>}
    <p>紫色定位线仅辅助排版，不能选中，不进入图层或 PNG / PDF。</p>
    {notice && <p className="manuscript-budget">{notice}</p>}
  </div>;
}
export function PageSetupFields({ draft, change, prefix }: { draft: PageSetupDraft; change: (next: PageSetupDraft) => void; prefix: string }) {
  const set = <K extends keyof PageSetupDraft>(key: K, value: PageSetupDraft[K]) => change({ ...draft, [key]: value });
  const size = resolvePageSetup({ ...draft, manuscript: false });
  const axis = (value: number | undefined) => value === undefined ? '' : draft.unit === 'px' ? String(value) : String(Number((value * 25.4 / number(draft.dpi)).toFixed(4)));
  const field = (key: 'trimWidth' | 'trimHeight' | 'bleed' | 'basicWidth' | 'basicHeight' | 'offsetX' | 'offsetY' | 'safeInset', label: string) => <label>{label}<span className="manuscript-number"><input aria-label={`${prefix}${label}`} type="number" step="0.01" value={draft[key]} onChange={e => {
    const next = { ...draft, [key]: e.target.value }; if (key === 'trimWidth' || key === 'trimHeight') next.trimPreset = 'custom'; change(next);
  }} /><span>mm</span></span></label>;
  return <div className="manuscript-fields">
    <fieldset><legend>画布</legend>
      <label>漫画纸张<select aria-label={`${prefix}纸张`} value={draft.preset} onChange={e => { const preset = e.target.value as CanvasPreset; change({ ...draft, preset, width: size.ok ? axis(size.value.width) : draft.width, height: size.ok ? axis(size.value.height) : draft.height }); }}>
        {Object.entries(CANVAS_PRESETS).map(([id, mm]) => <option key={id} value={id}>{canvasPresetLabel(id as CanvasPreset)} · {mm[0]}×{mm[1]} mm</option>)}<option value="custom">自定义</option>
      </select></label>
      <div className="manuscript-pair"><label>单位<select aria-label={`${prefix}单位`} value={draft.unit} onChange={e => { const unit = e.target.value as PageSetupDraft['unit']; const convert = (s: string) => String(Number((unit === 'mm' ? number(s) * 25.4 / number(draft.dpi) : mmToPx(number(s), number(draft.dpi))).toFixed(6))); change({ ...draft, unit, width: convert(draft.width), height: convert(draft.height) }); }}><option value="mm">mm</option><option value="px">px</option></select></label>
      <label>方向<select aria-label={`${prefix}方向`} value={draft.orientation} onChange={e => { const orientation = e.target.value as PageSetupDraft['orientation']; change({ ...draft, orientation,
        ...(draft.orientation !== orientation ? { ...((orientation === 'landscape' && number(draft.width) < number(draft.height)) || (orientation === 'portrait' && number(draft.width) > number(draft.height)) ? { width: draft.height, height: draft.width } : {}), trimWidth: draft.trimHeight, trimHeight: draft.trimWidth, basicWidth: draft.basicHeight, basicHeight: draft.basicWidth, offsetX: draft.offsetY, offsetY: draft.offsetX } : {}) }); }}><option value="portrait">纵向</option><option value="landscape">横向</option></select></label></div>
      <div className="manuscript-pair">{(['width', 'height'] as const).map((key, i) => <label key={key}>{i ? '原稿高度' : '原稿宽度'}<span className="manuscript-number"><input aria-label={`${prefix}${i ? '高度' : '宽度'}`} type="number" step={draft.unit === 'mm' ? '.01' : '1'} readOnly={draft.preset !== 'custom'} value={draft.preset === 'custom' ? draft[key] : draft.unit === 'mm' ? CANVAS_PRESETS[draft.preset][draft.orientation === 'landscape' ? 1 - i : i] : axis(size.ok ? size.value[key] : undefined)} onChange={e => set(key, e.target.value)} /><span>{draft.unit}</span></span></label>)}</div>
      <label>分辨率<span className="manuscript-number"><input aria-label={`${prefix} DPI`} type="number" min="72" max="600" step="1" value={draft.dpi} onChange={e => set('dpi', e.target.value)} /><span>DPI</span></span></label>
      <small>色彩模式：彩色 RGBA。尺寸按 mm × DPI ÷ 25.4 四舍五入为像素。</small>
    </fieldset>
    <fieldset><legend><label className="manuscript-check"><input type="checkbox" aria-label={`${prefix}漫画原稿设置`} checked={draft.manuscript} onChange={e => set('manuscript', e.target.checked)} />漫画原稿设置</label></legend>
      <div className={!draft.manuscript ? 'manuscript-disabled' : undefined}><fieldset disabled={!draft.manuscript} className="manuscript-inner">
      <details><summary>定位框范围（高级）</summary><label>定位框预设<select aria-label={`${prefix}定位框预设`} value={draft.trimPreset} onChange={e => { const trimPreset = e.target.value as SizePreset, mm = trimPreset === 'custom' ? null : PAPER_SIZES[trimPreset]; change({ ...draft, trimPreset, ...(mm ? { trimWidth: String(mm[draft.orientation === 'landscape' ? 1 : 0]), trimHeight: String(mm[draft.orientation === 'landscape' ? 0 : 1]) } : {}) }); }}>{Object.keys(PAPER_SIZES).map(id => <option key={id} value={id}>{id.replace('-JIS','（JIS）').replace('-ISO','（ISO）')}</option>)}<option value="custom">自定义</option></select></label>
      <div className="manuscript-pair">{field('trimWidth', '定位框宽度')}{field('trimHeight', '定位框高度')}</div></details>{field('bleed', '出血宽度')}
      <h4>基本框（内框）</h4><div className="manuscript-pair">{field('basicWidth', '基本框宽度')}{field('basicHeight', '基本框高度')}</div>
      <div className="manuscript-pair">{field('offsetX', '横向偏移')}{field('offsetY', '纵向偏移')}</div>
      <small>正偏移向右／向下，基本框须保持在定位框内。</small>
      <label className="manuscript-check"><input type="checkbox" checked={draft.safe} onChange={e => set('safe', e.target.checked)} />安全线</label>{draft.safe && field('safeInset', '安全边距')}
      <label className="manuscript-check"><input type="checkbox" checked={draft.cropMarks} onChange={e => set('cropMarks', e.target.checked)} />裁切标记与中心定位标记</label>
      </fieldset></div>
    </fieldset>
  </div>;
}
