import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../performance', testMatch: 'speedBrush.spec.ts', timeout: 60_000, workers: 1, retries: 0,
  use: { baseURL: 'http://127.0.0.1:5196', browserName: 'chromium', channel: 'msedge', viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(process.env.COMIA_BRUSH_DPR ?? 1) },
  webServer: { cwd: '../..', command: 'npm run dev -- --host 127.0.0.1 --port 5196 --strictPort', url: 'http://127.0.0.1:5196', reuseExistingServer: false, timeout: 30_000 },
});
