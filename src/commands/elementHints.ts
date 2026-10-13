import type { CreateKind } from '../app/actions';
import type { Id, Layer } from '../domain/types';
import { getProject } from '../state/documentStore';
import { sessionStore } from '../state/sessionStore';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { COMMAND_BY_ID, type CommandId } from './catalog';
import { bindingLabel } from './shortcutBinding';
import type { ShortcutOverrides } from './types';
export type HintTarget={kind:'component';componentKind:CreateKind;label:string;tool?:boolean}|{kind:'asset';projectId:Id;assetId:Id}|{kind:'canvas';projectId:Id;layerId:Id;containedImageId?:Id};
export interface ElementHint { label:string;binding:string;note?:string }
const command=(id:CommandId,o:ShortcutOverrides,note?:string):ElementHint=>({label:COMMAND_BY_ID.get(id)!.label,binding:bindingLabel(id,o)||'未设置',note});
function objectHints(o:ShortcutOverrides,note?:string):ElementHint[]{
  return [command('tool-marquee',o,note),command('tool-lasso',o,note),{label:'区域追加 / 减选 / 交集',binding:'Shift / Alt / Shift＋Alt',note:`在矩形或套索模式下拖动；${bindingLabel('tool-select',o)||'移动按钮'}移动选中对象`},{label:'多选 / 取消选中一个对象',binding:'Shift＋单击',note},command('copy',o,note),command('duplicate',o,note),command('delete',o,note),command('group',o,'选中多个同级组件后'),...(['order-top','order-up','order-down','order-bottom']as const).map(id=>command(id,o,note)),{label:'移动',binding:'拖动 / 方向键',note},{label:'加速微移',binding:'Shift＋方向键',note},{label:'自由拖动，禁用吸附',binding:'Alt＋拖动',note},{label:'旋转 / 缩放',binding:'拖动控制柄',note},{label:'取消当前编辑',binding:'Esc'}];
}
function typeHints(type:Layer['type'],o:ShortcutOverrides,note?:string,dialogue=false):ElementHint[]{
  if(type==='panel')return [command('tool-panel-cut',o,note),command('tool-geometry',o,note),command('tool-select',o),{label:'直接编辑一个顶点',binding:'Ctrl＋拖动顶点',note},{label:'节点横纵/邻点吸附',binding:'直接拖动节点',note},{label:'节点临时自由移动',binding:'Alt＋拖动节点',note},{label:'精调当前节点',binding:'Ctrl＋方向键',note},{label:'节点加速微调',binding:'Ctrl＋Shift＋方向键',note},{label:'切换节点',binding:'Alt＋← / →',note},{label:'选中框内素材',binding:'Alt＋单击',note},{label:'素材多选',binding:'Alt＋Shift＋单击',note}];
  if(type==='image')return [command('tool-image-crop',o,note),command('tool-image-mask',o,note),command('bind-images',o,note),command('unbind-images',o,note),{label:'拖动后关联到分镜',binding:'Ctrl＋松开',note}];
  if(type==='group')return [command('ungroup',o,note),...(dialogue?[command('dissolve-dialogue',o,note)]:[])];
  if(type==='bubble')return [command('tool-flash-bubble',o,note),command('tool-bubble-brush',o,note),{label:'编辑对白',binding:'双击主体',note},{label:'完成文字',binding:'Ctrl＋Enter',note},...(['dialogue-connector','dialogue-fused','dialogue-overlap']as const).map(id=>command(id,o,'选中2～16个同级气泡后'))];
  if(type==='text')return [{label:'编辑文字',binding:'双击',note},{label:'完成文字',binding:'Ctrl＋Enter',note}];
  return [];
}
function componentTypes(kind:CreateKind):{type:Layer['type'];dialogue?:boolean}[]{
  if(kind.startsWith('template:')){const t=getProject().templates[kind.slice(9)];if(t&&'recipe'in t&&t.recipe.kind==='scene'){const r=t.recipe;return r.roots.map(id=>r.nodes[id]).filter(Boolean).map(l=>({type:l.type,dialogue:l.type==='group'&&!!l.dialogue}));}return [];}
  if(kind.startsWith('bubble'))return [{type:'bubble'}];
  if(kind.startsWith('tail:'))return [{type:'bubbleTail'}];
  if(kind==='text'||kind==='sfx'||kind.startsWith('sfx:'))return [{type:'text'}];
  if(kind==='speed'||kind==='focus')return [{type:'decoration'}];
  return [{type:'panel'}];
}
export function getElementHints(target:HintTarget,o:ShortcutOverrides):ElementHint[]{
  if(target.kind==='component'||target.kind==='asset'){
    if(target.kind==='component'&&target.tool)return [{label:'启用笔刷',binding:'单击 / Enter / Space'},{label:'绘制一笔',binding:'画布按住拖动 → 松开'},{label:'取消当前笔画',binding:'Esc'}];
    const note='放置并选中后',types=target.kind==='asset'?[{type:'image' as const}]:componentTypes(target.componentKind);
    const related=types.flatMap(t=>typeHints(t.type,o,note,'dialogue'in t&&t.dialogue));
    return [{label:'居中放置并选中',binding:'单击 / Enter / Space'},{label:'拖动放置',binding:'按住拖动 → 松开'},{label:'自由放置，不自动关联',binding:'Alt＋拖放'},{label:'取消拖动',binding:'Esc'},...objectHints(o,note),...(target.kind==='component'?[command('save-component-preset',o,note)]:[]),...related.filter((row,i)=>related.findIndex(other=>other.label===row.label)===i)];
  }
  const p=getProject(),l=p.layers[target.layerId];if(p.id!==target.projectId||!l)return [];
  const note=sessionStore.getState().selection.includes(l.id)?undefined:'先选中此对象',locked=effectiveLayerFlags(p,l.id).locked;
  const rows=objectHints(o,locked?'请先解锁':note);
  if(l.type!=='image'&&l.type!=='pageBackground')rows.push(command('save-component-preset',o,note));
  if(l.type==='decoration'&&l.spec.kind==='paint')rows.push(command('tool-paint-pen',o,note),command('tool-paint-eraser',o,note));
  rows.push(...typeHints(l.type,o,note,l.type==='group'&&!!l.dialogue));
  return rows;
}
