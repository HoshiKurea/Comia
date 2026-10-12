import {defineConfig} from '@playwright/test';
const dpr=Number(process.env.COMIA_AREA_DPR??1);
export default defineConfig({testDir:'../performance',testMatch:'areaSelection.spec.ts',workers:1,retries:0,timeout:90000,outputDir:`../../output/playwright/area-selection-performance-dpr${dpr}`,use:{baseURL:'http://127.0.0.1:5216',browserName:'chromium',channel:'msedge',viewport:{width:1440,height:900},deviceScaleFactor:dpr},webServer: { cwd: '../..',command:'npm run dev -- --host 127.0.0.1 --port 5216 --strictPort',url:'http://127.0.0.1:5216',reuseExistingServer:false,timeout:30000}});
