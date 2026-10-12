import { defineConfig } from '@playwright/test';
const dpr=Number(process.env.COMIA_MANGA_DPR??1);
export default defineConfig({testDir:'../performance',testMatch:'mangaBubbles.spec.ts',timeout:120_000,workers:1,retries:0,use:{baseURL:'http://127.0.0.1:5192',browserName:'chromium',channel:'msedge',viewport:{width:1440,height:900},deviceScaleFactor:dpr},webServer: { cwd: '../..',command:'npm run dev -- --host 127.0.0.1 --port 5192 --strictPort',url:'http://127.0.0.1:5192',reuseExistingServer:false,timeout:30_000}});
