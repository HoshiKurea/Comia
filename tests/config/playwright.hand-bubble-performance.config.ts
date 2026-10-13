import { defineConfig } from '@playwright/test';
import base from './playwright.hand-bubble.config';
export default defineConfig({ ...base, testMatch: ['handBubblePerformance.spec.ts'], workers: 1, use: { ...base.use, baseURL: 'http://127.0.0.1:5232' }, webServer: { cwd: '../..', command: 'npm run dev -- --host 127.0.0.1 --port 5232 --strictPort', url: 'http://127.0.0.1:5232', reuseExistingServer: false, timeout: 30000 } });
