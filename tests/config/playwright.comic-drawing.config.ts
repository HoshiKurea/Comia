import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';
export default defineConfig({ ...base, testDir: '../e2e', outputDir: '../../output/comic-drawing/browser-results', testMatch: ['comicDrawing.spec.ts'], workers: 1, timeout: 60000,
  use: { ...base.use, baseURL: 'http://127.0.0.1:5238' }, projects: [{ name: 'edge-dpr1', use: { deviceScaleFactor: 1 } }, { name: 'edge-dpr2', use: { deviceScaleFactor: 2 } }],
  webServer: { cwd: '../..', env: { COMIA_VITE_CACHE_DIR: 'node_modules/.vite-comic-drawing' }, command: 'npm run dev -- --host 127.0.0.1 --port 5238 --strictPort', url: 'http://127.0.0.1:5238', reuseExistingServer: false, timeout: 30000 } });
