import {isInputComposing} from '../workspacePanels/panelInteraction';
import { DrawingWindow } from '../freehand/DrawingWindow';
import { openDrawingWindow } from '../freehand/session';
import { preferencesStore,updatePreference } from '../preferences/store';
import { setEditorTool } from '../interaction/editorTools';
import { currentNodeEdit, nodeKeyboard, nodeKeyUp, commitNodeEdit } from '../interaction/geometryNodeEdit';
import { ToolRail } from './ToolRail';
import {ToolOptionsBar} from './ToolOptionsBar';
import {effectiveDisplayTool} from '../interaction/imageCropTool';
import { ToolIcon } from './ToolIcon';
import { bindingLabel } from '../commands/shortcutBinding';
import { openPresetDialog, PresetDialog } from '../library/PresetDialog';
import { ElementHintPanel } from './ElementHintPanel';
import { PreferencesDialog } from '../preferences/PreferencesDialog';
import { collectMenuCommands,bindMenuCommands,type CommandLeaf } from '../commands/menuCommands';
import { resolveCommandShortcut } from '../commands/shortcutRouter';
import type { CommandId } from '../commands/catalog';
import { currentDrawing,drawingStore } from '../panels/drawingController';
import {currentBubbleBrush} from '../bubbles/brushController';
import { currentImageTrim,trimEditStore } from '../images/trimController';
import { currentMaskEdit,maskEditStore } from '../images/maskController';
import { currentBreakoutEdit } from '../images/breakoutController';
import { currentCropEdit,cropEditStore } from '../images/cropController';
import { mangaEditStore } from '../bubbles/mangaEditController';
import { currentSpeedStroke } from '../library/speedBrushController';
import { PANEL_IDS,PANEL_LABELS } from '../workspacePanels/types';
import { panelLayoutStore } from '../workspacePanels/panelLayoutStore';
import { closePanel,resetLayout } from '../workspacePanels/layoutCommands';
import { changePanelLayout } from '../workspacePanels/PanelGroupView';
import { PanelWorkspace, revealPanel } from '../workspacePanels/PanelWorkspace';
import { ComponentLibraryPanel } from '../workspacePanels/ComponentLibraryPanel';
import { PageManagerPanel } from '../workspacePanels/PageManagerPanel';
import { HistoryPanel } from '../history/HistoryPanel';
import { InspectorPanel } from '../workspacePanels/InspectorPanel';
import { AssetLibrary } from '../assets/AssetLibrary';
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { Id, Result } from '../domain/types';
import { firstMessage } from '../domain/types';
import { needsSavePrompt } from '../history/commandBus';
import { documentStore } from '../state/documentStore';
import { sessionStore, pushNotice, type NoticeContext } from '../state/sessionStore';
import { deleteSelected, redo, undo } from './actions';
import { addPage, deletePage as deletePageCommand, renamePage } from '../pages/commands';
import { CanvasView } from './CanvasView';
import { saveFile, openFile } from '../storage/fileSave';
import { cancelDirectoryRecovery, chooseDirectory, directorySupported, openChosenDirectory, recoverDirectoryCandidate, reloadActiveDirectory, resetDirectorySession, saveToDirectory } from '../storage/directorySession';
import type { DirectoryCandidate } from '../storage/directorySave';
import { downloadPng, downloadPdf, exportAvailability, type ExportProgress } from '../export/exportFiles';
import { beginTextEdit, currentTextEdit } from '../text/editController';
import { finishActiveTextEdit } from '../text/editLifecycle';
import { cancelTextEdit } from '../text/editController';
import { installTheme, setTheme, setSnap16, type ThemePreference } from './theme';
import { FocusDialog } from './FocusDialog';
import { NoticeStack } from './NoticeStack';
import { OfflineUpdate } from '../offline/OfflineUpdate';
import { offlineStore } from '../offline/register';
import { resolveFixedShortcut, type ShortcutAction } from '../interaction/shortcuts';
import { commitKeyboardMove, currentKeyboardMove, moveByKeyboard, cancelKeyboardMove } from '../interaction/keyboardMove';
import { cancelActiveGesture } from '../interaction/activeGesture';
import { runtimeStore } from '../state/runtimeStore';
import { fitPage } from '../interaction/viewport';
import { groupLayers, ungroup, groupEligibility, ungroupEligibility, hasLockedDescendant } from '../layers/group';
import { LayerPanel } from '../layers/LayerPanel';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { moveLayers } from '../layers/reorder';
import { bindSelectedImages, unbindPanelImages, bindingDisabledReason, unbindingDisabledReason } from '../images/panelAssociation';
import { clearAssociation } from '../images/associationController';
import { copyToClipboard, hasClipboard, pasteFromClipboard, subscribeClipboard } from '../layers/clipboard';
import { cancelCreation, currentCreation } from '../library/creationController';
import { ComponentDragPreview } from '../library/ComponentDragPreview';
import { discardRecovery, installRecovery, listRecoveries, restoreRecovery, type RecoveryCandidate } from '../storage/recovery';
import './dialog.css';
import { AppMenuBar } from './AppMenuBar';
import type { EditorMenu, MenuEntry } from './menuTypes';
import { NewProjectDialog } from '../projects/NewProjectDialog';
import { workspaceStore, createWorkspace, switchWorkspace, openWorkspace, closeActiveWorkspace, hasUnsavedWorkspaces, documentDirty } from '../projects/workspaces';
import { createProject } from '../domain/factories';
import { discardWorkspaceRecovery, getRecoveryBinding } from '../storage/recovery';
import { finishActiveTextEdit as finishProjectText } from '../text/editLifecycle';
import { createDialogue, dialogueEligibility, dissolveDialogue } from '../bubbles/dialogueCommands';

function notice(result: Result<unknown>, context?: NoticeContext): void { if (!result.ok) pushNotice('error', firstMessage(result), context); }

