export type KeymapAction =
  | 'openKeymap'
  | 'toggleView'
  | 'switchToTerminal'
  | 'switchToFiles'
  | 'nextSession'
  | 'prevSession'
  | 'togglePane'
  | 'editPath'
  | 'refresh'
  | 'transferCopy'
  | 'transferMove'
  | 'newFolder'
  | 'deleteFiles'
  | 'navBack'
  | 'navForward'
  | 'navUp'

export interface KeymapSettings {
  openKeymap: string
  toggleView: string
  switchToTerminal: string
  switchToFiles: string
  nextSession: string
  prevSession: string
  togglePane: string
  editPath: string
  refresh: string
  transferCopy: string
  transferMove: string
  newFolder: string
  deleteFiles: string
  navBack: string
  navForward: string
  navUp: string
}

export interface KeymapMeta {
  id: KeymapAction
  title: string
  description: string
  category: 'view' | 'connections' | 'fileManager'
  defaultShortcut: string
}

export const DEFAULT_KEYMAPS: KeymapSettings = {
  openKeymap: 'Ctrl+,',
  toggleView: 'Ctrl+`',
  switchToTerminal: 'Alt+1',
  switchToFiles: 'Alt+2',
  nextSession: 'Ctrl+Tab',
  prevSession: 'Ctrl+Shift+Tab',
  togglePane: 'Tab',
  editPath: 'Ctrl+L',
  refresh: 'F5',
  transferCopy: 'Alt+F5',
  transferMove: 'F6',
  newFolder: 'F7',
  deleteFiles: 'F8',
  navBack: 'Alt+Left',
  navForward: 'Alt+Right',
  navUp: 'Backspace',
}

export const KEYMAP_ACTIONS_META: KeymapMeta[] = [
  {
    id: 'openKeymap',
    title: 'Open Settings / Keymaps',
    description: 'Open Settings dialog directly to Keymap & Shortcuts tab (Ctrl+,)',
    category: 'view',
    defaultShortcut: DEFAULT_KEYMAPS.openKeymap,
  },
  {
    id: 'toggleView',
    title: 'Toggle Terminal / Files',
    description: 'Quickly toggle between active SSH terminal and SFTP/FTP file manager',
    category: 'view',
    defaultShortcut: DEFAULT_KEYMAPS.toggleView,
  },
  {
    id: 'switchToTerminal',
    title: 'Switch to Terminal',
    description: 'Directly focus and open the interactive SSH shell',
    category: 'view',
    defaultShortcut: DEFAULT_KEYMAPS.switchToTerminal,
  },
  {
    id: 'switchToFiles',
    title: 'Switch to Files',
    description: 'Directly open the SFTP / FTP file browser',
    category: 'view',
    defaultShortcut: DEFAULT_KEYMAPS.switchToFiles,
  },
  {
    id: 'nextSession',
    title: 'Next Connection Tab',
    description: 'Switch to the next active connection tab (e.g. Ctrl+Tab)',
    category: 'connections',
    defaultShortcut: DEFAULT_KEYMAPS.nextSession,
  },
  {
    id: 'prevSession',
    title: 'Previous Connection Tab',
    description: 'Switch to the previous active connection tab (e.g. Ctrl+Shift+Tab)',
    category: 'connections',
    defaultShortcut: DEFAULT_KEYMAPS.prevSession,
  },
  {
    id: 'togglePane',
    title: 'Switch Active Pane (Tab)',
    description: 'Toggle active focus between Local and Remote file browser panes',
    category: 'fileManager',
    defaultShortcut: DEFAULT_KEYMAPS.togglePane,
  },
  {
    id: 'editPath',
    title: 'Focus Address Bar / Breadcrumbs',
    description: 'Jump to breadcrumb path bar and select full path for direct typing (Ctrl+L)',
    category: 'fileManager',
    defaultShortcut: DEFAULT_KEYMAPS.editPath,
  },
  {
    id: 'refresh',
    title: 'Refresh Directory Listing (F5)',
    description: 'Reload file list from disk or remote server (F5, Ctrl+R, or Ctrl+F5 for both)',
    category: 'fileManager',
    defaultShortcut: DEFAULT_KEYMAPS.refresh,
  },
  {
    id: 'transferCopy',
    title: 'Copy / Transfer to Other Pane (Alt+F5)',
    description: 'Upload local files or download remote files to opposite pane',
    category: 'fileManager',
    defaultShortcut: DEFAULT_KEYMAPS.transferCopy,
  },
  {
    id: 'transferMove',
    title: 'Move to Other Pane (F6)',
    description: 'Transfer selected files to opposite pane and delete from source',
    category: 'fileManager',
    defaultShortcut: DEFAULT_KEYMAPS.transferMove,
  },
  {
    id: 'newFolder',
    title: 'New Folder (F7)',
    description: 'Create a new directory in the active pane',
    category: 'fileManager',
    defaultShortcut: DEFAULT_KEYMAPS.newFolder,
  },
  {
    id: 'deleteFiles',
    title: 'Delete Selected (F8 / Delete)',
    description: 'Delete selected files or folders in the active pane',
    category: 'fileManager',
    defaultShortcut: DEFAULT_KEYMAPS.deleteFiles,
  },
  {
    id: 'navBack',
    title: 'Navigate Back (Alt+Left)',
    description: 'Go to previously visited folder in active pane',
    category: 'fileManager',
    defaultShortcut: DEFAULT_KEYMAPS.navBack,
  },
  {
    id: 'navForward',
    title: 'Navigate Forward (Alt+Right)',
    description: 'Go to next visited folder in active pane history',
    category: 'fileManager',
    defaultShortcut: DEFAULT_KEYMAPS.navForward,
  },
  {
    id: 'navUp',
    title: 'Go to Parent Directory (Backspace)',
    description: 'Navigate up to the containing parent folder (..)',
    category: 'fileManager',
    defaultShortcut: DEFAULT_KEYMAPS.navUp,
  },
]

