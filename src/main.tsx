import React from 'react';
import { createRoot } from 'react-dom/client';
import { EditorShell } from './app/EditorShell';
import './app/styles.css';
import './app/theme.css';
import { registerOfflineShell } from './offline/register';
import { awaitFonts, resolveFont } from './text/fonts';
import { DEFAULT_FONT_FAMILY } from './domain/factories';
import { documentStore } from './state/documentStore';
import { pushNotice } from './state/sessionStore';
import { installBlobRepository } from './storage/blobRepository';
import { installPreferences } from './preferences/store';

const root = document.getElementById('root');
if (!root) throw new Error('Comia root element missing');
installBlobRepository();
installPreferences();
createRoot(root).render(<React.StrictMode><EditorShell /></React.StrictMode>);
void registerOfflineShell();
void resolveFont(DEFAULT_FONT_FAMILY).catch((error) => pushNotice('error', `本地字体加载失败：${String(error)}`));
const reportedFonts = new Set<string>();
documentStore.subscribe((next, old) => {
  if (next.project === old.project) return;
  void awaitFonts(next.project).then((result) => {
    if (!result.ok) { pushNotice('error', result.problems[0].message); return; }
    for (const font of result.value) if (font.fallback && !reportedFonts.has(font.requested)) {
      reportedFonts.add(font.requested); pushNotice('info', `找不到字体“${font.requested}”，显示使用“${font.actual}”；项目中仍保留原字体名称`);
    }
  });
});
