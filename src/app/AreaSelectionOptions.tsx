import {useStore} from 'zustand';
import {sessionStore} from '../state/sessionStore';
import {isAreaTool,type AreaSelectionOptions as Options} from '../interaction/regionSelection';
import {runtimeStore} from '../state/runtimeStore';
export function AreaSelectionOptions({moveBinding,labelPrefix=''}:{moveBinding:string;labelPrefix?:string}){
  const mode=useStore(sessionStore,s=>s.toolMode),options=useStore(sessionStore,s=>s.areaSelectionOptions),active=useStore(runtimeStore,s=>s.gestureActive);
  if(!isAreaTool(mode))return null;
  const change=<K extends keyof Options>(key:K,value:Options[K])=>sessionStore.setState({areaSelectionOptions:{...sessionStore.getState().areaSelectionOptions,[key]:value}});
  return <div className="area-selection-options" role="group" aria-label="区域选择选项">
    <label>选区<select aria-label={`${labelPrefix}选区组合`} disabled={active} value={options.combination} onChange={e=>change('combination',e.target.value as Options['combination'])}><option value="replace">新选区</option><option value="add">追加</option><option value="subtract">减选</option><option value="intersect">交集</option></select></label>
    <label>命中<select aria-label={`${labelPrefix}选区命中方式`} disabled={active} value={options.match} onChange={e=>change('match',e.target.value as Options['match'])}><option value="intersects">相交</option><option value="contains">完整包围</option></select></label>
    <label>范围<select aria-label={`${labelPrefix}选区对象范围`} disabled={active} value={options.target} onChange={e=>change('target',e.target.value as Options['target'])}><option value="scope">当前层级</option><option value="images">仅素材</option></select></label>
    <span>选择对象显示外接框 · Shift追加 / Alt减选 / Shift+Alt交集 · {moveBinding?`${moveBinding} 切回移动`:'点击箭头切回移动'}</span>
  </div>;
}
