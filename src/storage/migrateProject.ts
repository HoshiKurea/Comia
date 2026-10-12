import type { PanelTemplateNode, Project, Result } from '../domain/types';
import { emptyAssetLibrary, libraryNameKey, normalizedLibraryName } from '../assets/folderModel';
import { convertLegacyTemplate, recipeFromLayers, sceneProject } from '../library/presetModel';
import { validateProject } from '../domain/validate';
import { createPageBackground } from '../domain/factories';
import { assignNewPanelNumbers } from '../panels/numbering';
import { migrationId } from '../domain/id';
import { completeExtensionProject } from '../domain/extensionDefaults';
/** Validate the old convex contract before upgrading; never mutates caller data. */
export function migrateProject(input: unknown): Result<Project> {
  const checked = validateProject(input); if (!checked.ok || checked.value.schemaVersion === 9) return checked;
  if (checked.value.schemaVersion === 8) return upgradeTo9(checked.value);
  if (checked.value.schemaVersion === 7) return upgradeTo8(checked.value);
  const project = structuredClone(checked.value); const legacy = project.schemaVersion === 1;
  project.settings.readingDirection = 'rtl';
  // Format6 already owns independent tails and manga text effects. Never run
  // the older manga migration over it a second time.
  if (project.schemaVersion === 6) { project.schemaVersion = 7; return upgradeTo8(project); }
  if (project.schemaVersion < 3) project.libraryAssetIds = Object.keys(project.assets);
  const needsBackground = project.schemaVersion < 4;
  const needsNumbers = project.schemaVersion < 5;
  project.schemaVersion = 5; if (needsNumbers) project.nextPanelNumber = 1;
  for (const page of needsBackground ? Object.values(project.pages) : []) {
    let background = createPageBackground(page.id, page.background);
    while (project.layers[background.id] || project.pages[background.id] || project.assets[background.id] || project.templates[background.id] || background.id === project.id) background = createPageBackground(page.id, page.background);
    project.layers[background.id] = background; page.roots.unshift(background.id); delete page.background;
  }
  for (const layer of Object.values(project.layers)) if (legacy && layer.type === 'panel') layer.geometryMode = 'convex';
  const visit = (node: PanelTemplateNode) => { node.geometryMode = 'convex'; node.children.forEach(visit); };
  if (legacy) Object.values(project.templates).forEach(template => { if ('root' in template) visit(template.root); });
  if (needsNumbers) {
    const numbered = assignNewPanelNumbers(project, Object.values(project.layers).filter(layer => layer.type === 'panel' && layer.role === 'leaf').map(layer => layer.id));
    if (!numbered.ok) return numbered;
  }
  const used = new Set([project.id, ...Object.keys(project.pages), ...Object.keys(project.layers), ...Object.keys(project.assets), ...Object.keys(project.templates)]);
  for (const layer of Object.values(project.layers)) {
    if (layer.type === 'bubble') {
      layer.handDrawn = null; layer.contour = null;
      if (layer.tail) {
        let suffix = 0, id = migrationId(`legacy-tail:${layer.id}`);
        while (used.has(id)) id = migrationId(`legacy-tail:${layer.id}:${++suffix}`);
        used.add(id);
        project.layers[id] = {
          id, pageId: layer.pageId, parentId: layer.id, name: '气泡尾巴', visible: true, locked: false,
          colorLabel: null, matrix: [1, 0, 0, 1, 0, 0], type: 'bubbleTail',
          appearance: layer.tail.kind, attachment: { mode: 'bubble', attachU: layer.tail.attachU, baseWidth: layer.tail.baseWidth },
          tip: { ...layer.tail.tip }, route: { kind: 'straight' }, beads: 4, zigzag: 4, style: null, stroke: null, legacySplice: true,
        };
        layer.children.push(id);
      }
      delete layer.tail;
    } else if (layer.type === 'text') { layer.role = 'plain'; layer.effects = null; }
    else if (layer.type === 'decoration' && layer.spec.kind === 'sfx') {
      const spec = layer.spec;
      project.layers[layer.id] = {
        id: layer.id, pageId: layer.pageId, parentId: layer.parentId, name: layer.name,
        visible: layer.visible, locked: layer.locked, colorLabel: layer.colorLabel, matrix: layer.matrix,
        type: 'text', role: 'sfx', box: { x: 0, y: 0, width: spec.width, height: spec.height },
        text: { content: spec.content, direction: 'horizontal', font: { family: spec.fontFamily, size: spec.fontSize, color: spec.color, bold: true, italic: false }, align: 'start', lineHeight: 1, letterSpacing: 0 },
        effects: { outlineColor: spec.outline, outlineWidth: spec.outlineWidth, shearDeg: 0, deformation: 'none', amount: 0, cycles: 1, recipe: 'legacy-sfx-v5' },
      };
    }
  }
  project.schemaVersion = 7;
  return upgradeTo8(project);
}

function upgradeTo8(source: Project): Result<Project> {
  const project = structuredClone(source); project.assetLibrary = emptyAssetLibrary(project.libraryAssetIds);
  const names = new Set<string>();
  for (const [id, template] of Object.entries(project.templates)) {
    if (!('root' in template)) continue;
    const original = normalizedLibraryName(template.name); let name = original, suffix = 2;
    while (names.has(libraryNameKey(name))) { const end = ` (${suffix++})`; name = Array.from(original).slice(0, 80 - end.length).join('') + end; }
    names.add(libraryNameKey(name));
    const converted = convertLegacyTemplate({ ...template, name }); if (!converted.ok) return converted;
    project.templates[id] = converted.value;
  }
  project.schemaVersion = 8;
  const checked = validateProject(project); return checked.ok ? upgradeTo9(checked.value) : checked;
}

function upgradeTo9(source: Project): Result<Project> {
  const project = structuredClone(source); completeExtensionProject(project, true);
  for (const template of Object.values(project.templates)) if ('recipe' in template && template.recipe.kind === 'scene') {
    const local = sceneProject(template.recipe);
    for (const node of Object.values(template.recipe.nodes)) {
      const layer = local.layers[node.id];
      if (layer.type === 'text' && node.type === 'text' && !node.bubbleFrame) delete layer.bubbleFrame;
      if (layer.type === 'panel' && node.type === 'panel') layer.nameMode = node.nameMode ?? (/^分镜\s*\d+$/.test(node.name) ? 'automatic' : 'custom');
    }
    completeExtensionProject(local, true);
    template.recipe = recipeFromLayers(template.recipe.roots, Object.values(local.layers));
  }
  project.nextPanelNumber = Math.max(0, ...Object.values(project.layers).flatMap(l => l.type === 'panel' && l.role === 'leaf' ? [l.editorNumber!] : [])) + 1;
  project.schemaVersion = 9; return validateProject(project);
}
