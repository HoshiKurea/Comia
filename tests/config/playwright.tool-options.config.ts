import {defineConfig} from '@playwright/test';
import base from '../../playwright.config';
import cross from './playwright.cross-browser.config';
const multi=process.env.COMIA_TOOLS_BROWSER==='cross',port=multi?5218:5217;
export default defineConfig({...base, testDir: '../e2e',...(multi?{projects:cross.projects}:{}),testMatch:['integratedTools.spec.ts','areaSelection.spec.ts','selectionFeedback.spec.ts','materials.spec.ts','panelTools.spec.ts'],workers:2,retries:0,outputDir:`../../output/playwright/tool-options-${multi?'cross':'edge'}`,reporter:[['list'],['json',{outputFile:`../../output/audit/tool-options-${multi?'cross':'edge'}.json`}]],use:{...(multi?cross.use:base.use),baseURL:`http://127.0.0.1:${port}`},webServer: { cwd: '../..',command:`npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,url:`http://127.0.0.1:${port}`,reuseExistingServer:false,timeout:30000}});
