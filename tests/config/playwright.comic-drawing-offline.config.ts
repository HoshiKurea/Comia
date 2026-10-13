import { defineConfig } from '@playwright/test';
import base from './playwright.offline.config';
export default defineConfig({ ...base, outputDir: '../../output/comic-drawing/offline-results', testMatch: ['comicDrawing.spec.ts'], workers: 1, timeout: 120000,
  projects: [{ name: 'edge-dpr1', use: { deviceScaleFactor: 1 } }, { name: 'edge-dpr2', use: { deviceScaleFactor: 2 } }],
  use: { ...base.use, baseURL: 'http://127.0.0.1:4258' }, webServer: { cwd: '../..', command: 'npm run preview -- --host 127.0.0.1 --port 4258 --strictPort', url: 'http://127.0.0.1:4258', reuseExistingServer: false, timeout: 30000 } });
