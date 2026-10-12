import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';
import cross from './playwright.cross-browser.config';
const multi = process.env.COMIA_PANEL_BINDING_BROWSER === 'cross', port = multi ? 5191 : 5190;
export default defineConfig({ ...base, testDir: '../e2e', ...(multi ? { projects: cross.projects, testMatch: ['panelBinding.spec.ts','panelBindingWorkflow.spec.ts','materials.spec.ts','boundaryRendering.spec.ts','crop.spec.ts','panelTools.spec.ts','scenePlan.spec.ts','export.spec.ts','previewBudget.spec.ts'] } : {}), use: { ...(multi ? cross.use : base.use), baseURL: `http://127.0.0.1:${port}` }, webServer: { cwd: '../..', command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 30_000 } });
