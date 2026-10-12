import { defineConfig } from '@playwright/test';
import cross from './playwright.cross-browser.config';
export default defineConfig({ ...cross, testMatch: 'projectWorkspaceNative.spec.ts', projects: cross.projects?.filter(p => p.name !== 'webkit'), workers: 1, use: { ...cross.use, baseURL: 'http://127.0.0.1:5193' }, webServer: { cwd: '../..', command: 'npm run dev -- --host 127.0.0.1 --port 5193 --strictPort', url: 'http://127.0.0.1:5193', reuseExistingServer: false, timeout: 30_000 } });
