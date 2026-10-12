export type MenuEntry =
  | { kind: 'separator'; id: string }
  | { kind: 'action'; id: string; label: string; shortcut?: string; ariaShortcut?:string; disabledReason: string | null; run: () => void | Promise<void> }
  | { kind: 'check' | 'radio'; id: string; label: string; shortcut?:string; ariaShortcut?:string; checked: boolean | (() => boolean); disabledReason: string | null; run: () => void }
  | { kind: 'submenu'; id: string; label: string; disabledReason: string | null; entries: MenuEntry[] };
export interface EditorMenu { id: 'file' | 'edit' | 'layer' | 'page' | 'view' | 'window'; label: string; entries: MenuEntry[] }