export const FILE_MANAGER_ACTIONS: KeymapAction[] = [
  'togglePane',
  'editPath',
  'refresh',
  'transferCopy',
  'transferMove',
  'newFolder',
  'deleteFiles',
  'navBack',
  'navForward',
  'navUp',
]

export function isFileManagerAction(action: KeymapAction): boolean {
  return FILE_MANAGER_ACTIONS.includes(action)
}

export interface KeymapPreset {
  id: 'default' | 'alt' | 'function'
  name: string
  description: string
  keymaps: KeymapSettings
}

export const KEYMAP_PRESETS: KeymapPreset[] = [
  {
    id: 'default',
    name: 'Modern (Default)',
    description: 'F5 refresh, Ctrl+Tab for tabs, Tab for pane toggle, F6-F8 dual-pane shortcuts',
    keymaps: {
      ...DEFAULT_KEYMAPS,
    },
  },
  {
    id: 'alt',
    name: 'Alt-Based',
    description: 'Alt+T view toggle, Tab for pane toggle, F5 refresh, F6-F8 dual-pane shortcuts',
    keymaps: {
      ...DEFAULT_KEYMAPS,
      toggleView: 'Alt+T',
    },
  },
  {
    id: 'function',
    name: 'Function Keys',
    description: 'F4 view toggle, F1 terminal, F3 files, F5 refresh, Tab for pane toggle',
    keymaps: {
      ...DEFAULT_KEYMAPS,
      toggleView: 'F4',
      switchToTerminal: 'F1',
      switchToFiles: 'F3',
    },
  },
]

export function normalizeKey(key: string): string {
  const k = key.trim().toLowerCase()
  if (k === '`' || k === 'backquote' || k === '~' || k === 'dead') return '`'
  if (k === 'esc' || k === 'escape') return 'escape'
  if (k === 'pagedown' || k === 'pgdn') return 'pagedown'
  if (k === 'pageup' || k === 'pgup') return 'pageup'
  if (k === 'left' || k === 'arrowleft') return 'arrowleft'
  if (k === 'right' || k === 'arrowright') return 'arrowright'
  if (k === 'up' || k === 'arrowup') return 'arrowup'
  if (k === 'down' || k === 'arrowdown') return 'arrowdown'
  if (k === 'comma' || k === ',') return ','
  return k
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  if (!shortcut || !shortcut.trim()) return false

  const parts = shortcut.split('+').map((p) => p.trim())
  if (parts.length === 0) return false

  const hasCtrl = parts.some((p) => {
    const pl = p.toLowerCase()
    return pl === 'ctrl' || pl === 'control'
  })
  const hasAlt = parts.some((p) => p.toLowerCase() === 'alt')
  const hasShift = parts.some((p) => p.toLowerCase() === 'shift')
  const hasMeta = parts.some((p) => {
    const pl = p.toLowerCase()
    return pl === 'meta' || pl === 'cmd' || pl === 'command'
  })

  // Verify modifiers
  if (Boolean(event.ctrlKey) !== hasCtrl) return false
  if (Boolean(event.altKey) !== hasAlt) return false
  if (Boolean(event.shiftKey) !== hasShift) return false
  if (Boolean(event.metaKey) !== hasMeta) return false

  // The actual key is the non-modifier token
  const keyParts = parts.filter((p) => {
    const pl = p.toLowerCase()
    return (
      pl !== 'ctrl' &&
      pl !== 'control' &&
      pl !== 'alt' &&
      pl !== 'shift' &&
      pl !== 'meta' &&
      pl !== 'cmd' &&
      pl !== 'command'
    )
  })

  if (keyParts.length !== 1) return false
  const targetKey = normalizeKey(keyParts[0])

  const eventKey = normalizeKey(event.key || '')
  const eventCode = normalizeKey(event.code || '')

  // Exact key match
  if (eventKey === targetKey) return true

  // Code match (e.g. Digit1 vs 1, KeyT vs t, Backquote vs `)
  if (eventCode === targetKey) return true
  if (eventCode.startsWith('digit') && eventCode.replace('digit', '') === targetKey) return true
  if (eventCode.startsWith('key') && eventCode.replace('key', '') === targetKey) return true
  if (eventCode === 'backquote' && targetKey === '`') return true
  if (eventCode === 'comma' && targetKey === ',') return true

  // KeyCode fallback for international keyboards / dead keys / Windows WebView2
  if ((event.keyCode === 192 || event.key === 'Dead') && targetKey === '`') return true
  if (event.keyCode === 188 && targetKey === ',') return true
  if (event.keyCode === 9 && targetKey === 'tab') return true
  if (event.keyCode === 49 && targetKey === '1') return true
  if (event.keyCode === 50 && targetKey === '2') return true

  return false
}

