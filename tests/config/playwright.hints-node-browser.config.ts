import {defineConfig} from '@playwright/test';
import base from '../../playwright.config';
import cross from './playwright.cross-browser.config';
export default defineConfig({...base, testDir: '../e2e',projects:cross.projects,testMatch:['hintsNodeGuides.spec.ts','componentLibrary.spec.ts','mangaWorkflows.spec.ts'],workers:1,retries:0,outputDir:'../../output/playwright/hints-node-cross-complete',use:{...cross.use,baseURL:'http://127.0.0.1:5213'},webServer: { cwd: '../..',command:'npm run dev -- --host 127.0.0.1 --port 5213 --strictPort',url:'http://127.0.0.1:5213',reuseExistingServer:false,timeout:30000}});
