import { createProject, createLayer, createPage } from '../../src/domain/factories';
import { newId } from '../../src/domain/id';
import type { BubbleLayer, BubbleTailLayer, Project, TextLayer } from '../../src/domain/types';
import { handDrawnPreset } from '../../src/bubbles/handDrawn';
import { BASE_SFX_EFFECTS } from '../../src/text/sfxPresets';
import { composeBubble } from '../../src/bubbles/composeBubble';
import { validateProject } from '../../src/domain/validate';
/** Two real, distinct pages; no raster or geometry is serialized in this fixture. */
export function createMangaAcceptance():Project{
  const p=createProject({background:false}),pid=p.pageOrder[0];p.name='多页手绘对白验收';Object.assign(p.pages[pid],{width:800,height:720,dpi:300});
  for(const [row,mode] of (['fused','connector','overlap'] as const).entries()){
    const g=createLayer('group',pid);if(g.type!=='group')throw Error('group');g.name=`${mode} 对白`;g.dialogue={mode,links:[],seamRadius:4,overlapOpacity:.65,fusionStyle:{fill:'#0000FF80',borderColor:'#111111FF',borderWidth:2,radius:12},fusionPressure:0,seed:0};
    for(let i=0;i<2;i++){const b=createLayer('bubble',pid) as BubbleLayer;b.parentId=g.id;b.shape='rect';b.width=120;b.height=100;b.matrix=[1,0,0,1,50+(mode==='overlap'?60:200)*i,70+210*row];b.style={...b.style,fill:i?'#0000FF80':'#FF000080',borderWidth:2};const t=createLayer('text',pid) as TextLayer;t.parentId=b.id;t.text.content='';t.box={x:14,y:14,width:92,height:72};b.children=[t.id];g.children.push(b.id);p.layers[b.id]=b;p.layers[t.id]=t;}
    g.dialogue.links=[{from:g.children[0],to:g.children[1],width:24,bend:0}];p.layers[g.id]=g;p.pages[pid].roots.push(g.id);
  }
  const b=createLayer('bubble',pid) as BubbleLayer;b.shape='handOval';b.name='四尾手绘气泡';b.width=180;b.height=120;b.matrix=[1,0,0,1,490,80];b.handDrawn=handDrawnPreset('rough',0);b.style.fill='#00AA0080';
  const t=createLayer('text',pid) as TextLayer;t.parentId=b.id;t.text.content='手绘对白';t.text.font.size=24;b.children=[t.id];p.layers[b.id]=b;p.layers[t.id]=t;
  for(const appearance of ['triangle','thought','line','flat'] as const){const tail=createLayer('bubbleTail',pid) as BubbleTailLayer;tail.parentId=b.id;tail.matrix=[1,0,0,1,0,0];tail.style=null;tail.stroke=null;tail.appearance=appearance;tail.tip={x:117,y:180};tail.attachment={mode:'bubble',attachU:.26,baseWidth:18};p.layers[tail.id]=tail;b.children.push(tail.id);}
  const body=composeBubble(p,b.id);if(!body.ok)throw Error(JSON.stringify(body));t.box=body.value.textBox;p.pages[pid].roots.push(b.id);
  for(const [i,deformation] of (['arc','wave','impact'] as const).entries()){const s=createLayer('text',pid) as TextLayer;s.name=`${deformation} 声效字`;s.role='sfx';s.effects={...BASE_SFX_EFFECTS,deformation,amount:.35,shearDeg:12,outlineWidth:3};s.text.content=i===0?'ドン👩‍🚀':i===1?'しーん\n静默':'バキ!';s.text.font.size=48;s.box={x:0,y:0,width:240,height:150};s.matrix=[1,0,0,1,450,300+i*125];p.layers[s.id]=s;p.pages[pid].roots.push(s.id);}
  const page=createPage({width:800,height:720,dpi:300});p.pages[page.id]=page;p.pageOrder.push(page.id);page.name='第二页';
  const ids=Object.keys(p.layers),map=new Map(ids.map(id=>[id,newId()]));for(const id of ids){const layer=structuredClone(p.layers[id]);layer.id=map.get(id)!;layer.pageId=page.id;layer.parentId=layer.parentId?map.get(layer.parentId)!:null;if('children'in layer)layer.children=layer.children.map(id=>map.get(id)!);if(layer.type==='group'&&layer.dialogue)layer.dialogue.links=layer.dialogue.links.map(l=>({...l,from:map.get(l.from)!,to:map.get(l.to)!}));if(layer.type==='text'&&layer.role==='sfx')layer.text.content+=' 第二页';p.layers[layer.id]=layer;}page.roots=p.pages[pid].roots.map(id=>map.get(id)!);
  const valid=validateProject(p);if(!valid.ok)throw Error(JSON.stringify(valid));return valid.value;
}
