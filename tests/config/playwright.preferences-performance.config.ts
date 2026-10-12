import {defineConfig} from '@playwright/test';
const dpr=Number(process.env.COMIA_PREFERENCES_DPR??1);
export default defineConfig({testDir:'../performance',testMatch:'globalPreferences.spec.ts',timeout:90000,workers:1,retries:0,outputDir:`../../output/playwright/preferences-performance-dpr${dpr}`,use:{baseURL:'http://127.0.0.1:5204',browserName:'chromium',channel:'msedge',viewport:{width:1440,height:900},deviceScaleFactor:dpr},webServer: { cwd: '../..',command:'npm run dev -- --host 127.0.0.1 --port 5204 --strictPort',url:'http://127.0.0.1:5204',reuseExistingServer:false,timeout:30000}});
