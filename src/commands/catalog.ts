import type { CommandDescriptor,ShortcutChord } from './types';
const groups={
 file:[['new-project','新建项目'],['open-project','打开项目'],['open-directory','打开项目目录'],['save','保存项目'],['save-as','另存为'],['save-directory','保存到项目目录'],['close-project','关闭当前项目'],['png','导出 PNG'],['pdf','导出 PDF'],['scale-0.25','导出倍率 0.25×'],['scale-0.5','导出倍率 0.5×'],['scale-1','导出倍率 1×'],['scale-2','导出倍率 2×'],['scale-4','导出倍率 4×'],['preferences','首选项']],
 edit:[['drawing-window','自由绘画窗口'],['undo','撤销'],['redo','重做'],['copy','复制'],['paste','粘贴'],['duplicate','复制一份'],['delete','删除选中对象']],
 layer:[['group','编组'],['ungroup','解组'],['dialogue-connector','建立连接对白'],['dialogue-fused','建立融合对白'],['dialogue-overlap','建立叠加对白'],['dissolve-dialogue','解散连续对白'],['bind-images','关联素材到分镜'],['unbind-images','解除素材分镜关联'],['order-top','置于顶层'],['order-up','上移一层'],['order-down','下移一层'],['order-bottom','置于底层'],['save-component-preset','保存为组件预设']],
 tools:[['tool-select','移动/点选工具'],['tool-geometry','几何编辑工具'],['tool-marquee','矩形框选工具'],['tool-lasso','自由套索工具'],['tool-panel-cut','分镜切割工具'],['tool-image-crop','素材裁剪工具'],['tool-image-mask','素材遮罩工具'],['tool-bubble-brush','手绘气泡工具']],
 page:[['add-page','新建漫画页'],['rename-page','重命名当前页'],['delete-page','删除当前页'],['page-settings','页面设置']],
 view:[['fit-page','适应页面'],['panel-numbers','显示分镜序号'],['manuscript-guides','显示漫画定位线'],['snap16','16 倍数尺寸吸附'],['theme-system','跟随系统主题'],['theme-light','浅色主题'],['theme-dark','深色主题'],['show-library','显示组件库'],['show-assets','显示素材库'],['show-pages','显示项目页面']],
 window:[['panel-components','组件库面板显隐'],['panel-assets','素材库面板显隐'],['panel-pages','页面面板显隐'],['panel-inspector','属性面板显隐'],['panel-layers','图层面板显隐'],['panel-history','历史记录面板显隐'],['panel-hints','快捷键提示面板显隐'],['reset-workspace','恢复默认工作区']],
} as const;
export type CommandId=typeof groups[keyof typeof groups][number][0];
export const COMMAND_CATEGORIES:Record<keyof typeof groups,string>={file:'文件',edit:'编辑',layer:'图层',page:'页面',view:'视图',window:'窗口',tools:'工具'};
const chord=(key:string,primary=true,shift=false,alt=false):ShortcutChord=>({key,primary,shift,alt});
const defaults:Partial<Record<CommandId,ShortcutChord[]>>={'dialogue-connector':[chord('1',true,false,true)],'dialogue-fused':[chord('2',true,false,true)],'dialogue-overlap':[chord('3',true,false,true)],save:[chord('s')],'save-as':[chord('s',true,true)],undo:[chord('z')],redo:[chord('z',true,true)],copy:[chord('c')],paste:[chord('v')],duplicate:[chord('d')],group:[chord('g')],ungroup:[chord('g',true,true)],delete:[chord('Delete',false),chord('Backspace',false)],'bind-images':[chord('b',true,false,true)],'unbind-images':[chord('b',true,true,true)],'tool-panel-cut':[chord('k',false)],'tool-image-crop':[chord('c',false)],'tool-image-mask':[chord('c',false,true)],'tool-bubble-brush':[chord('b',false)],'tool-marquee':[chord('m',false)],'tool-lasso':[chord('l',false)],'tool-select':[chord('v',false)],'tool-geometry':[chord('g',false)]};
export const COMMANDS:readonly CommandDescriptor[]=Object.entries(groups).flatMap(([category,rows])=>rows.map(([id,label])=>({id,label,category,defaults:defaults[id]??[],repeat:id==='undo'||id==='redo'?'allow':'deny',inputScope:id==='save'||id==='save-as'?'save':'none'})));
export const COMMAND_BY_ID=new Map(COMMANDS.map(c=>[c.id,c]));
export function isCommandId(id:string):id is CommandId{return COMMAND_BY_ID.has(id as CommandId);}
