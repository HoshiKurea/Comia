import { createLayer, createPage, createProject } from '../../../src/domain/factories';
import type { Id, Layer } from '../../../src/domain/types';
import { decodeImage } from '../../../src/assets/importImage';
import { buildBubble } from '../../../src/bubbles/geometry';
import { awaitFonts } from '../../../src/text/fonts';
import { validateProject } from '../../../src/domain/validate';
import { numberFixture } from '../../helpers/numberFixture';
import { inverse, multiply } from '../../../src/geometry/matrix';

/** Deterministic actual PNG fixtures, not mocked bitmap/encoding resources. Eight hashes are reused on all pages. */
export async function createBenchmark(nested = false) {
  const project = createProject({ background: false }), images = new Map<string, ImageBitmap>(), blobs = new Map<string, Blob>();
  for (let index = 0; index < 8; index++) {
    const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 1200;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 1600, 1200); gradient.addColorStop(0, `hsl(${index * 43} 65% 35%)`); gradient.addColorStop(1, `hsl(${index * 43 + 80} 40% 85%)`);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1600, 1200);
    let seed = index + 20261001;
    for (let mark = 0; mark < 600; mark++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const x = seed % 1600;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const y = seed % 1200;
      ctx.fillStyle = `hsla(${seed % 360} 35% 55% / .5)`; ctx.fillRect(x, y, 12 + seed % 70, 8 + seed % 40);
    }
    if (index % 2 === 0) ctx.clearRect(400, 300, 500, 400);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(Error('fixture PNG encode failed')), 'image/png'));
    canvas.width = 0; canvas.height = 0;
    const decoded = await decodeImage(new File([blob], `benchmark-${index}.png`, { type: 'image/png' }), new AbortController().signal);
    if (!decoded.ok) throw Error(decoded.problems[0].message);
    const asset = decoded.value; project.assets[asset.meta.id] = asset.meta; images.set(asset.meta.renderHash, asset.bitmap);
    blobs.set(asset.meta.originalHash, asset.original); blobs.set(asset.meta.renderHash, asset.render);
  }
  const assets = Object.values(project.assets), targets: { pageId: Id; panelId: Id; imageId: Id }[] = [];
  const content = '漫画制作性能基准测试用于验证真实画面交互响应时间和导出结果一致性文字换行保留原始内容'.repeat(5).slice(0, 200);
  for (let number = 0; number < 20; number++) {
    const page = number === 0 ? project.pages[project.pageOrder[0]] : createPage({ name: `第${number + 1}页` });
    if (number) { project.pages[page.id] = page; project.pageOrder.push(page.id); }
    const add = (layer: Layer, parent: Id | null = null) => { layer.parentId = parent; project.layers[layer.id] = layer; if (!parent) page.roots.push(layer.id); return layer; };
    for (let index = 0; index < 8; index++) {
      const x = 80 + index % 4 * 600, y = 100 + Math.floor(index / 4) * 1100;
      const panel = createLayer('panel', page.id); if (panel.type !== 'panel') throw Error('panel');
      panel.geometry = [{ x: 0, y: 0 }, { x: 490, y: 0 }, { x: 490, y: 620 }, { x: 0, y: 620 }]; panel.style.borderRadius = 18; panel.matrix = [1, 0, 0, 1, x, y]; add(panel);
      const image = createLayer('image', page.id); if (image.type !== 'image') throw Error('image');
      image.assetId = assets[index].id; image.width = 1600; image.height = 1200; image.crop = { focus: { u: .45 + number * .003, v: .5 }, zoom: 1 }; add(image, panel.id); panel.children.push(image.id);
      if (!index) targets.push({ pageId: page.id, panelId: panel.id, imageId: image.id });
      const bubble = createLayer('bubble', page.id); if (bubble.type !== 'bubble') throw Error('bubble');
      bubble.width = 440; bubble.height = 300; bubble.matrix = [1, 0, 0, 1, x, y + 670]; add(bubble);
      const child = createLayer('text', page.id); if (child.type !== 'text') throw Error('text');
      const shape = buildBubble(bubble.shape, bubble.width, bubble.height, bubble.style, bubble.tail); if (!shape.ok) throw Error(shape.problems[0].message);
      child.box = shape.value.textBox; child.text.content = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸'[number] + content.slice(1); child.text.font.size = 24; add(child, bubble.id); bubble.children.push(child.id);
      const text = createLayer('text', page.id); if (text.type !== 'text') throw Error('text');
      text.matrix = [1, 0, 0, 1, x, 2350 + Math.floor(index / 4) * 450]; text.box = { x: 0, y: 0, width: 490, height: 420 }; text.text.content = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸'[number] + content.slice(1); text.text.font.size = 24; add(text);
    }
    for (let index = 0; index < 10; index++) {
      const decoration = createLayer('decoration', page.id); if (decoration.type !== 'decoration') throw Error('decoration');
      decoration.matrix = [1, 0, 0, 1, 50 + index % 5 * 480, 3320];
      decoration.spec = { kind: 'speed', width: 420, height: 120, count: 16, angleDeg: index * 13, seed: 91 + index, color: '#000000FF', strokeWidth: 1 }; add(decoration);
    }
    if (nested) {
      // Replace two decorations with two groups: exactly 50 logical layers remain.
      // Preserve chosen objects' page matrices while forcing the interaction through
      // rotated, sheared, nonuniform parent inverses. No extra page or asset is added.
      const decorations = page.roots.filter((id) => project.layers[id].type === 'decoration').slice(-2);
      for (const id of decorations) { delete project.layers[id]; page.roots.splice(page.roots.indexOf(id), 1); }
      const panels = page.roots.filter((id) => project.layers[id].type === 'panel'), bubble = page.roots.find((id) => project.layers[id].type === 'bubble')!;
      const outer = createLayer('group', page.id), inner = createLayer('group', page.id);
      if (outer.type !== 'group' || inner.type !== 'group') throw Error('group');
      const angle = 37 * Math.PI / 180, second = -19 * Math.PI / 180;
      outer.matrix = [Math.cos(angle) * 1.15, Math.sin(angle) * 1.15, Math.cos(angle) * .22 - Math.sin(angle) * .8, Math.sin(angle) * .22 + Math.cos(angle) * .8, 60, -40];
      inner.matrix = [Math.cos(second) * .95, Math.sin(second) * .95, -Math.sin(second) * 1.1, Math.cos(second) * 1.1, -30, 70];
      inner.parentId = outer.id; outer.children = [inner.id, bubble]; inner.children = [panels[0], panels[4]];
      const outerInverse = inverse(outer.matrix), innerInverse = inverse(multiply(outer.matrix, inner.matrix));
      if (!outerInverse.ok || !innerInverse.ok) throw Error('singular nested fixture');
      for (const id of inner.children) { const layer = project.layers[id]; layer.parentId = inner.id; layer.matrix = multiply([...innerInverse.value], layer.matrix); }
      project.layers[bubble].parentId = outer.id; project.layers[bubble].matrix = multiply([...outerInverse.value], project.layers[bubble].matrix);
      page.roots = [outer.id, ...page.roots.filter((id) => ![...inner.children, bubble].includes(id))];
      project.layers[outer.id] = outer; project.layers[inner.id] = inner;
    }
    if (Object.values(project.layers).filter((layer) => layer.pageId === page.id).length !== 50) throw Error('benchmark must keep exactly 50 layers per page');
  }
  const validation = validateProject(numberFixture(project)); if (!validation.ok) throw Error(validation.problems.map((p) => p.message).join('; '));
  const started = performance.now(), fonts = await awaitFonts(project); if (!fonts.ok) throw Error(fonts.problems[0].message);
  return { project, images, blobs, targets, nested, readyFontWaitMs: performance.now() - started, textCodePoints: Array.from(content).length };
}
