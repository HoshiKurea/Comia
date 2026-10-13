import type { ShortcutOverrides } from '../commands/types';
export interface AppPreferences {version:1;generation:string;theme:'system'|'light'|'dark';snap16:boolean;showPanelNumbers:boolean;showManuscriptGuides:boolean;exportScale:0.25|0.5|1|2|4;shortcuts:ShortcutOverrides}
export interface PreferencesDraft {baseGeneration:string;value:AppPreferences}
export type EditablePreferenceKey='theme'|'snap16'|'showPanelNumbers'|'showManuscriptGuides'|'exportScale';
