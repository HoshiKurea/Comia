import { parkFloatingControls } from './floatingHelpers';
import { test, expect, type Page } from '@playwright/test';
import { menuCommand } from './menuHelpers';
import type { Project } from '../../src/domain/types';

async function fixture(page:Page,format6=false){
  await page.goto('/');await expect(page.locator('.canvas-viewport')).toBeVisible();
  await page.evaluate(async format6=>{
    const {createProject,createLayer}=await import('/src/'+'domain/factories.ts'),{replaceDocument}=await import('/src/'+'history/commandBus.ts'),{sessionStore}=await import('/src/'+'state/sessionStore.ts'),{migrateProject}=await import('/src/'+'storage/migrateProject.ts'),{awaitFonts}=await import('/src/'+'text/fonts.ts');
    const p=createProject(),pageId=p.pageOrder[0],b=createLayer('bubble',pageId);if(b.type!=='bubble')throw Error('bubble');if(!format6)p.schemaVersion=5;b.matrix=[1,0,0,1,120,70];b.style.fill='#FFFFFF80';b.style.borderColor='#00000080';Object.assign(p.pages[pageId],{width:640,height:480});p.layers[b.id]=b;p.pages[pageId].roots.push(b.id);
    const next=format6?migrateProject(p):{ok:true as const,value:p};if(!next.ok)throw Error(next.problems[0].message);const fonts=await awaitFonts(next.value);if(!fonts.ok)throw Error(fonts.problems[0].message);const result=replaceDocument(next.value);if(!result.ok)throw Error(result.problems[0].message);
    sessionStore.setState({selection:[b.id],activePageId:pageId,toolMode:'select',snap16:false,viewportByPage:{[pageId]:{zoom:1,pan:{x:20,y:20}}}});
  },format6);
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));});
}
async function state(page:Page):Promise<{project:Project;past:number;preview:Project|null;main:number;gesture:number;active:boolean}>{
  return page.evaluate(async()=>{await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));const {getDocument}=await import('/src/'+'state/documentStore.ts'),{runtimeStore}=await import('/src/'+'state/runtimeStore.ts');const d=getDocument(),r=runtimeStore.getState();return{project:d.project,past:d.history.past.length,preview:r.previewProject,main:r.renderStats.mainDraws,gesture:r.renderStats.gestureDraws,active:r.gestureActive};});
}
test('hand-drawn node drag uses only preview, completes one transaction, and undo restores the entire legacy document',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await fixture(page);const before=await state(page);
  await page.getByRole('button',{name:'柔和手绘',exact:true}).click();await expect(page.getByLabel('气泡轮廓节点 1',{exact:true})).toBeVisible();await parkFloatingControls(page);const box=await page.getByLabel('气泡轮廓节点 1',{exact:true}).boundingBox();if(!box)throw Error('node');
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.evaluate(async()=>{(await import('/src/'+'state/runtimeStore.ts')).resetRenderStats();});
  await page.mouse.move(box.x+box.width/2+12,box.y+box.height/2+8,{steps:24});const during=await state(page);expect(during.project).toEqual(before.project);expect(during.past).toBe(before.past);expect(during.main).toBe(0);expect(during.gesture).toBeGreaterThan(0);expect(during.preview?.schemaVersion).toBe(13);
  await page.mouse.up();await page.screenshot({path:'output/playwright/manga-handdrawn-editor.png'});await page.getByRole('button',{name:'完成漫画组件编辑',exact:true}).click();const after=await state(page);expect(after.past).toBe(before.past+1);expect(after.active).toBe(false);
  const bubble=Object.values(after.project.layers).find(l=>l.type==='bubble');expect(bubble?.type).toBe('bubble');if(bubble?.type==='bubble')expect(bubble.contour?.nodes).toHaveLength(12);
  await (await menuCommand(page,'撤销')).click();expect((await state(page)).project).toEqual(before.project);expect(errors).toEqual([]);
});
test('Escape cancels the whole hand-drawn preview with no history change',async({page})=>{
  await fixture(page);const before=await state(page);await page.getByRole('button',{name:'粗糙速写',exact:true}).click();await expect(page.getByLabel('气泡轮廓节点 1',{exact:true})).toBeVisible();await page.locator('.canvas-viewport').focus();await page.keyboard.press('Escape');const after=await state(page);expect(after.project).toEqual(before.project);expect(after.past).toBe(before.past);expect(after.preview).toBeNull();expect(after.active).toBe(false);
});
test('a real bound-tail layer can be selected, dragged independently, and undone once without moving its body',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await fixture(page,true);await page.getByRole('button',{name:'三角尾',exact:true}).click();await expect(page.locator('[data-layer-type="bubbleTail"] .layer-name')).toBeVisible();await page.locator('[data-layer-type="bubbleTail"] .layer-name').click();await expect(page.getByLabel('尾巴尖端')).toBeVisible();const before=await state(page),tail=Object.values(before.project.layers).find(l=>l.type==='bubbleTail'),body=Object.values(before.project.layers).find(l=>l.type==='bubble');if(tail?.type!=='bubbleTail'||body?.type!=='bubble')throw Error('tail');
  const box=await page.getByLabel('尾巴尖端').boundingBox();if(!box)throw Error('tip');const start={x:box.x+box.width/2,y:box.y+box.height/2};await page.mouse.move(start.x,start.y);await page.mouse.down();await page.evaluate(async()=>{(await import('/src/'+'state/runtimeStore.ts')).resetRenderStats();});await page.mouse.move(start.x+12,start.y+20,{steps:24});const during=await state(page);expect(during.project).toEqual(before.project);expect(during.preview?.layers[body.id]).toEqual(body);expect(during.main).toBe(0);expect(during.gesture).toBeGreaterThan(0);
  await page.mouse.up();const after=await state(page);expect(after.past).toBe(before.past+1);expect(after.project.layers[body.id]).toEqual(body);const moved=after.project.layers[tail.id];if(moved.type!=='bubbleTail')throw Error('tail');expect(moved.tip.x).toBeCloseTo(tail.tip.x+12,5);expect(moved.tip.y).toBeCloseTo(tail.tip.y+20,5);
  await (await menuCommand(page,'撤销')).click();expect((await state(page)).project).toEqual(before.project);expect(errors).toEqual([]);
});
