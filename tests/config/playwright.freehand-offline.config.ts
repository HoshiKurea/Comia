import {defineConfig} from '@playwright/test';
import base from './playwright.offline.config';
export default defineConfig({...base,testMatch:['freehandWindow.spec.ts','bubblesCrop.spec.ts'],workers:1,retries:0,timeout:90000,outputDir:'../../output/playwright/freehand-offline',reporter:[['list'],['json',{outputFile:'../../output/freehand-offline.json'}]],use:{...base.use,baseURL:'http://127.0.0.1:4252'},webServer:{cwd:'../..',command:'npm run preview -- --host 127.0.0.1 --port 4252 --strictPort',url:'http://127.0.0.1:4252',reuseExistingServer:false,timeout:30000}});
