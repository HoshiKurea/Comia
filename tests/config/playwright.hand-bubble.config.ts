import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';
export default defineConfig({ ...base, testDir: '../e2e', testMatch: ['handBubbleTool.spec.ts'], use: { ...base.use, baseURL: 'http://127.0.0.1:5231' }, projects: [{ name: 'edge-dpr1', use: { deviceScaleFactor: 1 } }, { name: 'edge-dpr2', use: { deviceScaleFactor: 2 } }], webServer: { cwd: '../..', command: 'npm run dev -- --host 127.0.0.1 --port 5231 --strictPort', url: 'http://127.0.0.1:5231', reuseExistingServer: false, timeout: 30000 } });
