import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';
import cross from './playwright.cross-browser.config';
const multi=process.env.COMIA_BUBBLE_BROWSER==='cross',port=multi?5222:5221;
export default defineConfig({ ...base, testDir: '../e2e', ...(multi?{projects:cross.projects}:{}), testMatch:['bubbleCopyConsistency.spec.ts','bubbleCropDelivery.spec.ts','mangaContours.spec.ts','mangaBubbles.spec.ts','mangaWorkflows.spec.ts','mangaPersistence.spec.ts','mangaMigration.spec.ts','bubbleGeometry.spec.ts','bubbleTailGeometry.spec.ts','bubbleTextRelation.spec.ts','textLayoutUI.spec.ts','bubbleBrush.spec.ts','imageTrim.spec.ts','bubbleFrameEditing.spec.ts','cutInsertion.spec.ts','imageSourceWindow.spec.ts','panelTools.spec.ts','panelOptimization.spec.ts','integratedTools.spec.ts'], workers:2,retries:0,
  outputDir:`../../output/playwright/bubbles-crop-${multi?'cross':'edge'}`,
  reporter:[['list'],['json',{outputFile:`../../output/audit/bubbles-crop-${multi?'cross':'edge'}${process.env.COMIA_BUBBLE_REPORT_TAG??''}.json`}]],
  use:{...(multi?cross.use:base.use),baseURL:`http://127.0.0.1:${port}`},
  webServer: { cwd: '../..',command:`npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,url:`http://127.0.0.1:${port}`,reuseExistingServer:false,timeout:30000},
});
