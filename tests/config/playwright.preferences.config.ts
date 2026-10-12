import {defineConfig} from '@playwright/test';
import base from '../../playwright.config';
import cross from './playwright.cross-browser.config';
const multi=process.env.COMIA_PREFERENCES_BROWSER==='cross',port=multi?5203:5202;
export default defineConfig({...base, testDir: '../e2e',...(multi?{projects:cross.projects}:{}),workers:2,retries:0,outputDir:`../../output/playwright/preferences-${multi?'cross':'edge'}`,use:{...(multi?cross.use:base.use),baseURL:`http://127.0.0.1:${port}`},webServer: { cwd: '../..',command:`npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,url:`http://127.0.0.1:${port}`,reuseExistingServer:false,timeout:30000}});
