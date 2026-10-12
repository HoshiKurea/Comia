import { describe, expect, it } from 'vitest';
import { createLayer, createProject } from '../../src/domain/factories';
import { validateProject } from '../../src/domain/validate';
import { migrateProject } from '../../src/storage/migrateProject';
import { migrationId } from '../../src/domain/id';
import { bubbleTails, mainBubbleText } from '../../src/bubbles/ownership';
import type { BubbleLayer, BubbleTailLayer, GroupLayer, Project } from '../../src/domain/types';

function fixture(): Project {
  const project = createProject(), pageId = project.pageOrder[0];project.schemaVersion=5;
  const bubble = createLayer('bubble', pageId) as BubbleLayer;
  const text = createLayer('text', pageId); if (text.type !== 'text') throw Error('text');
  text.parentId = bubble.id; text.text.content = '对白😀\n第二行'; bubble.children = [text.id];
  bubble.tail = { kind: 'triangle', attachU: .65, baseWidth: 24, tip: { x: 195, y: 240 } };
  project.layers[bubble.id] = bubble; project.layers[text.id] = text; project.pages[pageId].roots.push(bubble.id);
  const sfx = createLayer('decoration', pageId); if (sfx.type !== 'decoration') throw Error('sfx');
  sfx.matrix = [1.2, .1, .2, 1.1, 40, 90];
  sfx.spec = { kind: 'sfx', width: 16, height: 16, content: 'ドン！ 長い音效', fontFamily: 'sans-serif', fontSize: 96, color: '#11112280', outline: '#FFFFFF80', outlineWidth: 3 };
  project.layers[sfx.id] = sfx; project.pages[pageId].roots.push(sfx.id);
  return project;
}
function upgraded(input = fixture()): Project { const result = migrateProject(input); if (!result.ok) throw Error(result.problems.map(p => `${p.path}:${p.message}`).join(';')); return result.value; }

