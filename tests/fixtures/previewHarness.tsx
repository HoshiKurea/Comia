import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import Konva from 'konva';
import { CanvasView } from '../../src/app/CanvasView';
import { createProject, createLayer } from '../../src/domain/factories';
import { replaceDocument } from '../../src/history/commandBus';
import { numberFixture } from '../helpers/numberFixture';
import { documentStore } from '../../src/state/documentStore';
import { sessionStore } from '../../src/state/sessionStore';
import { runtimeStore } from '../../src/state/runtimeStore';
import '../../src/app/styles.css';
import '../../src/app/theme.css';

// This entry point mounts the actual production component in an isolated page.
// It does not touch the user's editor or expose test controls in production.
const host = document.getElementById('preview-root')!;
host.style.cssText = 'position:fixed;inset:0;display:flex;width:800px;height:600px';
let root: Root | null = null;
const project = createProject({ background: false }), pageId = project.pageOrder[0];
Object.assign(project.pages[pageId], { width: 800, height: 600 });
const layers = ['#FF0000FF', '#00FF00FF', '#0000FFFF'].map((fill, index) => {
  const layer = createLayer('panel', pageId);
  if (layer.type !== 'panel') throw Error('Panel factory returned a different type');
  layer.geometry = [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 160 }, { x: 0, y: 160 }];
  layer.matrix = [1, 0, 0, 1, 80 + index * 60, 90 + index * 20];
  layer.style.fill = fill; layer.style.borderWidth = 0;
  project.layers[layer.id] = layer; return layer;
});
project.pages[pageId].roots = [...project.pages[pageId].roots.filter((id: string) => project.layers[id]?.type === 'pageBackground'), ...(layers.map((layer) => layer.id))];
const replaced = replaceDocument(numberFixture(project));
if (!replaced.ok) throw Error(JSON.stringify(replaced.problems));
sessionStore.setState({ activePageId: pageId, selection: [layers[1].id], scopeId: null, snap16: false, toolMode: 'select', viewportByPage: { [pageId]: { zoom: 1, pan: { x: 20, y: 20 } } } });

const allocations: { canvas: HTMLCanvasElement; origin: string }[] = [];
const originalCreate = document.createElement.bind(document);
let probing = false;
export function installAllocationProbe(): void {
  if (probing) throw Error('Probe already installed');
  probing = true;
  document.createElement = ((tag: string, options?: ElementCreationOptions) => {
    const element = originalCreate(tag, options);
    if (element instanceof HTMLCanvasElement) allocations.push({ canvas: element, origin: new Error().stack ?? '' });
    return element;
  }) as typeof document.createElement;
}
export function removeAllocationProbe(): void { document.createElement = originalCreate; probing = false; }
export function snapshot() {
  const state = documentStore.getState(), runtime = runtimeStore.getState();
  return { project: state.project, history: state.history, preview: runtime.previewProject, active: runtime.gestureActive,
    allocations: allocations.filter(({ origin }) => origin.includes('/src/render/gestureRuns.ts')).map(({ canvas }) => ({ width: canvas.width, height: canvas.height })),
    stages: Konva.stages.filter((stage) => host.contains(stage.container())).length,
    layerCounts: Konva.stages.filter((stage) => host.contains(stage.container())).map((stage) => stage.getLayers().length) };
}
export function mount(): void {
  if (root) throw Error('Already mounted');
  root = createRoot(host); flushSync(() => root!.render(<StrictMode><CanvasView onEditText={() => undefined} /></StrictMode>));
}
export function unmount(): void { if (!root) throw Error('Not mounted'); flushSync(() => root!.unmount()); root = null; }
export function unmountOnNextNativeMove(): void {
  document.addEventListener('pointermove', (event) => { if (!event.isTrusted) throw Error('Native pointer required'); unmount(); }, { once: true });
}
mount();
