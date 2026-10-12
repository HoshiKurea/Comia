import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';
import cross from './playwright.cross-browser.config';
const multi = process.env.COMIA_PANEL_BROWSER === 'cross';
const port = multi ? 5191 : 5190;
export default defineConfig({
  ...base, testDir: '../e2e',
  ...(multi ? { projects: cross.projects, testMatch: [...cross.testMatch as string[], 'panelTools.spec.ts', 'pageBackground.spec.ts'] } : {}),
  use: { ...(multi ? cross.use : base.use), baseURL: `http://127.0.0.1:${port}` },
  // A clean module graph avoids HMR-tagged store modules versus test dynamic imports.
  // Never restart the user's 5173 server or manipulate their editor context.
  webServer: { cwd: '../..', command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 30_000 },
});
