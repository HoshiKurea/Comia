import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../e2e',
  testMatch: ['crop.spec.ts', 'materials.spec.ts', 'componentLibrary.spec.ts', 'accessibility.spec.ts', 'workflow.spec.ts', 'previewLifecycle.spec.ts', 'previewBudget.spec.ts', 'bubbleGeometry.spec.ts', 'bubbleTailGeometry.spec.ts', 'pointerLifecycle.spec.ts', 'panelGeometry.spec.ts', 'bubbleTextRelation.spec.ts', 'viewportGestures.spec.ts', 'selectionMovement.spec.ts', 'boundaryRendering.spec.ts', 'documentLifecycle.spec.ts', 'imageLifecycle.spec.ts', 'componentFidelity.spec.ts', 'responsive.spec.ts', 'focusReturn.spec.ts', 'scenePlan.spec.ts', 'auditGaps.spec.ts', 'textEditing.spec.ts', 'textLayoutUI.spec.ts', 'export.spec.ts', 'exportRecovery.spec.ts', 'importBoundary.spec.ts', 'verticalGlyphs.spec.ts', 'directory.spec.ts'],
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:5173', viewport: { width: 1440, height: 900 } },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', channel: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: { cwd: '../..', command: 'npm run dev -- --host 127.0.0.1 --port 5173', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 30_000 },
});
