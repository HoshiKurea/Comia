import { createProject as createDefaultProject } from '../../src/domain/factories';
/** Geometry/resource fixtures explicitly start with a transparent, empty schema4 page.
 * Product defaults are tested separately against the unmodified production factory. */
export function createContentProject() {
  const project = createDefaultProject();
  project.schemaVersion = 4; delete project.nextPanelNumber;
  delete project.assetLibrary;
  for (const page of Object.values(project.pages)) { for (const id of page.roots) delete project.layers[id]; page.roots = []; }
  return project;
}
export function toLegacy(project: ReturnType<typeof createDefaultProject>, version: 1 | 2 | 3) {
  const copy = structuredClone(project); copy.schemaVersion = version;
  delete copy.nextPanelNumber;
  delete copy.assetLibrary;
  for (const layer of Object.values(copy.layers)) {
    if (layer.type === 'panel') { delete layer.editorNumber; delete layer.nameMode; }
    if (layer.type === 'image') { if (layer.sourceRect) throw Error('裁后实例不能冒充旧格式样本'); delete layer.sourceRect; }
    if (layer.type === 'bubble') { delete layer.edgeStyle; delete layer.style.innerStroke; delete layer.style.outerStroke; }
    if (layer.type === 'text') delete layer.bubbleFrame;
  }
  for (const page of Object.values(copy.pages)) {
    const background = page.roots.map(id => copy.layers[id]).find(layer => layer.type === 'pageBackground');
    page.background = background?.type === 'pageBackground' ? background.fill : page.background ?? '#FFFFFFFF';
    page.roots = page.roots.filter(id => copy.layers[id].type !== 'pageBackground');
    if (background) delete copy.layers[background.id];
  }
  if (version < 3) delete copy.libraryAssetIds;
  return copy;
}
