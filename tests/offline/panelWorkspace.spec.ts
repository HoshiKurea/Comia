import { expect,test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { menuCommand,waitForProjectIO } from '../e2e/menuHelpers';
test('offline production restores floating panels and saves/opens artwork without serializing workspace layout',async({page,context})=>{
 await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined}));await page.goto('/');await expect.poll(()=>page.evaluate(async()=>{await navigator.serviceWorker.ready;return !!navigator.serviceWorker.controller;})).toBe(true);
 const root=(await page.locator('.panel-workspace').boundingBox())!,tab=(await page.getByRole('tab',{name:'素材库',exact:true}).boundingBox())!;await page.mouse.move(tab.x+20,tab.y+15);await page.mouse.down();await page.mouse.move(root.x+430,root.y+140,{steps:16});await page.mouse.up();
 await expect(page.locator('.panel-floating .asset-library')).toBeVisible();await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('comia.panel-layout.v2')??'{}').floating?.length)).toBe(1);
 const layout=await page.evaluate(()=>JSON.parse(localStorage.getItem('comia.panel-layout.v2')!));await context.setOffline(true);await page.reload();await expect(page.locator('.panel-floating .asset-library')).toBeVisible();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('comia.panel-layout.v2')!))).toEqual(layout);await page.getByRole('button',{name:'矩形分镜',exact:true}).click();
 const download=page.waitForEvent('download');await (await menuCommand(page,'保存')).click();const file=await download,path=(await file.path())!,data=JSON.parse(await readFile(path,'utf8'));expect(data.project.panelLayout).toBeUndefined();expect(data.project.settings.panelLayout).toBeUndefined();
 await page.getByLabel('打开项目文件',{exact:true}).setInputFiles(path);await waitForProjectIO(page);await expect(page.locator('.layer-row[data-layer-type="panel"]')).toHaveCount(1);await expect(page.locator('.panel-floating .asset-library')).toBeVisible();
 const image=page.waitForEvent('download');await (await menuCommand(page,'PNG')).click();expect((await readFile((await (await image).path())!)).byteLength).toBeGreaterThan(1000);
});
