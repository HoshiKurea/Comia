import { defineConfig } from '@playwright/test';
import base from './playwright.offline.config';
export default defineConfig({ ...base, testMatch: ['manuscript.spec.ts', 'projectMenus.spec.ts'], timeout: 90000, workers: 1,
  projects: [{ name: 'edge-dpr1', use: { deviceScaleFactor: 1 } }, { name: 'edge-dpr2', use: { deviceScaleFactor: 2 } }],
  use: { ...base.use, baseURL: 'http://127.0.0.1:4257' }, webServer: { cwd: '../..', command: 'npm run preview -- --host 127.0.0.1 --port 4257 --strictPort', url: 'http://127.0.0.1:4257', reuseExistingServer: false, timeout: 30000 } });