export function getKeymapAction(
  event: KeyboardEvent,
  keymaps: KeymapSettings
): KeymapAction | null {
  // Support both reactive Pinia refs and unwrapped objects
  const km: KeymapSettings = (
    keymaps && typeof keymaps === 'object' && 'value' in keymaps
      ? (keymaps as any).value
      : keymaps
  ) || DEFAULT_KEYMAPS

  // Check in priority order
  const actions: KeymapAction[] = [
    'openKeymap',
    'prevSession', // Check prevSession (Ctrl+Shift+Tab) before nextSession (Ctrl+Tab)
    'nextSession',
    'toggleView',
    'switchToTerminal',
    'switchToFiles',
    'editPath',
    'refresh',
    'navBack',
    'navForward',
    'navUp',
    'transferCopy',
    'transferMove',
    'newFolder',
    'deleteFiles',
    'togglePane',
  ]

  for (const action of actions) {
    const shortcut = km[action]
    if (shortcut && matchesShortcut(event, shortcut)) {
      return action
    }
  }

  return null
}

export function formatEventToShortcut(
  event: KeyboardEvent
): { shortcut: string | null; isModifierOnly: boolean; display: string } {
  const isMod =
    event.key === 'Control' ||
    event.key === 'Shift' ||
    event.key === 'Alt' ||
    event.key === 'Meta'

  const modifiers: string[] = []
  if (event.ctrlKey) modifiers.push('Ctrl')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (event.metaKey) modifiers.push('Cmd')

  if (isMod) {
    return {
      shortcut: null,
      isModifierOnly: true,
      display: modifiers.length > 0 ? modifiers.join('+') + '+...' : '',
    }
  }

  // Non-modifier key
  let keyName = event.key
  if (event.code === 'Backquote' || event.key === '`' || event.key === '~' || event.keyCode === 192) {
    keyName = '`'
  } else if (event.code.startsWith('Digit')) {
    keyName = event.code.replace('Digit', '')
  } else if (event.code.startsWith('Key')) {
    keyName = event.code.replace('Key', '').toUpperCase()
  } else if (event.key === ' ' || event.code === 'Space') {
    keyName = 'Space'
  } else if (event.key === 'ArrowLeft' || event.code === 'ArrowLeft') {
    keyName = 'Left'
  } else if (event.key === 'ArrowRight' || event.code === 'ArrowRight') {
    keyName = 'Right'
  } else if (event.key === 'ArrowUp' || event.code === 'ArrowUp') {
    keyName = 'Up'
  } else if (event.key === 'ArrowDown' || event.code === 'ArrowDown') {
    keyName = 'Down'
  } else if (event.key === 'Backspace' || event.code === 'Backspace') {
    keyName = 'Backspace'
  } else if (event.key === 'Tab' || event.code === 'Tab') {
    keyName = 'Tab'
  } else if (event.code === 'Comma' || event.key === ',') {
    keyName = ','
  } else if (/^f[1-9][0-2]?$/i.test(keyName)) {
    keyName = keyName.toUpperCase()
  } else if (keyName.length === 1) {
    keyName = keyName.toUpperCase()
  }

  const parts = [...modifiers, keyName]
  const shortcut = parts.join('+')

  return {
    shortcut,
    isModifierOnly: false,
    display: shortcut,
  }
}

export function splitShortcutParts(shortcut: string): string[] {
  if (!shortcut) return []
  return shortcut.split('+').map((p) => p.trim())
}

export function isNormalEditable(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false

  // Any element inside the SSH terminal is NOT a regular text input
  if (
    el.classList.contains('xterm-helper-textarea') ||
    Boolean(el.closest('.xterm')) ||
    Boolean(el.closest('.terminal'))
  ) {
    return false
  }

  const tag = el.tagName.toLowerCase()
  if (tag === 'textarea') return true
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type?.toLowerCase()
    return !['checkbox', 'radio', 'button', 'submit', 'range', 'reset'].includes(type)
  }
  if (el.isContentEditable || Boolean(el.closest('.cm-editor'))) return true
  return false
}

// Global Keymap Event Bus
type KeymapListener = (action: KeymapAction) => void
const keymapListeners = new Set<KeymapListener>()

export function onKeymapAction(fn: KeymapListener): () => void {
  keymapListeners.add(fn)
  return () => {
    keymapListeners.delete(fn)
  }
}

export function emitKeymapAction(action: KeymapAction) {
  for (const fn of keymapListeners) {
    try {
      fn(action)
    } catch (err) {
      console.error('Error in keymap listener:', err)
    }
  }
}
