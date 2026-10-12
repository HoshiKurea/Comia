import type { BubbleLayer, BubbleStyle, BubbleTail, BubbleTailLayer, Id, Project, Rect, Result, TextLayer } from '../domain/types';
import { fail, ok, problem } from '../domain/types';
import { effectiveLayerFlags } from '../state/effectiveFlags';
import { hasLockedDescendant } from '../layers/group';

export function mainBubbleText(project: Pick<Project,'layers'>, id: Id): TextLayer | null {
  const bubble = project.layers[id]; if (bubble?.type !== 'bubble') return null;
  for (const childId of bubble.children) { const child = project.layers[childId]; if (child?.type === 'text' && child.role !== 'sfx') return child; }
  return null;
}
export function bubbleTails(project: Pick<Project,'layers'>, id: Id): BubbleTailLayer[] {
  const bubble = project.layers[id]; if (bubble?.type !== 'bubble') return [];
  return bubble.children.flatMap(cid => { const layer = project.layers[cid]; return layer?.type === 'bubbleTail' ? [layer] : []; });
}
/** Reconstruct a legacy painter argument, never store it in the document. */
export function legacyBubbleTail(project: Pick<Project,'layers'|'schemaVersion'>, bubble: BubbleLayer): BubbleTail | null {
  if (project.schemaVersion < 6) return bubble.tail ?? null;
  const tails = bubbleTails(project, bubble.id).filter(tail => tail.visible);
  const tail = tails[0];
  if (tails.length !== 1 || !tail.legacySplice || tail.attachment.mode !== 'bubble' || (tail.appearance !== 'triangle' && tail.appearance !== 'line')) return null;
  return { kind: tail.appearance, attachU: tail.attachment.attachU, baseWidth: tail.attachment.baseWidth, tip: tail.tip };
}
export function legacyBubbleView(project: Project, bubble: BubbleLayer): BubbleLayer { return { ...bubble, tail: legacyBubbleTail(project, bubble) }; }
export function preflightBubbleMutation(project: Project, id: Id, changedTextBox?: Rect): Result<void> {
  const bubble = project.layers[id]; if (bubble?.type !== 'bubble') return fail(problem('bubble/target', '目标气泡已不存在'));
  if (effectiveLayerFlags(project, id).locked) return fail(problem('bubble/locked', '锁定的气泡不能编辑'));
  const text = mainBubbleText(project, id);
  if (text && changedTextBox && JSON.stringify(changedTextBox) !== JSON.stringify(text.box) && effectiveLayerFlags(project, text.id).locked) return fail(problem('bubble/text-locked', '轮廓变化影响锁定对白的安全区，操作未修改作品'));
  return ok(undefined);
}

/** Repair only groups touched by a structural edit. No per-frame mutation. */
export function repairDialogueGroups(project: Project, before?: Project): void {
  for (const layer of Object.values(project.layers)) if (layer.type === 'group' && layer.dialogue) {
    const prior=before?.layers[layer.id];
    if(before&&(!prior||prior.type!=='group'||!prior.dialogue||prior.children.length===layer.children.length&&prior.children.every((id,i)=>id===layer.children[i])))continue;
    if (layer.children.length >= 2) {
      const old = layer.dialogue.links;
      layer.dialogue.links = layer.children.slice(1).map((to, i) => {
        const from = layer.children[i], edge = old.find(e => e.from === from && e.to === to || e.from === to && e.to === from);
        return { from, to, width: edge?.width ?? 24, bend: edge?.bend ?? 0 };
      });
    } else {
      // A remaining member keeps its original insertion slot and world position.
      const parent = layer.parentId ? project.layers[layer.parentId] : undefined;
      const siblings = parent && 'children' in parent ? parent.children : project.pages[layer.pageId].roots;
      const index = siblings.indexOf(layer.id);
      if (index < 0) throw Error('对白组不属于当前树');
      const member = layer.children[0] ? project.layers[layer.children[0]] : undefined;
      if (member) {
        member.parentId = layer.parentId;
        const [a,b,c,d,e,f] = layer.matrix, [g,h,j,k,l,m] = member.matrix;
        member.matrix = [a*g+c*h,b*g+d*h,a*j+c*k,b*j+d*k,a*l+c*m+e,b*l+d*m+f];
        if (!layer.visible) member.visible = false;
      }
      siblings.splice(index, 1, ...layer.children); delete project.layers[layer.id];
    }
  }
}

export function effectiveBubbleStyle(project:Pick<Project,'layers'>,body:BubbleLayer):{style:BubbleStyle;pressure:number;seed:number}{
  const parent=body.parentId?project.layers[body.parentId]:undefined;
  if(parent?.type==='group'&&parent.dialogue?.mode==='fused')return{style:parent.dialogue.fusionStyle,pressure:parent.dialogue.fusionPressure,seed:parent.dialogue.seed};
  return{style:body.style,pressure:body.handDrawn?.pressure??0,seed:body.handDrawn?.seed??42};
}

export function preflightDialogueRemoval(project:Project,memberIds:readonly Id[]):Result<void>{
  const selected=new Set(memberIds),parents=new Set(memberIds.map(id=>project.layers[id]?.parentId).filter((id):id is Id=>!!id));
  for(const id of parents){const group=project.layers[id];if(group?.type!=='group'||!group.dialogue)continue;
    const remaining=group.children.filter(cid=>!selected.has(cid));
    if(remaining.length===1&&hasLockedDescendant(project,remaining[0]))return fail(problem('dialogue/locked-survivor','解散只剩一个成员的对白组会改变锁定成员的父级，请先解锁'));
  }
  return ok(undefined);
}
