import type { CreateKind } from '../app/actions';
import type { Project } from '../domain/types';
import { LAYOUT_PRESETS, PANEL_PRESETS } from '../panels/presets';

export interface ComponentItem { kind: CreateKind; label: string; tool?: 'speed-brush'|'bubble-brush' }
export interface ComponentCategory { id: string; label: string; items: ComponentItem[] }

/** Library organization is UI metadata; it never changes document ownership or history. */
export function componentCategories(templates: Project['templates']): ComponentCategory[] {
  const categories: ComponentCategory[] = [
    { id: 'panel-shapes', label: '分镜形状', items: PANEL_PRESETS.map(([kind, label]) => ({ kind, label })) },
    { id: 'panel-layouts', label: '分格版式', items: LAYOUT_PRESETS.map(([kind, label]) => ({ kind: `layout:${kind}`, label })) },
    { id: 'bubbles', label: '气泡', items: [
      { kind: 'bubble', label: '对白气泡' }, { kind: 'bubble-rect', label: '方框气泡' },
      { kind: 'bubble-circle', label: '圆形气泡' }, { kind: 'bubble-cloud', label: '云朵气泡' },
      { kind: 'bubble-spiky', label: '尖刺气泡' },
      { kind: 'bubble-soft', label: '柔和手绘气泡' }, { kind: 'bubble-rough', label: '粗糙速写气泡' },
      { kind: 'bubble-hand-polygon', label: '不规则多边形气泡' }, { kind: 'bubble-wave', label: '波浪紧张气泡' },
    ] },
    {id:'bubble-tails',label:'气泡尾',items:([['triangle','短直尾'],['line','细线尾'],['curved','弯曲长尾'],['thought','多泡内心尾'],['jagged','锯齿喊叫尾'],['flat','平头低语尾']] as const).map(([kind,label])=>({kind:`tail:${kind}`,label}))},
    { id: 'text-decoration', label: '文字与装饰', items: [
      { kind: 'text', label: '文字' }, { kind: 'sfx', label: '音效字' },
      {kind:'sfx:impact',label:'重击声效字'}, {kind:'sfx:crack',label:'裂响声效字'},
      {kind:'sfx:silence',label:'静默声效字'}, {kind:'sfx:shout',label:'弧形呼喊声效字'},
      { kind: 'speed', tool: 'speed-brush', label: '速度线笔刷' }, { kind: 'focus', label: '集中线' },
    ] },
  ];
  const custom = Object.values(templates).map((template): ComponentItem => ({ kind: `template:${template.id}`, label: `自定义 · ${template.name}`, ...('recipe'in template&&(template.recipe.kind==='speed-brush'||template.recipe.kind==='bubble-brush')?{tool:template.recipe.kind}:{}) }));
  categories.push({ id: 'custom', label: '自定义组件', items: custom });
  return categories;
}
