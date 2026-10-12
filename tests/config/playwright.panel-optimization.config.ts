import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';
import cross from './playwright.cross-browser.config';

const multi = process.env.COMIA_OPT_BROWSER === 'cross';
export default defineConfig({
  ...base, testDir: '../e2e',
  ...(multi ? { projects: cross.projects, testMatch: ['panelOptimization.spec.ts', 'panelTools.spec.ts', 'panelBinding.spec.ts', 'crop.spec.ts', 'materials.spec.ts', 'mangaBubbles.spec.ts', 'textEditing.spec.ts', 'responsive.spec.ts'] } : {}),
  use: { ...(multi ? cross.use : base.use), baseURL: 'http://127.0.0.1:5193' },
  retries: 0,
  webServer: { cwd: '../..', command: 'npm run dev -- --host 127.0.0.1 --port 5193 --strictPort', url: 'http://127.0.0.1:5193', reuseExistingServer: false, timeout: 30_000 },
});
