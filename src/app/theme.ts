import { sessionStore, pushNotice } from '../state/sessionStore';
import { updatePreference } from '../preferences/store';
export type ThemePreference = 'light' | 'dark' | 'system';
let media: MediaQueryList | null = null;
export function resolveTheme(): 'light' | 'dark' {
  const theme = sessionStore.getState().theme;
  return theme === 'system' ? (media?.matches ?? window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light' : theme;
}
function apply(): void { document.documentElement.dataset.theme = resolveTheme(); }
export function setTheme(theme: ThemePreference): void {
  if (!['light', 'dark', 'system'].includes(theme)) return;
  const result=updatePreference('theme',theme);if(!result.ok)pushNotice('info',result.problems[0].message);
}
export function setSnap16(enabled: boolean): void {
  const result=updatePreference('snap16',enabled);if(!result.ok)pushNotice('info',result.problems[0].message);
}
export function installTheme(): () => void {
  media = window.matchMedia('(prefers-color-scheme: dark)');
  apply(); media.addEventListener('change', apply);
  const current = media;
  return () => { current.removeEventListener('change', apply); if (media === current) media = null; };
}
