import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';
export default defineConfig({...base, testDir: '../e2e',use:{...base.use,baseURL:'http://127.0.0.1:5193'},webServer: { cwd: '../..',command:'npm run dev -- --host 127.0.0.1 --port 5193 --strictPort',url:'http://127.0.0.1:5193',reuseExistingServer:false,timeout:30_000}});
