import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { AssetMeta, Id, Result } from '../domain/types';
import { AssetFolderBrowser, type FolderView } from './AssetFolderBrowser';
import { emptyAssetLibrary, folderAncestors } from './folderModel';
import { moveLibraryAssets } from './folderCommands';
import { FocusDialog } from '../app/FocusDialog';
import { requestElementHint, leaveElementHint } from '../app/ElementHintPanel';
import { documentStore } from '../state/documentStore';
import { runtimeStore } from '../state/runtimeStore';
import { pushNotice, sessionStore } from '../state/sessionStore';
import { importLibraryFiles, placeLibraryAsset, removeLibraryAsset } from './libraryCommands';
import { apply, worldMatrix } from '../geometry/matrix';
import { polyBounds } from '../geometry/polygon';
import { useAssetDrag } from './AssetDragPreview';
import './assets.css';

const pickedAssetStore = createStore<{ projectId: string | null; assetId: string | null }>(() => ({ projectId: null, assetId: null }));
const viewStore=createStore<{views:Record<Id,{folder:FolderView;search:string;display:'grid'|'list'}>}>(()=>({views:{}}));
const defaultView={folder:'all' as FolderView,search:'',display:'grid' as const};
function notice(result: Result<unknown>): void { if (!result.ok) pushNotice('error', result.problems.map(p => p.message).join('\n')); }
function AssetThumbnail({ asset }: { asset: AssetMeta }) {
  const canvas = useRef<HTMLCanvasElement>(null), images = useStore(runtimeStore, s => s.images);
  useEffect(() => { const node = canvas.current, image = images.get(asset.renderHash), ctx = node?.getContext('2d'); if (!node || !ctx) return; ctx.clearRect(0, 0, node.width, node.height); if (image) { const s = Math.min(node.width / asset.width, node.height / asset.height); ctx.drawImage(image, (node.width - asset.width * s) / 2, (node.height - asset.height * s) / 2, asset.width * s, asset.height * s); } }, [asset, images]);
  return <canvas ref={canvas} width={180} height={140} aria-hidden="true" />;
}
export function AssetLibrary() {
  const project = useStore(documentStore, s => s.project), pageId = useStore(sessionStore, s => s.activePageId), selection = useStore(sessionStore, s => s.selection);
  const [busy, setBusy] = useState(false),[moveAsset,setMoveAsset]=useState<Id|null>(null);
  const epoch=useStore(documentStore,s=>s.epoch);useEffect(()=>setMoveAsset(null),[project.id,epoch]);
  const view=useStore(viewStore,s=>s.views[project.id]??defaultView),org=project.assetLibrary??emptyAssetLibrary(project.libraryAssetIds);
  const changeView=(patch:Partial<typeof view>)=>viewStore.setState(s=>({views:{...s.views,[project.id]:{...view,...patch}}}));
  const {search}=view,folder=view.folder==='all'||view.folder===null||org.folders[view.folder]?view.folder:'all';
  const pickedState = useStore(pickedAssetStore), picked = pickedState.projectId === project.id ? pickedState.assetId : project.libraryAssetIds?.[0] ?? null;
  const setPicked = (assetId: string | null) => pickedAssetStore.setState({ projectId: project.id, assetId });
  const input = useRef<HTMLInputElement>(null), controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const ids = (project.libraryAssetIds ?? []).filter(id => (folder==='all'||org.assetFolder[id]===folder)&&project.assets[id]?.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const panel = selection.length === 1 ? project.layers[selection[0]] : null;
  const importFiles = async (files: File[],targetFolder:Id|null=folder==='all'?null:folder) => {
    if (!files.length || busy) return;
    const next = new AbortController(); controller.current = next; setBusy(true);
    try { const result = await importLibraryFiles(files, next.signal,targetFolder); notice(result); if (result.ok) setPicked(result.value[0]); }
    finally { if (controller.current === next) { controller.current = null; setBusy(false); } }
  };
  const drag = useAssetDrag(pageId, setPicked, notice);
  return <section className="asset-library" aria-label="用户素材库" onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); event.stopPropagation(); void importFiles(Array.from(event.dataTransfer.files)); }}>
    <div className="asset-heading"><strong>你的素材</strong><button disabled={busy} onClick={() => input.current?.click()}>＋ 导入图片</button></div>
    <input ref={input} hidden type="file" multiple accept="image/png,image/jpeg,image/webp,image/avif,image/gif,image/svg+xml" aria-label="导入素材文件" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void importFiles(files); }} />
    {busy && <div role="status" className="asset-import-status">正在导入原图…<button onClick={() => controller.current?.abort()}>取消导入</button></div>}
    <AssetFolderBrowser key={project.id} org={org} folder={folder} select={folder=>changeView({folder})} importFiles={(files,folder)=>void importFiles(files,folder)} />
    <div className="asset-search-tools"><input className="asset-search" type="search" aria-label="搜索素材" placeholder="搜索当前范围" value={search} onChange={event => changeView({search:event.target.value})} /><button aria-label={view.display==='grid'?'切换列表视图':'切换网格视图'} onClick={()=>changeView({display:view.display==='grid'?'list':'grid'})}>{view.display==='grid'?'☷':'▦'}</button></div>
    <p className="hint">点击居中放置；拖到画布自由拼贴。原图保存在库中，可重复使用。</p>
    {!ids.length && <p className="asset-empty">{search ? '没有匹配的素材' : '导入图片，建立你的素材库。也可将文件拖到这里。'}</p>}
    <div className={`asset-grid ${view.display==='list'?'asset-list':''}`}>{ids.map(id => { const asset = project.assets[id],path=org.assetFolder[id]?folderAncestors(org,org.assetFolder[id]!):null; return <div className={`asset-card${picked === id ? ' picked' : ''}`} key={id} onContextMenu={e=>{e.preventDefault();setMoveAsset(id);}}>
      <button className="asset-pick" aria-label={`放置素材 ${asset.name}`} title={`${asset.name} · ${asset.width} × ${asset.height}`} {...drag.bind(id)} onPointerEnter={e=>{if(e.buttons===0&&e.pointerType!=='touch'){const b=e.currentTarget.getBoundingClientRect();requestElementHint({kind:'asset',projectId:project.id,assetId:id},{x:b.right,y:b.top});}}} onPointerLeave={leaveElementHint} onFocus={e=>{if(e.currentTarget.matches(':focus-visible')){const b=e.currentTarget.getBoundingClientRect();requestElementHint({kind:'asset',projectId:project.id,assetId:id},{x:b.right,y:b.top});}}} onBlur={leaveElementHint} aria-controls="panel-content-hints"><AssetThumbnail asset={asset} /><span>{asset.name}</span></button>
      <button className="asset-remove" aria-label={`移出素材库 ${asset.name}`} title="移出库，已放置的图片会保留" onClick={() => notice(removeLibraryAsset(id))}>×</button>
      <button className="asset-move" aria-label={`移动素材 ${asset.name} 到文件夹`} title="移动分类" onClick={()=>setMoveAsset(id)}>▱</button>
      {folder==='all'&&<small className="asset-folder-path" title={path?.ok?path.value.map(id=>org.folders[id].name).join(' / '):'未分类'}>{path?.ok?path.value.map(id=>org.folders[id].name).join(' / '):'未分类'}</small>}
    </div>; })}</div>
    {picked && (project.libraryAssetIds ?? []).includes(picked) && <button className="asset-bind" disabled={panel?.type !== 'panel' || panel.role !== 'leaf'} onClick={() => {
      if (panel?.type !== 'panel') return; const b = polyBounds(panel.geometry), point = apply(worldMatrix(project, panel.id), { x: b.x + b.width / 2, y: b.y + b.height / 2 });
      notice(placeLibraryAsset(picked, pageId, point, panel.id));
    }}>放入选中分镜</button>}
    <p className="hint">分镜仅作为外层遮罩；选中素材仍可独立调整。移出库不会删除画布实例。</p>{drag.preview}
    {moveAsset&&<FocusDialog title="移动素材到文件夹" onCancel={()=>setMoveAsset(null)}><div className="dialog-heading"><strong>移动素材到文件夹</strong></div><div className="folder-move-list">{[null,...Object.keys(org.folders)].map(id=><button key={id??'root'} onClick={()=>{const r=moveLibraryAssets([moveAsset],id);notice(r);if(r.ok)setMoveAsset(null);}}>{id?folderAncestors(org,id).ok?org.folders[id].name:org.folders[id].name:'未分类'}</button>)}</div><div className="dialog-actions"><button onClick={()=>setMoveAsset(null)}>取消</button></div></FocusDialog>}
  </section>;
}
