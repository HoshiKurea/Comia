import { createBenchmark } from './createBenchmark';
import { createLayer } from '../../../src/domain/factories';
import type { BubbleLayer, BubbleTailLayer, GroupLayer, Id, ImageLayer, TextLayer } from '../../../src/domain/types';
import { handDrawnPreset } from '../../../src/bubbles/handDrawn';
import { composeBubble } from '../../../src/bubbles/composeBubble';
import { closestTailU } from '../../../src/bubbles/tailCommands';
import { tailAnchors } from '../../../src/bubbles/tailGeometry';
import { SFX_PRESETS } from '../../../src/text/sfxPresets';
import { mangaLayerCounts } from '../../../src/domain/mangaCounts';
import { numberFixture } from '../../helpers/numberFixture';
import { validateProject } from '../../../src/domain/validate';
import { awaitFonts } from '../../../src/text/fonts';
export async function createMangaBenchmark(){
  const fixture=await createBenchmark(true),p=fixture.project;p.name='日式气泡性能20页';p.layers={};p.nextPanelNumber=1;
  const assets=Object.values(p.assets),targets:{pageId:Id;node:Id;tail:Id;fusionMember:Id;overlap:Id;sfx:Id}[]=[];
  for(const [pageIndex,pid] of p.pageOrder.entries()){
    const page=p.pages[pid];page.roots=[];
    const put=(layer:ReturnType<typeof createLayer>,parent:GroupLayer|null=null)=>{p.layers[layer.id]=layer;layer.parentId=parent?.id??null;if(parent)parent.children.push(layer.id);else page.roots.push(layer.id);return layer;};
    const ordinary=put(createLayer('group',pid)) as GroupLayer;ordinary.matrix=[1,.08,.1,.9,80,80];
    const body=(x:number,y:number,parent:GroupLayer|null,hand=false)=>{
      const b=createLayer('bubble',pid) as BubbleLayer;b.matrix=[1,0,0,1,x,y];b.width=280;b.height=180;b.style.fill=pageIndex%2?'#F2F8FFFF':'#FFFFFFD0';b.style.borderWidth=3;
      if(hand){b.shape='handOval';b.handDrawn=handDrawnPreset('soft',42);}
      put(b,parent);const g=composeBubble(p,b.id);if(!g.ok)throw Error(JSON.stringify(g));const t=createLayer('text',pid) as TextLayer;t.parentId=b.id;t.box=g.value.textBox;t.text.content=`第${pageIndex+1}页连续对白。`+'用于检查漫画编辑与字形的一致性。'.repeat(10);t.text.font.size=28;t.text.align='center';b.children=[t.id];p.layers[t.id]=t;return b;
    };
    let fusionMember='',overlap='';
    for(const [i,mode] of(['connector','fused','fused','overlap'] as const).entries()){
      const group=createLayer('group',pid) as GroupLayer;put(group,i===1?ordinary:null);group.matrix=[1,0,0,1,60,60+i*230];
      const members=[0,1,2].map(j=>body(j*205,j*8,group,i===2));group.dialogue={mode,links:members.slice(1).map((b,j)=>({from:members[j].id,to:b.id,width:24,bend:0})),seamRadius:4,overlapOpacity:.65,fusionStyle:{...members[2].style},fusionPressure:.15,seed:42};if(i===1)fusionMember=members[1].id;if(i===3)overlap=group.id;
    }
    const hands=[0,1,2].map(i=>body(60+i*350,1150,null,true)),node=hands[0];node.contour={nodes:Array.from({length:32},(_,i)=>({x:.5+.46*Math.cos(i*Math.PI/16),y:.5+.46*Math.sin(i*Math.PI/16)})),tension:.2};
    const tail=createLayer('bubbleTail',pid) as BubbleTailLayer;tail.parentId=node.id;tail.matrix=[1,0,0,1,0,0];tail.style=null;tail.stroke=null;tail.appearance='curved';tail.tip={x:190,y:300};const u=closestTailU(node,tail.tip);if(!u.ok)throw Error(JSON.stringify(u));tail.attachment={mode:'bubble',attachU:u.value.u,baseWidth:24};const a=tailAnchors(tail,node);if(!a.ok)throw Error(JSON.stringify(a));tail.route={kind:'spline',c1:{x:a.value.base.x+10,y:a.value.base.y+40},c2:{x:210,y:265}};node.children.push(tail.id);p.layers[tail.id]=tail;
    const panel=createLayer('panel',pid);if(panel.type!=='panel')throw Error('panel');panel.matrix=[1,0,0,1,700,1700];panel.geometry=[{x:0,y:0},{x:400,y:0},{x:400,y:300},{x:0,y:300}];put(panel);
    for(let i=0;i<8;i++){const image=createLayer('image',pid) as ImageLayer,imageAsset=assets[i];Object.assign(image,{assetId:imageAsset.id,width:1600,height:1200,matrix:[.15,0,0,.15,60+i%4*330,1500+Math.floor(i/4)*300]});if(i===0){image.parentId=panel.id;image.matrix=[.3,0,0,.3,0,0];image.panelClip={mode:'partial',region:{shape:'ellipse',geometry:[{x:0,y:0},{x:1600,y:0},{x:1600,y:1200},{x:0,y:1200}],matrix:[1,0,0,1,0,0]}};panel.children=[image.id];p.layers[image.id]=image;}else put(image);}
    let sfx='';for(let i=0;i<6;i++){const t=createLayer('text',pid) as TextLayer;t.role='sfx';t.effects={...SFX_PRESETS[i%4].effects};t.text.content=`第${pageIndex+1}页 `+SFX_PRESETS[i%4].sample;t.text.font.size=96;t.text.font.bold=true;t.box={x:0,y:0,width:600,height:180};t.matrix=[1,0,0,1,60+i%3*640,2300+Math.floor(i/3)*260];put(t);if(i===0)sfx=t.id;}
    const content=Object.fromEntries(Object.entries(p.layers).filter(([,l])=>l.pageId===pid));if(mangaLayerCounts({...p,layers:content}).content!==50)throw Error(`第${pageIndex+1}页必须恰好50逻辑层`);
    targets.push({pageId:pid,node:node.id,tail:tail.id,fusionMember,overlap,sfx});
  }
  numberFixture(p);const valid=validateProject(p);if(!valid.ok)throw Error(JSON.stringify(valid));const fonts=await awaitFonts(p);if(!fonts.ok)throw Error(JSON.stringify(fonts));return {...fixture,project:p,targets};
}
