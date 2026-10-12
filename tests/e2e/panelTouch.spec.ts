import { expect,test } from '@playwright/test';
test('a second trusted touch cancels a panel drag without starting a secondary layout gesture',async({page,context})=>{
 await page.goto('/');const tab=(await page.getByRole('tab',{name:'素材库',exact:true}).boundingBox())!,root=(await page.locator('.panel-workspace').boundingBox())!;
 const before=await page.evaluate(async()=>({doc:(await import('/src/'+'state/documentStore.ts')).getDocument(),layout:(await import('/src/'+'workspacePanels/panelLayoutStore.ts')).panelLayoutStore.getState().layout}));
 const cdp=await context.newCDPSession(page),a={id:1,x:tab.x+20,y:tab.y+15},b={id:2,x:tab.x+25,y:tab.y+15};
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a]});a.x=root.x+440;a.y=root.y+150;await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[a]});await expect(page.getByTestId('panel-drag-ghost')).toBeVisible();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a,b]});await expect(page.getByTestId('panel-drag-ghost')).toHaveCount(0);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 expect(await page.evaluate(async()=>({doc:(await import('/src/'+'state/documentStore.ts')).getDocument(),layout:(await import('/src/'+'workspacePanels/panelLayoutStore.ts')).panelLayoutStore.getState().layout}))).toEqual(before);await cdp.detach();
});
