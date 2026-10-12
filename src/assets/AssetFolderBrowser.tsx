import { useRef, useState } from 'react';
import type { AssetLibraryOrganization, Id, Result } from '../domain/types';
import { folderAncestors } from './folderModel';
import { createAssetFolder, moveAssetFolder, removeAssetFolder, renameAssetFolder } from './folderCommands';
import { FocusDialog } from '../app/FocusDialog';
import { getDocument } from '../state/documentStore';
import { pushNotice } from '../state/sessionStore';

export type FolderView = 'all' | Id | null;
const report = (r: Result<unknown>) => { if (!r.ok) pushNotice('error', r.problems[0].message); };
const expandedByProject=new Map<Id,Id[]>();
export function AssetFolderBrowser({org,folder,select,importFiles}:{org:AssetLibraryOrganization;folder:FolderView;select:(folder:FolderView)=>void;importFiles:(files:File[],folder:Id|null)=>void}) {
  const projectId=getDocument().project.id;
  const [expanded,setExpandedState]=useState<Id[]>(()=>expandedByProject.get(projectId)??[]),[dialog,setDialog]=useState<{id:Id|null;parentId:Id|null;name:string;projectId:Id;epoch:number}|null>(null),[error,setError]=useState('');
  const setExpanded=(update:(ids:Id[])=>Id[])=>setExpandedState(ids=>{const next=update(ids);expandedByProject.set(projectId,next);return next;});
  const tree=useRef<HTMLDivElement>(null);
  const rows=Object.values(org.folders).sort((a,b)=>a.name.localeCompare(b.name,'zh-Hans-CN')||a.id.localeCompare(b.id));
  const path=folder&&folder!=='all'?folderAncestors(org,folder):null;
  const begin=(id:Id|null)=>{const doc=getDocument();setError('');setDialog({id,parentId:folder==='all'?null:folder,name:id?org.folders[id].name:'新建文件夹',projectId:doc.project.id,epoch:doc.epoch});};
  const toggle=(id:Id)=>setExpanded(ids=>ids.includes(id)?ids.filter(v=>v!==id):[...ids,id]);
  const drop=(event:React.DragEvent,folderId:Id|null)=>{
    event.preventDefault();event.stopPropagation();
    if(event.dataTransfer.files.length){importFiles(Array.from(event.dataTransfer.files),folderId);return;}
    const moved=event.dataTransfer.getData('application/x-comia-folder');if(moved)report(moveAssetFolder(moved,folderId));
  };
  const render=(parentId:Id|null,depth:number):React.ReactNode=>rows.filter(f=>f.parentId===parentId).map(f=><div key={f.id}>
    <div className="asset-folder-row" style={{paddingLeft:depth*12}} data-asset-folder-target={f.id} onDragOver={e=>e.preventDefault()} onDrop={e=>drop(e,f.id)}>
      <button className="folder-disclosure" aria-label={`${expanded.includes(f.id)?'折叠':'展开'}文件夹 ${f.name}`} tabIndex={-1} onClick={()=>toggle(f.id)}>{rows.some(c=>c.parentId===f.id)?expanded.includes(f.id)?'▾':'▸':'·'}</button>
      <button role="treeitem" aria-level={depth+1} aria-selected={folder===f.id} aria-expanded={rows.some(c=>c.parentId===f.id)?expanded.includes(f.id):undefined} draggable
        onDragStart={e=>{e.dataTransfer.setData('application/x-comia-folder',f.id);e.dataTransfer.effectAllowed='move';}} onClick={()=>select(f.id)} title={f.name} onContextMenu={e=>{e.preventDefault();begin(f.id);}}>▱ <span>{f.name}</span><small>{Object.values(org.assetFolder).filter(id=>id===f.id).length}</small></button>
    </div>{expanded.includes(f.id)&&<div role="group">{render(f.id,depth+1)}</div>}
  </div>);
  return <div className="asset-folders">
    <div className="asset-folder-actions"><button onClick={()=>begin(null)}>＋ 文件夹</button>{folder&&folder!=='all'&&<><button aria-label="重命名当前文件夹" onClick={()=>begin(folder)}>重命名</button><button aria-label="删除文件夹，内容移到上级" title="素材和子文件夹移到上级，图片不会删除" onClick={()=>{const parent=org.folders[folder]?.parentId??null;const r=removeAssetFolder(folder);report(r);if(r.ok)select(parent);}}>删除</button></>}</div>
    <div ref={tree} role="tree" aria-label="素材文件夹" className="asset-folder-tree" onKeyDown={e=>{
      if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();
      const buttons=Array.from(tree.current!.querySelectorAll<HTMLButtonElement>('[role=treeitem]')),index=buttons.indexOf(e.target as HTMLButtonElement);
      if(e.key==='ArrowLeft'||e.key==='ArrowRight'){const id=(e.target as HTMLElement).closest<HTMLElement>('[data-asset-folder-target]')?.dataset.assetFolderTarget;if(id&&id!=='root'){if(e.key==='ArrowRight'&&!expanded.includes(id))toggle(id);else if(e.key==='ArrowLeft'&&expanded.includes(id))toggle(id);else if(e.key==='ArrowLeft'){const parent=org.folders[id]?.parentId;const target=buttons.find(b=>b.closest<HTMLElement>('[data-asset-folder-target]')?.dataset.assetFolderTarget===parent);target?.focus();}else buttons[index+1]?.focus();}return;}
      buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(e.key==='ArrowUp'?-1:1)))]?.focus();
    }}>
      <button role="treeitem" aria-level={1} aria-selected={folder==='all'} onClick={()=>select('all')}>▦ 全部素材 <small>{Object.keys(org.assetFolder).length}</small></button>
      <div data-asset-folder-target="root" onDragOver={e=>e.preventDefault()} onDrop={e=>drop(e,null)}><button role="treeitem" aria-level={1} aria-selected={folder===null} onClick={()=>select(null)}>▱ 未分类 <small>{Object.values(org.assetFolder).filter(id=>id===null).length}</small></button></div>
      {render(null,0)}
    </div>
    <nav className="asset-breadcrumb" aria-label="素材目录位置"><button onClick={()=>select('all')}>全部</button>{path?.ok&&path.value.map(id=><button key={id} onClick={()=>select(id)} title={org.folders[id].name}>/ {org.folders[id].name}</button>)}{folder===null&&<span>/ 未分类</span>}</nav>
    {dialog&&<FocusDialog title={dialog.id?'重命名素材文件夹':'新建素材文件夹'} onCancel={()=>setDialog(null)}><div className="dialog-heading"><strong>{dialog.id?'重命名素材文件夹':'新建素材文件夹'}</strong></div><label>名称<input aria-label="文件夹名称" value={dialog.name} onChange={e=>setDialog({...dialog,name:e.target.value})} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='Enter'){e.preventDefault();document.querySelector<HTMLButtonElement>('[data-confirm-folder]')?.click();}}}/></label>{error&&<p role="alert">{error}</p>}<div className="dialog-actions"><button onClick={()=>setDialog(null)}>取消</button><button data-confirm-folder className="primary" onClick={()=>{const doc=getDocument();if(doc.epoch!==dialog.epoch||doc.project.id!==dialog.projectId){setError('项目已变化，请重新打开');return;}const result=dialog.id?renameAssetFolder(dialog.id,dialog.name):createAssetFolder(dialog.name,dialog.parentId);if(!result.ok){setError(result.problems[0].message);return;}if(!dialog.id&&typeof result.value==='string'){setExpanded(ids=>[...ids,...(dialog.parentId?[dialog.parentId]:[])]);select(result.value);}setDialog(null);}}>确定</button></div></FocusDialog>}
  </div>;
}
