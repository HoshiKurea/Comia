import { defineConfig } from '@playwright/test';
import base from './playwright.comic-drawing.config';
export default defineConfig({ ...base, outputDir: '../../output/comic-drawing/performance-results', testMatch: ['comicDrawingPerformance.spec.ts'], use: { ...base.use, baseURL: 'http://127.0.0.1:5239' }, webServer: { cwd: '../..', env: { COMIA_VITE_CACHE_DIR: 'node_modules/.vite-comic-performance' }, command: 'npm run dev -- --host 127.0.0.1 --port 5239 --strictPort', url: 'http://127.0.0.1:5239', reuseExistingServer: false, timeout: 30000 } });
