import {ToolIcon} from '../app/ToolIcon';
import { useRef,useEffect } from 'react';
import type { Id,Project,Result } from '../domain/types';
import type { CreateKind } from '../app/actions';
import { pushNotice } from '../state/sessionStore';
import { activateSpeedBrush } from '../library/speedBrushController';
import { SpeedBrushIcon } from '../library/SpeedBrushSurface';
import { LibraryCategory } from '../library/LibraryCategory';
import { LibraryTile } from '../library/LibraryTile';
import { LibraryThumbnail } from '../library/LibraryThumbnail';
import { componentCategories } from '../library/componentCatalog';
import { beginCreation,cancelCreation,dropCreation,updateCreation } from '../library/creationController';
import { placeComponentAtPageCenter } from '../library/placement';
import { deleteUserTemplate } from '../library/templates';
import { PanelTools } from '../panels/LayoutDialog';
import { activateBrushPreset, openPresetDialog } from '../library/PresetDialog';
function notice(r:Result<unknown>){if(!r.ok)pushNotice('error',r.problems[0].message);}
export function ComponentLibraryPanel({project,pageId,toolMode,onDeployed}:{project:Project;pageId:Id;toolMode:string;onDeployed:()=>void}) {
const libraryCategories=componentCategories(project.templates),libraryDrag=useRef<{kind:CreateKind;pointerId:number;startX:number;startY:number;started:boolean}|null>(null),suppressLibraryClick=useRef(false);
useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!e.isComposing && libraryDrag.current){e.preventDefault();e.stopPropagation();suppressLibraryClick.current=true;cancelCreation();libraryDrag.current=null;}};window.addEventListener('keydown',key,true);return()=>{window.removeEventListener('keydown',key,true);cancelCreation();};},[]);
return <div className="library">
          <div className="preset-actions"><button onClick={()=>notice(openPresetDialog())}>保存选区为预设…</button></div>
          {libraryCategories.map(category => <LibraryCategory key={category.id} id={category.id} name={category.label}
            footer={category.id === 'custom' ? <div className="template-management"><p className="hint">在画布创作或修改组件，选择后保存。副本可独立编辑。</p>{Object.values(project.templates).map(template => <div className="template-management-row" key={template.id}><span title={template.name}>{template.name}</span><button aria-label={`重命名预设 ${template.name}`} onClick={()=>notice(openPresetDialog({renameId:template.id}))}>改名</button><button aria-label={`用选区更新预设 ${template.name}`} onClick={()=>notice(openPresetDialog({replaceId:template.id}))}>更新</button><button aria-label={`删除预设 ${template.name}`} onClick={() => notice(deleteUserTemplate(template.id))}>删除</button></div>)}</div> : undefined}>
            {category.items.map(item => item.tool ? <LibraryTile key={item.kind} className="library-item speed-brush-tool" label={item.label} hintTarget={{kind:'component',componentKind:item.kind,label:item.label,tool:true}}
              aria-pressed={toolMode === item.tool} title="在画布按住拖动绘制，松手完成一笔" preview={<SpeedBrushIcon />}
              onPointerDown={e=>{if(e.button===0){suppressLibraryClick.current=false;libraryDrag.current={kind:item.kind,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,started:false};}}}
              onPointerMove={e=>{const d=libraryDrag.current;if(d?.pointerId===e.pointerId&&Math.hypot(e.clientX-d.startX,e.clientY-d.startY)>=4)d.started=true;}}
              onPointerUp={()=>{suppressLibraryClick.current=!!libraryDrag.current?.started;libraryDrag.current=null;}}
              onPointerCancel={()=>{suppressLibraryClick.current=true;libraryDrag.current=null;}}
              onClick={e => {if(suppressLibraryClick.current&&e.detail!==0){suppressLibraryClick.current=false;return;}const result = item.kind.startsWith('template:')?activateBrushPreset(item.kind.slice(9)):activateSpeedBrush(); notice(result); if (result.ok) onDeployed(); }}>{item.tool==='bubble-brush'?<ToolIcon kind="bubble-brush"/>:<SpeedBrushIcon />}</LibraryTile>
              : <LibraryTile key={item.kind} className="library-item" label={item.label} hintTarget={{kind:'component',componentKind:item.kind,label:item.label}} preview={<LibraryThumbnail kind={item.kind} enlarged />}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            suppressLibraryClick.current = false;
            libraryDrag.current = { kind: item.kind, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, started: false };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = libraryDrag.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            if (!drag.started && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 4) {
              const result = beginCreation(drag.kind, pageId, event.pointerId, { x: event.clientX, y: event.clientY });
              if (!result.ok) { notice(result); libraryDrag.current = null; return; }
              drag.started = true;
            }
            if (drag.started) updateCreation(event.pointerId, { x: event.clientX, y: event.clientY },event.altKey);
          }}
          onPointerUp={(event) => {
            const drag = libraryDrag.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            libraryDrag.current = null;
            const moved = drag.started || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 4;
            if (moved) {
              suppressLibraryClick.current = true;
              if (!drag.started) { const result = beginCreation(drag.kind, pageId, event.pointerId, { x: event.clientX, y: event.clientY }); if (!result.ok) { notice(result); return; } }
              updateCreation(event.pointerId, { x: event.clientX, y: event.clientY },event.altKey);
              notice(dropCreation(event.pointerId, { x: event.clientX, y: event.clientY }));
            } else if (drag.started) cancelCreation(event.pointerId);
          }}
          onPointerCancel={(event) => { suppressLibraryClick.current = true; cancelCreation(event.pointerId); libraryDrag.current = null; }}
          onLostPointerCapture={(event) => { if (libraryDrag.current?.pointerId === event.pointerId) { suppressLibraryClick.current = true; cancelCreation(event.pointerId); libraryDrag.current = null; } }}
          onClick={(event) => {
            if (suppressLibraryClick.current && event.detail !== 0) { suppressLibraryClick.current = false; return; }
            const pendingPointer = event.detail === 0 && libraryDrag.current !== null;
            if (pendingPointer) { cancelCreation(); libraryDrag.current = null; }
            suppressLibraryClick.current = pendingPointer;
            const result = placeComponentAtPageCenter(item.kind, pageId); notice(result); if (result.ok) onDeployed();
          }}><LibraryThumbnail kind={item.kind} /></LibraryTile>)}
          </LibraryCategory>)}
          <PanelTools />
        </div>;
}
