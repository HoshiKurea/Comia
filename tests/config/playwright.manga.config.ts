import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';
import cross from './playwright.cross-browser.config';
const multi=process.env.COMIA_MANGA_BROWSER==='cross',port=multi?5191:5190;
export default defineConfig({...base, testDir: '../e2e',...(multi?{projects:cross.projects?.map(p=>p.name==='webkit'?{...p,grepInvert:/real native OPFS|two real touch points/}:p.name==='firefox'?{...p,grepInvert:/two real touch points/}:p)}:{}),testMatch:multi?['manga*.spec.ts','componentLibrary.spec.ts','componentFidelity.spec.ts','transforms.spec.ts','selectionMovement.spec.ts','focusReturn.spec.ts','textLayoutUI.spec.ts']:['manga*.spec.ts'],use:{...(multi?cross.use:base.use),baseURL:`http://127.0.0.1:${port}`},webServer: { cwd: '../..',command:`npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,url:`http://127.0.0.1:${port}`,reuseExistingServer:false,timeout:30_000}});
