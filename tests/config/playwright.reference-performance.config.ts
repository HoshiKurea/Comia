import {defineConfig} from '@playwright/test';
import base from './playwright.reference-properties.config';
export default defineConfig({...base,grep:/style slider/,workers:1,use:{...base.use,baseURL:'http://127.0.0.1:5236'},webServer:{cwd:'../..',command:'npm run dev -- --host 127.0.0.1 --port 5236 --strictPort',url:'http://127.0.0.1:5236',reuseExistingServer:false,timeout:30000}});
