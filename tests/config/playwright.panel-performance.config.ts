import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'../performance',testMatch:'panelWorkspace.spec.ts',timeout:90000,workers:1,retries:0,outputDir:`../../output/playwright/panel-performance-dpr${process.env.COMIA_PANELS_DPR??1}`,
 use:{baseURL:'http://127.0.0.1:5200',browserName:'chromium',channel:'msedge',viewport:{width:1440,height:900},deviceScaleFactor:Number(process.env.COMIA_PANELS_DPR??1)},
 webServer: { cwd: '../..',command:'npm run dev -- --host 127.0.0.1 --port 5200 --strictPort',url:'http://127.0.0.1:5200',reuseExistingServer:false,timeout:30000}});