export function EditorShell() {
  useEffect(installTheme, []);
  const theme = useStore(sessionStore, (state) => state.theme);
  const snap16 = useStore(sessionStore, (state) => state.snap16);
  const project = useStore(documentStore, (s) => s.project);
  const history = useStore(documentStore, (s) => s.history);
  const savedStateId = useStore(documentStore, (s) => s.savedStateId);
  const activePageId = useStore(sessionStore, (s) => s.activePageId);
  const selection = useStore(sessionStore, (s) => s.selection);
  useEffect(() => { sessionStore.setState({ geometryConstraint: 'freeConvex' }); }, [selection[0]]);
  const toolMode = useStore(sessionStore, (s) => s.toolMode);
  const lineTool=useStore(drawingStore,s=>s.active?.kind==='line'),maskTool=useStore(maskEditStore,s=>!!s.active),cropTool=useStore(cropEditStore,s=>!!s.active);
  const trimTool=useStore(trimEditStore,s=>!!s.active);
  const displayTool=effectiveDisplayTool(toolMode,lineTool,maskTool,cropTool,trimTool);
  const scopeId = useStore(sessionStore, (s) => s.scopeId);
  useEffect(() => {
    if (scopeId && (!project.layers[scopeId] || project.layers[scopeId].pageId !== activePageId)) sessionStore.setState({ scopeId: null });
  }, [scopeId, project, activePageId]);
  const gestureActive = useStore(runtimeStore, (s) => s.gestureActive);
  const editingId = useStore(sessionStore, (state) => state.textEditingId);
  const [busy, setBusy] = useState(false);
  const workspaces = useStore(workspaceStore);
  const [showNewProject, setShowNewProject] = useState(false);
  const [pendingClose, setPendingClose] = useState<{ id: string; epoch: number; stateId: string } | null>(null);
  const exportScale=useStore(preferencesStore,s=>s.value.exportScale),shortcutOverrides=useStore(preferencesStore,s=>s.value.shortcuts);
  const [showPreferences,setShowPreferences]=useState(false);
  const commandHandlers=useRef(new Map<CommandId,CommandLeaf>()),commandDispatch=useRef<(id:CommandId,event?:KeyboardEvent)=>void>(()=>{});
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const exportController = useRef<AbortController | null>(null);
  useEffect(() => () => { exportController.current?.abort(); }, []);
  const [clipboardAvailable, setClipboardAvailable] = useState(hasClipboard());
  useEffect(() => subscribeClipboard(() => setClipboardAvailable(hasClipboard())), []);
  const fileActionDisabled = busy || workspaces.transitioning || gestureActive || toolMode === 'crop' || exportProgress !== null;
  type OpenTarget = { kind: 'file'; file: File } | { kind: 'directory'; handle: FileSystemDirectoryHandle };
  const [directoryCandidates, setDirectoryCandidates] = useState<DirectoryCandidate[]>([]);
  const [directoryConflict, setDirectoryConflict] = useState(false);
  const [downloadPrepared, setDownloadPrepared] = useState(false);
  const [recoveries, setRecoveries] = useState<RecoveryCandidate[]>([]);
  const [showRecoveries, setShowRecoveries] = useState(false);
  const [drawer, setDrawer] = useState<'left' | 'right' | null>(null);
  const closeDrawer = () => { if (currentTextEdit()) cancelTextEdit(); setDrawer(null); };
  useEffect(() => { if (editingId && currentTextEdit()?.kind === 'text') setDrawer(null); }, [editingId]);
  useEffect(() => {
    if (drawer || !editingId || currentTextEdit()?.kind !== 'text') return;
    // Closing a modal drawer restores its opener in rAF. Hand canvas text
    // focus over after that cleanup, so typing cannot land on the opener
    // and Enter cannot activate it. Never steal focus from a newer dialog
    // or a cancelled/replaced text session.
    const frame = requestAnimationFrame(() => {
      const edit = currentTextEdit();
      if (edit?.layerId === editingId && edit.kind === 'text' && !document.querySelector('[role=dialog][aria-modal=true]')) {
        document.querySelector<HTMLTextAreaElement>('.canvas-text-input')?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [drawer, editingId]);
  const openInput = useRef<HTMLInputElement>(null);
  const shortcutHandler = useRef<(action: ShortcutAction, event: KeyboardEvent) => void>(() => {});
  const pageId = activePageId || project.pageOrder[0];
  const livePageId=()=>sessionStore.getState().activePageId||documentStore.getState().project.pageOrder[0];
  const selected = (currentTextEdit()?.preview ?? project).layers[editingId ?? selection[0]];
  const groupCheck = groupEligibility(project, selection), ungroupCheck = selection.length === 1 ? ungroupEligibility(project, selection[0]) : null;
  const groupReason = groupCheck.ok ? null : firstMessage(groupCheck);
  const ungroupReason = !ungroupCheck ? '请选择一个编组再解组' : ungroupCheck.ok ? null : firstMessage(ungroupCheck);
  const pngCheck = exportAvailability(project, [pageId], 'png', exportScale), pdfCheck = exportAvailability(project, project.pageOrder, 'pdf', exportScale);
  const pngReason = !pngCheck.ok ? firstMessage(pngCheck) : null, pdfReason = !pdfCheck.ok ? firstMessage(pdfCheck) : null;
  const fileReason = busy || workspaces.transitioning ? '正在读写或切换项目，请等待完成' : exportProgress !== null ? '正在导出，请等待完成或取消' : gestureActive || toolMode === 'crop' ? '请先完成或取消当前编辑或手势' : null;
  const directoryReason = fileReason ?? (directorySupported() ? null : '此浏览器不支持目录读写，请使用单文件保存或打开');
  const hasWork = history.stateId !== project.id || history.past.length > 0 || project.pageOrder.length > 1 || Object.values(project.layers).some(layer => layer.type !== 'pageBackground' || layer.fill !== '#FFFFFFFF' || layer.frame !== null || layer.watermark !== null || !layer.visible || layer.locked || layer.name !== '页面背景' || layer.colorLabel !== null) || Object.keys(project.templates).length > 0 || project.name !== '未命名项目';
  useEffect(() => {
    // A delayed initial effect must not overwrite an opened/replaced project's
    // active page with the page captured before that replacement.
    if (!sessionStore.getState().activePageId) sessionStore.setState({ activePageId: documentStore.getState().project.pageOrder[0] });
  }, [activePageId, project.pageOrder]);

  useEffect(() => {
    installRecovery();
    void listRecoveries().then((result) => {
      if (result.ok && result.value.length) { setRecoveries(result.value); setShowRecoveries(true); }
    });
  }, []);
  useEffect(() => {
    if (!hasUnsavedWorkspaces() && !editingId) return;
    const warn = (event: BeforeUnloadEvent) => { if (offlineStore.getState().restarting) return; event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasWork, history.stateId, savedStateId, editingId, workspaces.tabs]);

  useEffect(() => {
    const held = new Set<string>();
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const focus=event.target instanceof Element?event.target:document.activeElement;
      if (focus?.closest('[role=menu]')) return;
      const context={textEditing:currentTextEdit()!==null,inputFocused:Boolean(focus?.closest('input,textarea,select')||focus instanceof HTMLElement&&focus.isContentEditable),modalOpen:Boolean(document.querySelector('[role=dialog][aria-modal=true]')),gestureActive:runtimeStore.getState().gestureActive&&!currentKeyboardMove(),composing:isInputComposing(),cancelableToolEdit:!!currentBubbleBrush()||!!currentImageTrim()||!!currentMaskEdit()||currentDrawing()?.kind==='line'||!!currentCropEdit()};
      if(!context.textEditing&&!context.inputFocused&&!context.modalOpen&&!context.composing&&(!context.gestureActive||currentNodeEdit())&&sessionStore.getState().toolMode!=='crop'){
        const result=nodeKeyboard(event);if(!result.ok){event.preventDefault();notice(result);return;}if(result.value){event.preventDefault();return;}
      }
      // An unbound Backspace must never navigate away from artwork; native inputs keep editing.
      if(event.key==='Backspace'&&!context.inputFocused&&!context.composing&&!context.modalOpen)event.preventDefault();
      const action=resolveFixedShortcut(event,context);
      if(!action){const id=resolveCommandShortcut(event,context,preferencesStore.getState().shortcutIndex);if(id){event.preventDefault();if(sessionStore.getState().toolMode==='crop'&&!['save','save-as'].includes(id)&&!id.startsWith('tool-'))return;commandDispatch.current(id,event);}else if(event.repeat&&resolveCommandShortcut(event,context,preferencesStore.getState().shortcutIndex,true))event.preventDefault();return;}
      if (sessionStore.getState().toolMode === 'crop' && !['cancel', 'save', 'saveAs', 'pan'].includes(action)) { event.preventDefault(); return; }
      if (action === 'pan' && focus?.closest('button,a,[role=button]')) return;
      if (['left', 'right', 'up', 'down'].includes(action)) held.add(event.key);
      shortcutHandler.current(action, event);
    };
    const up = (event: KeyboardEvent) => {
      if(currentNodeEdit())notice(nodeKeyUp(event.key));
      if (event.key === ' ') sessionStore.setState({ spacePan: false });
      if (held.delete(event.key) && held.size === 0) notice(commitKeyboardMove());
    };
    const blur = () => { held.clear(); notice(commitNodeEdit());cancelKeyboardMove(); cancelActiveGesture(); sessionStore.setState({ spacePan: false }); };
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); held.clear(); cancelKeyboardMove(); };
  }, []);

  const save = async (asCopy = false) => {
    if (busy) return;
    const origin = documentStore.getState();
    setBusy(true);
    try {
      const result = await saveFile(undefined, asCopy);
      if (!result.ok) notice(result, { epoch: origin.epoch, objectName: origin.project.name, action: { label: '重试保存', run: () => save(asCopy) } });
      else pushNotice('info', result.value.verified ? '项目已写入本地文件' : '已生成下载，请确认文件已保存');
    } finally { setBusy(false); }
  };
  const saveDirectoryAction = async (asCopy = false) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await saveToDirectory(asCopy);
      if (!result.ok) {
        if (result.problems.some((entry) => entry.code === 'directory/conflict' || entry.code === 'directory/current-corrupt' || entry.code === 'directory/recovery-needed')) setDirectoryConflict(true);
        else notice(result, { objectName: documentStore.getState().project.name, action: { label: '改用单文件保存', run: () => save(true) } });
      } else { setDirectoryConflict(false); pushNotice('info', '项目目录已写入并校验'); }
    } finally { setBusy(false); }
  };
  const reloadDirectoryAction = async () => {
    setBusy(true);
    try {
      const result = await reloadActiveDirectory();
      if (!result.ok) notice(result);
      else {
        setDirectoryConflict(false);
        if (result.value.kind === 'recoverable') setDirectoryCandidates(result.value.candidates);
      }
    } finally { setBusy(false); }
  };
  const open = (file: File) => {
    const target = { kind: 'file' as const, file };
    void openAsTab(target);
  };
  const openDirectoryAction = async () => {
    let handle: FileSystemDirectoryHandle;
    try { handle = await chooseDirectory(); }
    catch (error) { if ((error as DOMException).name !== 'AbortError') pushNotice('error', (error as Error).message); return; }
    const target = { kind: 'directory' as const, handle };
    void openAsTab(target);
  };
  const openAsTab = async (target: OpenTarget) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await openWorkspace(async () => {
        if (target.kind === 'file') { const opened = await openFile(target.file); if (opened.ok) resetDirectorySession(); return opened; }
        const opened = await openChosenDirectory(target.handle);
        if (!opened.ok) return opened;
        if (opened.value.kind === 'recoverable') setDirectoryCandidates(opened.value.candidates);
        return { ok: true as const, value: opened.value.kind === 'loaded' ? opened.value.project : undefined };
      });
      notice(result);
    } finally { setBusy(false); if (openInput.current) openInput.current.value = ''; }
  };
  const createProjectTab = async (newProject: import('../domain/types').Project) => {
    if (busy) return; setBusy(true);
    try { const result = await createWorkspace(newProject); notice(result); if (result.ok) { setShowNewProject(false); setDrawer(null); } } finally { setBusy(false); }
  };
  const activateTab = async (id: string) => {
    if (fileActionDisabled || pendingClose || directoryCandidates.length || directoryConflict || showNewProject) return;
    setBusy(true); try { notice(await switchWorkspace(id)); setDrawer(null); } finally { setBusy(false); }
  };
  const requestClose = async (id: string) => {
    if (fileActionDisabled || pendingClose) return;
    setBusy(true);
    try {
      const changed = await switchWorkspace(id); if (!changed.ok) { notice(changed); return; }
      const edited = finishProjectText(); if (!edited.ok) { notice(edited); return; }
      if (documentDirty()) { const d = documentStore.getState(); setPendingClose({ id, epoch: d.epoch, stateId: d.history.stateId }); setDownloadPrepared(false); }
      else notice(await closeActiveWorkspace(createProject({ comic: true })));
    } finally { setBusy(false); }
  };
  const completeClose = async (discard: boolean) => {
    if (!pendingClose || busy) return;
    const d = documentStore.getState();
    if (pendingClose.id !== workspaceStore.getState().activeId || pendingClose.epoch !== d.epoch || pendingClose.stateId !== d.history.stateId) { setPendingClose(null); setDownloadPrepared(false); pushNotice('error', '关闭期间作品已改变，请重新发起关闭'); return; }
    const recovery = getRecoveryBinding(), projectId = d.project.id;
    setBusy(true);
    try {
      const result = await closeActiveWorkspace(createProject({ comic: true })); notice(result);
      if (result.ok) { setPendingClose(null); setDownloadPrepared(false); if (discard) notice(await discardWorkspaceRecovery(projectId, recovery)); }
    } finally { setBusy(false); }
  };
  const saveThenClose = async () => {
    if (!pendingClose || busy) return;
    const origin = documentStore.getState(); setBusy(true);
    try {
      const result = await saveFile(); notice(result);
      const d = documentStore.getState();
      if (!result.ok) return;
      if (d.epoch !== origin.epoch || d.history.stateId !== result.value.stateId) { setPendingClose(null); pushNotice('error', '保存期间作品又有修改，请重新发起关闭'); return; }
      if (!result.value.verified) { setDownloadPrepared(true); return; }
      const closed = await closeActiveWorkspace(createProject({ comic: true })); notice(closed); if (closed.ok) setPendingClose(null);
    } finally { setBusy(false); }
  };
  const exportCurrent = async (format: 'png' | 'pdf') => {
    if (busy || exportController.current) return;
    const originEpoch = documentStore.getState().epoch,pageId=livePageId(),project=documentStore.getState().project,exportScale=preferencesStore.getState().value.exportScale;
    const controller = new AbortController(); exportController.current = controller;
    setExportProgress({ phase: 'prepare', completed: 0, total: format === 'pdf' ? project.pageOrder.length : 1 });
    try {
      const finished = finishActiveTextEdit(); if (!finished.ok) { notice(finished); return; }
      const snapshot = structuredClone(documentStore.getState().project);
      const images = new Map(runtimeStore.getState().images);
      const settings = { scale: exportScale, onProgress: setExportProgress, onWarning: (message: string) => pushNotice('info', message) };
      notice(format === 'png' ? await downloadPng(snapshot, pageId, images, controller.signal, settings) : await downloadPdf(snapshot, images, controller.signal, settings), { epoch: originEpoch, objectName: snapshot.name, action: { label: `重试${format.toUpperCase()}导出`, run: () => exportCurrent(format) } });
    } finally { exportController.current = null; setExportProgress(null); }
  };

  const deletePage = (id: Id) => {
    const project=documentStore.getState().project;if(!project.pages[id])return;
    if (project.pageOrder.length === 1) { pushNotice('error', '至少保留一页'); return; }
    const count = Object.values(project.layers).filter((layer) => layer.pageId === id).length;
    if (!window.confirm(`删除“${project.pages[id].name}”及其 ${count} 个图层？`)) return;
    notice(deletePageCommand(id, true));
  };
  const rename = (id: Id) => {
    const project=documentStore.getState().project;if(!project.pages[id])return;
    const value = window.prompt('页面名称（1～80 码点）', project.pages[id].name);
    if (value !== null) notice(renamePage(id, value));
  };

  shortcutHandler.current = (action, event) => {
    if (action === 'bindImages' || action === 'unbindImages') { const reason = action === 'bindImages' ? bindingDisabledReason() : unbindingDisabledReason(); if (reason) { pushNotice('info', reason); return; } event.preventDefault(); notice(action === 'bindImages' ? bindSelectedImages() : unbindPanelImages(sessionStore.getState().selection)); return; }
    event.preventDefault();
    const session = sessionStore.getState();
    if (action === 'save' || action === 'saveAs') {
      if (busy || runtimeStore.getState().gestureActive || session.toolMode === 'crop') { pushNotice('info', '请先完成或取消当前手势，再保存项目'); return; }
      void save(action === 'saveAs'); return;
    }
    if (action === 'commitText') { notice(finishActiveTextEdit()); return; }
    if (action === 'cancel') {
      clearAssociation();
      const active = runtimeStore.getState().gestureActive || Boolean(currentTextEdit()) || Boolean(currentCreation()) || session.toolMode === 'crop';
      cancelCreation(); cancelActiveGesture(); cancelTextEdit(); sessionStore.setState({ toolMode: 'select', spacePan: false });
      if (!active && session.scopeId) { const parent = documentStore.getState().project.layers[session.scopeId]?.parentId; sessionStore.setState({ scopeId: parent && documentStore.getState().project.layers[parent]?.type === 'group' ? parent : null, selection: [] }); }
      return;
    }
    if (action === 'pan') { if (!event.repeat) sessionStore.setState({ spacePan: true }); return; }
    if (action === 'undo' || action === 'redo') { notice(action === 'undo' ? undo() : redo()); return; }
    if (action === 'delete') { notice(deleteSelected()); return; }
    if (action === 'copy' || action === 'duplicate') {
      const result = copyToClipboard(session.selection); notice(result);
      if (result.ok) { setClipboardAvailable(true); if (action === 'duplicate') notice(pasteFromClipboard(session.activePageId)); } return;
    }
    if (action === 'paste') { notice(pasteFromClipboard(session.activePageId)); return; }
    if (action === 'group') { notice(groupLayers(session.selection)); return; }
    if (action === 'ungroup') { const id = session.selection[0]; if (session.selection.length !== 1 || !id) pushNotice('error', '请选择一个编组再解组'); else notice(ungroup(id)); return; }
    const step = event.shiftKey ? 10 : 1;
    notice(moveByKeyboard(action === 'left' ? -step : action === 'right' ? step : 0, action === 'up' ? -step : action === 'down' ? step : 0));
  };

  const showLeft = (tab: 'library' | 'assets' | 'pages', settings = false) => {
    revealPanel(tab==='library'?'components':tab==='assets'?'assets':'pages');
    if (settings) requestAnimationFrame(() => document.querySelector<HTMLSelectElement>('[aria-label="纸张"]')?.focus());
  };
  const fitCurrentPage = () => {
    const node = document.querySelector<HTMLElement>('.canvas-viewport');
    const id=livePageId(),page=documentStore.getState().project.pages[id];if(node&&page){cancelActiveGesture();sessionStore.setState(s=>({viewportByPage:{...s.viewportByPage,[id]:fitPage(page,{x:node.clientWidth,y:node.clientHeight})}}));}
  };
  const action = (id: string, label: string, run: () => void | Promise<void>, disabledReason: string | null = null): MenuEntry => ({ kind: 'action', id, label, run, disabledReason });
  const separator = (id: string): MenuEntry => ({ kind: 'separator', id });
  const copyReason = fileReason ?? (!selection.length ? '请先选择要复制的对象' : selection.some(id => project.layers[id]?.type === 'pageBackground') ? '页面背景请使用背景模板替换' : null);
  const sortReason = fileReason ?? (!selection.length ? '请先选择要排序的对象' : selection.some(id => project.layers[id]?.type === 'pageBackground') ? '页面背景固定在最底部' : selection.some(id => !project.layers[id] || project.layers[id].parentId !== project.layers[selection[0]]?.parentId || project.layers[id].pageId !== pageId) ? '排序仅支持同页、同父级图层' : selection.some(id => effectiveLayerFlags(project, id).locked || hasLockedDescendant(project, id)) ? '请先解锁选中图层及其祖先或后代' : sessionStore.getState().filter.name.trim() || sessionStore.getState().filter.color ? '清除图层筛选后才能调整顺序' : null);
  const copyAction = (duplicate = false) => { const result = copyToClipboard(sessionStore.getState().selection); notice(result); if (result.ok) { setClipboardAvailable(true); if (duplicate) notice(pasteFromClipboard(sessionStore.getState().activePageId)); } };
  const preferencesReason=()=>isInputComposing()?'请先完成输入法候选，再打开首选项':fileReason??(currentTextEdit()||currentDrawing()||currentBubbleBrush()||currentImageTrim()||currentMaskEdit()||currentBreakoutEdit()||currentCropEdit()||currentCreation()||currentSpeedStroke()||mangaEditStore.getState().active?'请先完成或取消当前编辑，再打开首选项':null);
  const openPreferences=()=>{const reason=preferencesReason();if(reason){pushNotice('info',reason);return;}if(document.querySelector('[role=dialog][aria-modal=true]'))return;setShowPreferences(true);};
  const menus: EditorMenu[] = [
    { id: 'file', label: '文件', entries: [
      action('new-project', '新建项目…', () => { const edited = finishProjectText(); notice(edited); if (edited.ok) setShowNewProject(true); }, fileReason),
      action('open-project', '打开项目…', () => openInput.current?.click(), fileReason), action('open-directory', '打开项目目录…', openDirectoryAction, directoryReason), separator('file-save'),
      action('save', '保存项目', () => save(), fileReason), action('save-as', '另存为…', () => save(true), fileReason), action('save-directory', '保存到项目目录…', () => saveDirectoryAction(), directoryReason),
      action('close-project', '关闭当前项目', () => requestClose(workspaceStore.getState().activeId), fileReason), separator('file-export'),
      action('png', '导出 PNG', () => exportCurrent('png'), fileReason ?? pngReason), action('pdf', '导出 PDF', () => exportCurrent('pdf'), fileReason ?? pdfReason),
      { kind: 'submenu', id: 'export-scale', label: '导出倍率', disabledReason: fileReason, entries: [0.25, 0.5, 1, 2, 4].map(scale => ({ kind: 'radio', id: `scale-${scale}`, label: `${scale}×`, checked: scale === exportScale, disabledReason: fileReason, run: () => notice(updatePreference('exportScale',scale as .25|.5|1|2|4)) })) },
      separator('file-preferences'),action('preferences','首选项…',openPreferences,preferencesReason()),
    ] },
    { id: 'edit', label: '编辑', entries: [
      action('undo', '撤销', () => notice(undo()), fileReason ?? (!history.past.length ? '没有可以撤销的操作' : null)), action('redo', '重做', () => notice(redo()), fileReason ?? (!history.future.length ? '没有可以重做的操作' : null)), separator('edit-clipboard'),
      action('copy', '复制', () => copyAction(), copyReason), action('paste', '粘贴', () => notice(pasteFromClipboard(sessionStore.getState().activePageId)), fileReason ?? (!clipboardAvailable ? '请先复制对象到组件剪贴板' : null)),
      action('duplicate', '复制一份', () => copyAction(true), copyReason), action('delete', '删除选中对象', () => notice(deleteSelected()), fileReason ?? (!selection.length ? '请先选择要删除的对象' : selection.some(id => effectiveLayerFlags(project, id).locked) ? '请先解锁选中的对象' : null)),
    ] },
    { id: 'layer', label: '图层', entries: [action('group', '编组', () => notice(groupLayers(sessionStore.getState().selection)), fileReason ?? groupReason), action('ungroup', '解组', () => notice(ungroup(sessionStore.getState().selection[0])), fileReason ?? ungroupReason), ...(['connector','fused','overlap'] as const).map((mode,i)=>action('dialogue-'+mode,['建立连接对白','建立融合对白','建立叠加对白'][i],()=>notice(createDialogue(sessionStore.getState().selection,mode)),fileReason ?? (dialogueEligibility(project,selection).ok ? null : '请选择2～16个连续、可见且未锁定的气泡主体'))), action('dissolve-dialogue','解散连续对白',()=>notice(dissolveDialogue(sessionStore.getState().selection[0])),fileReason ?? (selection.length===1 && project.layers[selection[0]]?.type==='group' && (project.layers[selection[0]] as import('../domain/types').GroupLayer).dialogue ? null : '请选择连续对白组')), separator('layer-association'), action('bind-images', '关联素材到分镜', () => notice(bindSelectedImages()), fileReason ?? bindingDisabledReason()), action('unbind-images', '解除素材分镜关联', () => notice(unbindPanelImages(sessionStore.getState().selection)), fileReason ?? unbindingDisabledReason()), separator('layer-order'), ...(['top', 'up', 'down', 'bottom'] as const).map((direction, i) => action(`order-${direction}`, ['置于顶层', '上移一层', '下移一层', '置于底层'][i], () => notice(moveLayers(sessionStore.getState().selection, direction)), sortReason))] },
    { id: 'page', label: '页面', entries: [action('add-page', '新建漫画页', () => notice(addPage(livePageId())), fileReason), action('rename-page', '重命名当前页…', () => rename(livePageId()), fileReason), action('delete-page', '删除当前页…', () => deletePage(livePageId()), fileReason ?? (project.pageOrder.length <= 1 ? '至少保留一页' : null)), separator('page-settings'), action('page-settings', '页面设置…', () => showLeft('pages', true), fileReason)] },
    { id: 'view', label: '视图', entries: [action('fit-page', '适应页面', fitCurrentPage), { kind: 'check', id: 'panel-numbers', label: '显示分镜序号', checked: () => sessionStore.getState().showPanelNumbers, disabledReason: null, run: () => notice(updatePreference('showPanelNumbers',!sessionStore.getState().showPanelNumbers)) }, { kind: 'check', id: 'manuscript-guides', label: '显示漫画定位线', checked: () => sessionStore.getState().showManuscriptGuides, disabledReason: null, run: () => notice(updatePreference('showManuscriptGuides', !sessionStore.getState().showManuscriptGuides)) }, { kind: 'check', id: 'snap16', label: '16 倍数尺寸吸附', checked: snap16, disabledReason: null, run: () => setSnap16(!sessionStore.getState().snap16) },
      { kind: 'submenu', id: 'theme', label: '界面主题', disabledReason: null, entries: (['system', 'light', 'dark'] as ThemePreference[]).map((value, i) => ({ kind: 'radio', id: `theme-${value}`, label: ['跟随系统', '浅色', '深色'][i], checked: theme === value, disabledReason: null, run: () => setTheme(value) })) }, separator('view-sidebars'),
      action('show-library', '组件库', () => showLeft('library')), action('show-assets', '素材库', () => showLeft('assets')), action('show-pages', '项目页面', () => showLeft('pages'))] },
    {id:'window',label:'窗口',entries:[...PANEL_IDS.map(id=>({kind:'check' as const,id:'panel-'+id,label:PANEL_LABELS[id],checked:()=>!panelLayoutStore.getState().layout.hidden.includes(id),disabledReason:null,run:()=>{if(panelLayoutStore.getState().layout.hidden.includes(id))revealPanel(id);else changePanelLayout(l=>closePanel(l,id));}})),separator('workspace-reset'),action('reset-workspace','恢复默认工作区',()=>changePanelLayout(resetLayout))]},
  ];

  const editMenu=menus.find(m=>m.id==='edit');if(editMenu)editMenu.entries.push(action('drawing-window','自由绘画窗口…',()=>notice(openDrawingWindow()),fileReason));
  const layerMenu=menus.find(m=>m.id==='layer');if(layerMenu)layerMenu.entries.push(action('save-component-preset','保存为组件预设…',()=>notice(openPresetDialog()),fileReason??(!selection.length?'请选择组件':null)));
  commandHandlers.current=collectMenuCommands(menus);
  commandDispatch.current=(id,event)=>{
    if(document.querySelector('[role=dialog][aria-modal=true]'))return;
    if(id==='tool-select'||id==='tool-geometry'||id==='tool-marquee'||id==='tool-lasso'||id==='tool-panel-cut'||id==='tool-image-crop'||id==='tool-image-mask'||id==='tool-bubble-brush'){if(busy||workspaceStore.getState().transitioning||exportProgress!==null)return;notice(setEditorTool(id==='tool-bubble-brush'?'bubble-brush':id==='tool-select'?'select':id==='tool-geometry'?'geometry':id==='tool-marquee'?'marquee':id==='tool-lasso'?'lasso':id==='tool-panel-cut'?'panel-cut':id==='tool-image-mask'?'image-mask':'image-crop'));return;}
    const entry=commandHandlers.current.get(id);if(!entry)return;
    const legacy:Partial<Record<CommandId,ShortcutAction>>={'bind-images':'bindImages','unbind-images':'unbindImages','save-as':'saveAs',undo:'undo',redo:'redo',save:'save',delete:'delete',copy:'copy',paste:'paste',duplicate:'duplicate',group:'group',ungroup:'ungroup'};
    if(event&&legacy[id]){if(busy||workspaceStore.getState().transitioning||exportProgress!==null){pushNotice('info','正在读写、切换或导出项目，请等待完成');return;}shortcutHandler.current(legacy[id]!,event);return;}
    if(entry.disabledReason){pushNotice('info',entry.disabledReason);return;}
    try{const result=entry.run();if(result instanceof Promise)void result.catch(e=>pushNotice('error',(e as Error).message));}catch(e){pushNotice('error',(e as Error).message);}
  };
  const boundMenus=bindMenuCommands(menus,shortcutOverrides,id=>commandDispatch.current(id));
  return <div className="editor-shell">
    <header className="topbar project-topbar"><div className="brand"><span className="brand-mark">C</span><span>COMIA</span></div>
      <AppMenuBar menus={boundMenus} /><div className="project-heading"><span className="project-name" title={project.name}>{project.name}</span><span className="unsaved">{needsSavePrompt() ? '● 未保存' : '✓ 已保存'}</span></div>
      <input ref={openInput} type="file" accept=".json,.Comia.json" hidden aria-label="打开项目文件" onChange={e => { const file = e.target.files?.[0]; if (file) void open(file); }} />
    </header>
    <ToolOptionsBar disabled={busy||workspaces.transitioning||exportProgress!==null} bindings={Object.fromEntries((['tool-select','tool-marquee','tool-lasso','tool-geometry','tool-panel-cut','tool-image-crop','tool-image-mask','tool-bubble-brush']as const).map(id=>[id,bindingLabel(id,shortcutOverrides)]))}/>
    <div className="project-tabs" role="tablist" aria-label="漫画项目">{workspaces.tabs.map(tab => <div className={`project-tab${tab.id === workspaces.activeId ? ' active' : ''}`} key={tab.id}>
      <button role="tab" aria-selected={tab.id === workspaces.activeId} aria-controls="active-project-panel" tabIndex={tab.id === workspaces.activeId ? 0 : -1} title={tab.name} disabled={fileActionDisabled} onClick={() => void activateTab(tab.id)} onKeyDown={e => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); e.stopPropagation();
        const index = workspaces.tabs.findIndex(t => t.id === tab.id), next = e.key === 'Home' ? 0 : e.key === 'End' ? workspaces.tabs.length - 1 : (index + (e.key === 'ArrowLeft' ? -1 : 1) + workspaces.tabs.length) % workspaces.tabs.length;
        const target = workspaces.tabs[next]; void activateTab(target.id); document.querySelectorAll<HTMLButtonElement>('.project-tabs [role=tab]')[next]?.focus();
      }}>{tab.dirty ? '● ' : ''}{tab.name}</button>
      <button className="close-project-tab" aria-label={`关闭项目 ${tab.name}`} title="关闭项目" disabled={fileActionDisabled} onClick={() => void requestClose(tab.id)}>×</button>
    </div>)}</div>
    {(pngReason || pdfReason || selection.length >= 2 && groupReason) && <p className="operation-hint" role="status">{[selection.length >= 2 ? groupReason : null, pngReason ? `PNG：${pngReason}` : null, pdfReason ? `PDF：${pdfReason}` : null].filter(Boolean).join('；')}</p>}
    <PanelWorkspace drawer={drawer} setDrawer={setDrawer} closeDrawer={closeDrawer} busy={busy || workspaces.transitioning || exportProgress!==null} contents={{
      components:<ComponentLibraryPanel project={project} pageId={pageId} toolMode={toolMode} onDeployed={()=>setDrawer(null)} />,
      assets:<AssetLibrary />, pages:<PageManagerPanel project={project} pageId={pageId} rename={rename} remove={deletePage} />,
      inspector:<div className="inspector"><InspectorPanel layer={selected} /></div>,layers:<LayerPanel project={project} pageId={pageId} selection={selection} />,
      hints:<ElementHintPanel />,history:<HistoryPanel busy={busy || workspaces.transitioning || exportProgress!==null} />,
    }}>
      <main className="workspace" id="active-project-panel" role="tabpanel" aria-label={project.name}><div className="canvas-toolbar"><span>页面画布{scopeId && project.layers[scopeId] ? ` / ${project.layers[scopeId].name}` : ""}</span><span className="toolbar-right">{scopeId && <button onClick={() => { cancelCreation(); const parent = project.layers[scopeId]?.parentId; sessionStore.setState({ scopeId: parent && project.layers[parent]?.type === "group" ? parent : null, selection: [] }); }}>退出组</button>}{selection.length>1&&<span className="canvas-selection-count" role="status" aria-label="画布选区">已选 {selection.length} 项</span>}<button className={toolMode === 'geometry' ? 'active' : ''} aria-pressed={toolMode==='geometry'} title={selected?.type === 'panel' ? `几何编辑 · ${bindingLabel('tool-geometry',shortcutOverrides)||'未设置快捷键'} · Ctrl拖动单节点` : '请先选择分镜再编辑几何'} disabled={selected?.type !== 'panel'||selection.length!==1} onClick={() => notice(setEditorTool('geometry'))}><ToolIcon kind="geometry"/>几何</button></span></div><div className="canvas-work-area"><ToolRail mode={displayTool} extraBindings={{'tool-panel-cut':bindingLabel('tool-panel-cut',shortcutOverrides),'tool-image-crop':bindingLabel('tool-image-crop',shortcutOverrides),'tool-image-mask':bindingLabel('tool-image-mask',shortcutOverrides),'tool-bubble-brush':bindingLabel('tool-bubble-brush',shortcutOverrides)}} areaBindings={{'tool-marquee':bindingLabel('tool-marquee',shortcutOverrides),'tool-lasso':bindingLabel('tool-lasso',shortcutOverrides)}} onAreaTool={id=>commandDispatch.current(id)} selected={displayTool==='select'} binding={bindingLabel('tool-select',shortcutOverrides)} disabled={busy||workspaces.transitioning||exportProgress!==null} onSelect={()=>notice(setEditorTool('select'))}/><CanvasView areaDisabled={busy||workspaces.transitioning||exportProgress!==null} onEditText={(id) => notice(beginTextEdit(id))} /></div></main>
    </PanelWorkspace>
    <ComponentDragPreview />
    <OfflineUpdate />
    {exportProgress && <div className="export-progress" role="status" aria-label="导出进度"><span>{({ prepare: '准备字体与图片', render: '绘制页面', encode: '编码文件' } as const)[exportProgress.phase]} · {exportProgress.completed}/{exportProgress.total}</span><progress max={exportProgress.total} value={exportProgress.completed} /><button onClick={() => exportController.current?.abort()}>取消导出</button></div>}
    <NoticeStack />
    {showPreferences&&<PreferencesDialog onClose={()=>setShowPreferences(false)} />}
    <PresetDialog />
    <DrawingWindow />

    {showNewProject && <NewProjectDialog busy={busy || workspaces.transitioning} create={p => void createProjectTab(p)} cancel={() => { if (!busy) setShowNewProject(false); }} />}
    {pendingClose && <FocusDialog title="关闭项目" onCancel={() => { if (!busy) { setPendingClose(null); setDownloadPrepared(false); } }}><div className="dialog-heading"><strong>关闭“{project.name}”</strong></div><p>此漫画有未保存更改。其他项目会保留，请选择保存、放弃更改，或取消关闭。</p><div className="dialog-actions"><button disabled={busy} onClick={() => { setPendingClose(null); setDownloadPrepared(false); }}>取消</button><button disabled={busy} onClick={() => void completeClose(true)}>放弃更改并关闭</button>{downloadPrepared ? <button className="primary" disabled={busy} onClick={() => void completeClose(true)}>确认文件已保存并关闭</button> : <button className="primary" disabled={busy} onClick={() => void saveThenClose()}>先保存再关闭</button>}</div></FocusDialog>}
    {directoryConflict && <FocusDialog title="项目目录已被修改" onCancel={() => setDirectoryConflict(false)}><div className="dialog-heading"><strong>项目目录已被修改</strong></div><p>目录版本与本页记录不一致。当前编辑仍保留；可另存副本、重新加载目录，或取消。</p><div className="dialog-actions"><button onClick={() => setDirectoryConflict(false)}>取消</button><button disabled={busy} onClick={() => void reloadDirectoryAction()}>重新加载</button><button className="primary" disabled={busy} onClick={() => void saveDirectoryAction(true)}>另存副本</button></div></FocusDialog>}
    {directoryCandidates.length > 0 && !directoryConflict && <FocusDialog title="选择可恢复的目录版本" onCancel={() => { cancelDirectoryRecovery(); setDirectoryCandidates([]); }}><div className="dialog-heading"><strong>选择可恢复的目录版本</strong></div><p>目录指针缺失或损坏。请选择经完整校验的版本；原目录内容会保留。</p>{directoryCandidates.map((candidate) => <div className="recovery-row" key={candidate.generation}><span><strong>{candidate.projectName}</strong><small>{new Date(candidate.createdAt).toLocaleString()} · {candidate.layerCount} 个图层</small></span><button onClick={() => { void openWorkspace(() => recoverDirectoryCandidate(candidate.generation)).then((result) => { notice(result); if (result.ok) setDirectoryCandidates([]); }); }}>恢复此版本</button></div>)}<div className="dialog-actions"><button onClick={() => { cancelDirectoryRecovery(); setDirectoryCandidates([]); }}>取消</button></div></FocusDialog>}
    {showRecoveries && !showNewProject && !pendingClose && !directoryCandidates.length && <FocusDialog title="发现本机恢复草稿" onCancel={() => setShowRecoveries(false)}><div className="dialog-heading"><strong>发现本机恢复草稿</strong></div><p>以下作品有自动保存的草稿。恢复后仍需正式保存项目文件。</p>{recoveries.map((candidate) => <div className="recovery-row" key={candidate.key}><span><strong>{candidate.projectName}</strong><small>{new Date(candidate.createdAt).toLocaleString()} · {candidate.layerCount} 个图层</small></span><button onClick={() => { void openWorkspace(() => restoreRecovery(candidate.key)).then((result) => { notice(result); if (result.ok) setShowRecoveries(false); }); }}>恢复</button><button onClick={() => { void discardRecovery(candidate.key).then((result) => { notice(result); if (result.ok) { const next = recoveries.filter((item) => item.key !== candidate.key); setRecoveries(next); if (!next.length) setShowRecoveries(false); } }); }}>丢弃</button></div>)}<div className="dialog-actions"><button onClick={() => setShowRecoveries(false)}>稍后</button></div></FocusDialog>}
  </div>;
}