describe('manga format6 migration and ownership', () => {
  it('keeps all original IDs, transforms, text, numbering and input immutable', () => {
    const old = fixture(), before = structuredClone(old), next = upgraded(old);
    expect(old).toEqual(before); expect(next.schemaVersion).toBe(9); expect(next.nextPanelNumber).toBe(old.nextPanelNumber);
    expect(next.pages).toEqual(old.pages); expect(next.assets).toEqual(old.assets);
    const original = Object.values(old.layers).find(l => l.type === 'bubble') as BubbleLayer;
    const bubble = next.layers[original.id] as BubbleLayer;
    expect(bubble).not.toHaveProperty('tail'); expect(bubble.matrix).toEqual(original.matrix);
    expect(mainBubbleText(next, bubble.id)?.text.content).toBe('对白😀\n第二行');
    const tail = bubbleTails(next, bubble.id)[0];
    expect(tail.parentId).toBe(bubble.id); expect(tail.tip).toEqual(original.tail!.tip);
    expect(tail.attachment).toEqual({ mode: 'bubble', attachU: .65, baseWidth: 24 }); expect(tail.legacySplice).toBe(true);
    const oldSfx = Object.values(old.layers).find(l => l.type === 'decoration'); if (oldSfx?.type !== 'decoration' || oldSfx.spec.kind !== 'sfx') throw Error('sfx');
    const text = next.layers[oldSfx.id]; if (text.type !== 'text') throw Error('migration');
    expect(text.role).toBe('sfx'); expect(text.matrix).toEqual(oldSfx.matrix); expect(text.text.content).toBe(oldSfx.spec.content);
    expect(text.effects?.recipe).toBe('legacy-sfx-v5'); expect(text.effects?.outlineColor).toBe('#FFFFFF80');
    expect(migrateProject(next)).toEqual({ ok: true, value: next });
  });
  it('generates a deterministic UUID and resolves a collision against every identity domain', () => {
    const p = fixture(), bubble = Object.values(p.layers).find(l => l.type === 'bubble')!;
    const collision = migrationId(`legacy-tail:${bubble.id}`); p.id = collision;
    const a = upgraded(p), b = upgraded(p); expect(a).toEqual(b);
    expect(bubbleTails(a, bubble.id)[0].id).toBe(migrationId(`legacy-tail:${bubble.id}:1`));
  });
  it('finds main text after a tail and restores a missing text draft without discarding tails', () => {
    const p = upgraded(), bubble = Object.values(p.layers).find(l => l.type === 'bubble') as BubbleLayer;
    bubble.children.reverse(); const text = mainBubbleText(p, bubble.id)!;
    expect(text.text.content).toBe('对白😀\n第二行'); expect(bubbleTails(p, bubble.id)).toHaveLength(1);
    expect(validateProject(p).ok).toBe(true);
  });
  it.each([
    (_p: Project, b: BubbleLayer) => { b.tail = null; },
    (p: Project, b: BubbleLayer) => { bubbleTails(p, b.id)[0].matrix = [1,0,0,1,1,0]; },
    (p: Project, b: BubbleLayer) => { bubbleTails(p, b.id)[0].parentId = null; },
    (_p: Project, b: BubbleLayer) => { b.children.push(b.children[0]); },
    (p: Project, b: BubbleLayer) => { const t = mainBubbleText(p, b.id)!; t.role = 'sfx'; t.effects = { outlineColor: '#FFFFFFFF', outlineWidth: 3, shearDeg: 0, deformation: 'none', amount: 0, cycles: 1, recipe: 'layout' }; },
  ])('rejects conflicting/invalid ownership without modifying the input (%#)', mutate => {
    const p = upgraded(), b = Object.values(p.layers).find(l => l.type === 'bubble') as BubbleLayer; mutate(p, b);
    const before = structuredClone(p); expect(validateProject(p).ok).toBe(false); expect(p).toEqual(before);
  });
  it('rejects a fifth tail and preserves the document in the validator', () => {
    const p = upgraded(), b = Object.values(p.layers).find(l => l.type === 'bubble') as BubbleLayer;
    for (let i=1; i<5; i++) { const tail = structuredClone(bubbleTails(p,b.id)[0]); tail.id = migrationId(`test-tail-${i}`); p.layers[tail.id] = tail; b.children.push(tail.id); }
    const result = validateProject(p); expect(result.ok).toBe(false); if (!result.ok) expect(result.problems.some(r => r.code === 'bubble/tail-count')).toBe(true);
  });
  it('allows the last owned tail edge at depth17 but rejects a seventeenth content level', () => {
    const p = upgraded(), b = Object.values(p.layers).find(l => l.type === 'bubble') as BubbleLayer;
    const rootIndex = p.pages[b.pageId].roots.indexOf(b.id);
    let parent: GroupLayer | null = null;
    for (let i=0; i<15; i++) { const g=createLayer('group',b.pageId) as GroupLayer; p.layers[g.id]=g; if(parent){parent.children=[g.id];g.parentId=parent.id;}else p.pages[b.pageId].roots[rootIndex]=g.id; parent=g; }
    parent!.children=[b.id]; b.parentId=parent!.id;
    const text=mainBubbleText(p,b.id)!; b.children=b.children.filter(id=>id!==text.id); delete p.layers[text.id];
    expect(validateProject(p).ok).toBe(true);
    const g=createLayer('group',b.pageId) as GroupLayer; g.parentId=parent!.id;g.children=[b.id];p.layers[g.id]=g;parent!.children=[g.id];b.parentId=g.id;
    expect(validateProject(p).ok).toBe(false);
  });
  it('validates a dialogue tree and rejects references to another group or cycles', () => {
    const p=upgraded(), pageId=p.pageOrder[0], first=Object.values(p.layers).find(l=>l.type==='bubble') as BubbleLayer;
    const group=createLayer('group',pageId) as GroupLayer, second=structuredClone(first), third=structuredClone(first);
    second.id=migrationId('second');second.children=[];third.id=migrationId('third');third.children=[];
    for(const b of [first,second,third]){b.parentId=group.id;p.layers[b.id]=b;}
    group.children=[first.id,second.id,third.id];group.dialogue={mode:'fused',links:[{from:first.id,to:second.id,width:24,bend:0},{from:second.id,to:third.id,width:24,bend:0}],fusionStyle:first.style,seamRadius:4,overlapOpacity:.65,fusionPressure:.15,seed:0};
    p.layers[group.id]=group;p.pages[pageId].roots=p.pages[pageId].roots.map(id=>id===first.id?group.id:id);
    expect(validateProject(p).ok).toBe(true);
    group.dialogue.links[1].to=first.id;expect(validateProject(p).ok).toBe(false);
    group.dialogue.links[1].to=p.pages[pageId].roots[0];expect(validateProject(p).ok).toBe(false);
    group.dialogue.links[1].to=third.id;group.dialogue.overlapOpacity=Number.NaN;expect(validateProject(p).ok).toBe(false);
  });
  it('does not reject 5000 existing content layers because migration adds an owned tail', () => {
    const p=fixture(), pageId=p.pageOrder[0];
    const content=Object.values(p.layers).filter(l=>l.type!=='pageBackground').length;
    for(let i=content;i<5000;i++){const g=createLayer('group',pageId) as GroupLayer;p.layers[g.id]=g;p.pages[pageId].roots.push(g.id);}
    const next=upgraded(p);expect(Object.keys(next.layers)).toHaveLength(5002);expect(validateProject(next).ok).toBe(true);
    const extra=createLayer('group',pageId) as GroupLayer;next.layers[extra.id]=extra;next.pages[pageId].roots.push(extra.id);expect(validateProject(next).ok).toBe(false);
  });
  it('rejects a future version while retaining the old input', () => {
    const p=fixture(), raw={...p,schemaVersion:8}, snapshot=structuredClone(raw);
    expect(migrateProject(raw).ok).toBe(false);expect(raw).toEqual(snapshot);
  });
  it('rejects free tails without a valid free base/style and bound tails masquerading as roots', () => {
    const p=upgraded(), id=p.pageOrder[0], t=createLayer('bubbleTail',id) as BubbleTailLayer;p.layers[t.id]=t;p.pages[id].roots.push(t.id);
    expect(validateProject(p).ok).toBe(true);t.style=null;expect(validateProject(p).ok).toBe(false);
    t.attachment={mode:'bubble',attachU:.5,baseWidth:24};expect(validateProject(p).ok).toBe(false);
  });
});
