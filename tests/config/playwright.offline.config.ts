import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../offline',
  timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium', channel: 'msedge', viewport: { width: 1440, height: 900 } },
  webServer: { cwd: '../..', command: 'npm run preview -- --host 127.0.0.1 --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: true, timeout: 30_000 },
});
