import {StrokeBandFields} from './StrokeBandFields';
import { useStore } from 'zustand';
import type { DialogueSpec, GroupLayer } from '../domain/types';
import { sessionStore } from '../state/sessionStore';
import { mangaEditStore, beginMangaEdit, queueMangaPatch } from './mangaEditController';
import { updateDialogueStyle, dissolveDialogue } from './dialogueCommands';
import { MangaNumber, reportManga } from './MangaFields';
import { getProject } from '../state/documentStore';
import { mainBubbleText, bubbleTails } from './ownership';
import { RangeNumberValue } from '../ui/RangeNumberField';

export function DialogueInspector({group}:{group:GroupLayer}){
  const active=useStore(mangaEditStore,s=>s.active?.id===group.id?s.active:null),preview=active?.preview??getProject(),g=preview.layers[group.id];if(g?.type!=='group'||!g.dialogue)return null;
  const spec=g.dialogue,update=(patch:Partial<DialogueSpec>)=>{const begin=beginMangaEdit(g.id,'dialogue');if(begin.ok)reportManga(updateDialogueStyle(g.id,patch));else reportManga(begin);};
  return <section className="manga-inspector" aria-label="连续对白属性"><h4>连续对白</h4>
    <label className="field"><span>组合方式</span><select aria-label="对白组合方式" value={spec.mode} onChange={e=>update({mode:e.target.value as DialogueSpec['mode']})}><option value="connector">细线连接</option><option value="fused">轮廓融合</option><option value="overlap">交区叠加</option></select></label>
    <p className="hint">{spec.mode==='fused'?'融合使用统一样式；原主体样式保留，解散或切换后恢复。':spec.mode==='overlap'?'只调节交区填充；各边框和对白保持原样。':'各主体保留原样式，连接线使用以下边色和边宽。'}</p>
    {spec.mode==='overlap'&&<label className="manga-slider"><span>交区透明乘数<RangeNumberValue label="交区透明乘数" value={spec.overlapOpacity*100} min={0} max={100} unit="%" apply={n=>update({overlapOpacity:n/100})}/></span><input aria-label="交区透明乘数" type="range" min="0" max="1" step=".01" value={spec.overlapOpacity} onChange={e=>{const value=Number(e.target.value);reportManga(beginMangaEdit(g.id,'dialogue'));queueMangaPatch('overlap',()=>reportManga(updateDialogueStyle(g.id,{overlapOpacity:value})));}}/></label>}
    {spec.mode==='fused'&&<><MangaNumber label="融合接缝半径" min={0} max={24} value={spec.seamRadius} apply={n=>update({seamRadius:n})}/><MangaNumber label="融合笔压" min={0} max={.65} step={.01} value={spec.fusionPressure} apply={n=>update({fusionPressure:n})}/><label className="field">统一填充RGBA<input aria-label="统一填充RGBA" defaultValue={spec.fusionStyle.fill} key={`${g.id}-${spec.fusionStyle.fill}`} onBlur={e=>update({fusionStyle:{...spec.fusionStyle,fill:e.target.value.toUpperCase()}})}/></label></>}
    {spec.mode!=='overlap'&&<><label className="field">{spec.mode==='fused'?'统一边色RGBA':'连接线色RGBA'}<input aria-label="对白边色RGBA" defaultValue={spec.fusionStyle.borderColor} key={`${g.id}-${spec.fusionStyle.borderColor}`} onBlur={e=>update({fusionStyle:{...spec.fusionStyle,borderColor:e.target.value.toUpperCase()}})}/></label><MangaNumber label="对白边宽" min={0} max={256} value={spec.fusionStyle.borderWidth} apply={n=>update({fusionStyle:{...spec.fusionStyle,borderWidth:n}})}/></>}
    {spec.mode==='fused'&&<StrokeBandFields prefix="融合气泡" style={spec.fusionStyle} update={patch=>update({fusionStyle:{...spec.fusionStyle,...patch}})}/>}
    {spec.links.map((link,i)=><div key={`${link.from}-${link.to}`}><p className="hint">连接 {i+1}：{preview.layers[link.from].name} → {preview.layers[link.to].name}</p><MangaNumber label={`连接${i+1}桥宽`} min={4} max={128} value={link.width} apply={n=>update({links:spec.links.map((l,j)=>j===i?{...l,width:n}:l)})}/><MangaNumber label={`连接${i+1}弯曲`} min={-1} max={1} step={.05} value={link.bend} apply={n=>update({links:spec.links.map((l,j)=>j===i?{...l,bend:n}:l)})}/></div>)}
    <div className="button-stack">{g.children.map(cid=>{const text=mainBubbleText(preview,cid);return <div key={cid}><button onClick={()=>sessionStore.setState({selection:[cid],scopeId:g.id})}>{preview.layers[cid].name}</button>{text&&<button onClick={()=>sessionStore.setState({selection:[text.id],scopeId:g.id})}>选此对白</button>}{bubbleTails(preview,cid).map(t=><button key={t.id} onClick={()=>sessionStore.setState({selection:[t.id],scopeId:g.id})}>{t.name}</button>)}</div>;})}</div>
    {active?<p className="hint">在画布浮窗中完成或取消本次编辑。</p>:<button onClick={()=>reportManga(dissolveDialogue(g.id))}>解散连续对白</button>}
  </section>;
}
