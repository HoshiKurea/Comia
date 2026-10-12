import { useEffect, useRef } from 'react';
import { createProject } from '../domain/factories';
import { drawPage } from '../render/drawScene';
import { createObjectDraft, type CreateKind } from '../app/actions';
import { useStore } from 'zustand';
import { runtimeStore } from '../state/runtimeStore';
import { awaitFonts } from '../text/fonts';
import { componentBounds } from './placement';
import { translation } from '../geometry/matrix';
import { componentSceneDraft } from '../panels/instantiate';

export function LibraryThumbnail({ kind, enlarged = false }: { kind: CreateKind; enlarged?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoom = enlarged ? 3 : 1;
  const fontGeneration = useStore(runtimeStore, (s) => s.fontGeneration);
  useEffect(() => {
    const canvas = canvasRef.current, ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const project = createProject(), pageId = project.pageOrder[0];
    const draft = createObjectDraft(kind, pageId, true);
    if (!draft.ok) return;
    const layer = draft.value.layer;
    project.layers[layer.id] = layer;
    for (const child of draft.value.descendants) project.layers[child.id] = child;
    project.pages[pageId].roots = [layer.id];
    let cancelled = false;
    const paint = () => {
      if (cancelled) return;
      const box = componentBounds(draft.value);
      const margin=260;layer.matrix=translation(margin-box.x,margin-box.y);project.pages[pageId].width=Math.ceil(box.width+margin*2);project.pages[pageId].height=Math.ceil(box.height+margin*2);
      const scene = componentSceneDraft(layer, draft.value.descendants, draft.value.independentRoots); if (!scene.ok) return;
      for (const item of [layer, ...draft.value.descendants]) delete project.layers[item.id];
      for (const item of scene.value.layers) project.layers[item.id] = item;
      project.pages[pageId].roots = scene.value.roots;
      const scale = Math.min(30 / box.width, 27 / box.height);
      const tx = (34 - box.width * scale) / 2 - margin * scale;
      const ty = (32 - box.height * scale) / 2 - margin * scale;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save(); ctx.scale(2 * zoom, 2 * zoom); ctx.translate(tx, ty); ctx.scale(scale, scale);
      drawPage(ctx, project, pageId, new Map(), scene.value.roots, false);
      ctx.restore(); canvas.dataset.ready = 'true';
    };
    const needsFont = [layer, ...draft.value.descendants].some((item) => item.type === 'text' || item.type === 'decoration' && item.spec.kind === 'sfx');
    if (needsFont) {
      canvas.dataset.ready = 'false';
      void awaitFonts(project).then((result) => {
        if (cancelled) return;
        if (result.ok) paint(); else canvas.title = result.problems.map((entry) => entry.message).join('；');
      });
    } else paint();
    return () => { cancelled = true; };
  }, [kind, fontGeneration, zoom]);
  return <canvas ref={canvasRef} width={68 * zoom} height={64 * zoom} style={{ width: 34 * zoom, height: 32 * zoom }} aria-hidden="true" />;
}
