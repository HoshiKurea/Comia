import {useState} from 'react';
import {useStore} from 'zustand';
import {FocusDialog} from '../app/FocusDialog';
import {createDefaultPreferences,createPreferencesDraft,validatePreferences} from './model';
import {applyPreferences,preferencesStore} from './store';
import {ShortcutEditor,type ShortcutCapture} from './ShortcutEditor';
import type {AppPreferences} from './types';
import './preferences.css';
import {isInputComposing} from '../workspacePanels/panelInteraction';
const sections=[['general','常规'],['editing','编辑辅助'],['export','导出'],['shortcuts','快捷键']] as const;
type Section=typeof sections[number][0];
export function PreferencesDialog({onClose}:{onClose:()=>void}) {
 const applied=useStore(preferencesStore,s=>s.value),[draft,setDraft]=useState(()=>createPreferencesDraft(applied)),[section,setSection]=useState<Section>('general'),[error,setError]=useState(''),[capture,setCapture]=useState<ShortcutCapture|null>(null);
 const externalChanged=applied.generation!==draft.baseGeneration;
 const change=(value:AppPreferences)=>{const result=validatePreferences(value);if(!result.ok){setError(result.problems[0].message);return false;}setDraft(d=>({...d,value:result.value}));setError('');return true;};
 const restoreSection=()=>{const defaults=createDefaultPreferences(),next=structuredClone(draft.value);if(section==='general')next.theme=defaults.theme;else if(section==='editing'){next.snap16=defaults.snap16;next.showPanelNumbers=defaults.showPanelNumbers;}else if(section==='export')next.exportScale=defaults.exportScale;else next.shortcuts={};setCapture(null);change(next);};
 const cancel=()=>{if(isInputComposing())return;if(capture){setCapture(null);setError('');}else onClose();};
 return <FocusDialog title="首选项" onCancel={cancel} className="preferences-dialog"><header className="preferences-heading"><div><strong>首选项</strong><small>工作方式，由你定义</small></div><button aria-label="关闭首选项" onClick={onClose}>×</button></header>
  <div className="preferences-body"><nav className="preferences-nav" role="tablist" aria-label="首选项分类">{sections.map(([id,label],i)=><button key={id} role="tab" id={`preferences-tab-${id}`} aria-controls={`preferences-section-${id}`} aria-selected={section===id} tabIndex={section===id?0:-1} className={section===id?'active':''} onClick={()=>{setCapture(null);setError('');setSection(id);}} onKeyDown={e=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.key)||e.nativeEvent.isComposing)return;e.preventDefault();e.stopPropagation();const index=e.key==='Home'?0:e.key==='End'?3:(i+(['ArrowUp','ArrowLeft'].includes(e.key)?-1:1)+4)%4;document.getElementById(`preferences-tab-${sections[index][0]}`)?.focus();}}>{label}</button>)}</nav>
   <div className="preferences-content" role="tabpanel" id={`preferences-section-${section}`} aria-labelledby={`preferences-tab-${section}`}>
    {section==='general'&&<><h2>界面</h2><p className="preferences-help">选择你习惯的工作区明暗。</p><label className="preference-setting"><span>界面主题</span><select aria-label="首选项界面主题" value={draft.value.theme} onChange={e=>change({...draft.value,theme:e.target.value as AppPreferences['theme']})}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label></>}
    {section==='editing'&&<><h2>编辑辅助</h2><label className="preference-toggle"><input type="checkbox" checked={draft.value.snap16} onChange={e=>change({...draft.value,snap16:e.target.checked})} />16 倍数尺寸吸附</label><p className="preferences-help">尺寸调整吸附到16的倍数。</p><label className="preference-toggle"><input type="checkbox" checked={draft.value.showPanelNumbers} onChange={e=>change({...draft.value,showPanelNumbers:e.target.checked})} />显示分镜序号</label><p className="preferences-help">编辑辅助标记，不参与导出。</p></>}
    {section==='export'&&<><h2>导出</h2><label className="preference-setting"><span>默认导出倍率</span><select aria-label="首选项默认导出倍率" value={draft.value.exportScale} onChange={e=>change({...draft.value,exportScale:Number(e.target.value) as AppPreferences['exportScale']})}>{[.25,.5,1,2,4].map(n=><option key={n} value={n}>{n}×</option>)}</select></label><p className="preferences-help">PNG与PDF共用此倍率；超出当前导出预算时仍会明确提示。</p></>}
    {section==='shortcuts'&&<ShortcutEditor value={draft.value} change={change} capture={capture} setCapture={setCapture} error={error} clearError={()=>setError('')} />}
   </div></div>
  <div className="preferences-status" role="alert">{externalChanged?'设置已在另一窗口更新，请重新载入。':error}{externalChanged&&<button onClick={()=>{setDraft(createPreferencesDraft(applied));setCapture(null);setError('');}}>重新载入</button>}</div>
  <footer className="preferences-footer"><div className="preferences-defaults"><button onClick={restoreSection}>恢复本类默认</button><button onClick={()=>{setCapture(null);setError('');setDraft(d=>({...d,value:{...createDefaultPreferences(),generation:d.value.generation}}));}}>恢复全部默认</button></div><small>仅保存在此浏览器，所有漫画共用</small><div><button onClick={onClose}>取消</button><button className="primary" disabled={!!capture||!!error||externalChanged} onClick={()=>{const r=applyPreferences(draft);if(r.ok)onClose();else setError(r.problems[0].message);}}>确定</button></div></footer>
 </FocusDialog>;
}
