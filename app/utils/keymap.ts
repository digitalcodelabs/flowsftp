export type KeymapAction =
  | 'toggleView'
  | 'switchToTerminal'
  | 'switchToFiles'
  | 'nextSession'
  | 'prevSession'

export interface KeymapSettings {
  toggleView: string
  switchToTerminal: string
  switchToFiles: string
  nextSession: string
  prevSession: string
}

export interface KeymapMeta {
  id: KeymapAction
  title: string
  description: string
  category: 'view' | 'connections'
  defaultShortcut: string
}

export const DEFAULT_KEYMAPS: KeymapSettings = {
  toggleView: 'Ctrl+`',
  switchToTerminal: 'Alt+1',
  switchToFiles: 'Alt+2',
  nextSession: 'Ctrl+Tab',
  prevSession: 'Ctrl+Shift+Tab',
}

export const KEYMAP_ACTIONS_META: KeymapMeta[] = [
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
]

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
    description: 'Ctrl+Tab for tabs, Ctrl+` to toggle view, Alt+1/2 for direct views',
    keymaps: {
      toggleView: 'Ctrl+`',
      switchToTerminal: 'Alt+1',
      switchToFiles: 'Alt+2',
      nextSession: 'Ctrl+Tab',
      prevSession: 'Ctrl+Shift+Tab',
    },
  },
  {
    id: 'alt',
    name: 'Alt-Based',
    description: 'Ctrl+Tab for tabs, Alt+T to toggle view, Alt+1/2 for direct views',
    keymaps: {
      toggleView: 'Alt+T',
      switchToTerminal: 'Alt+1',
      switchToFiles: 'Alt+2',
      nextSession: 'Ctrl+Tab',
      prevSession: 'Ctrl+Shift+Tab',
    },
  },
  {
    id: 'function',
    name: 'Function Keys',
    description: 'Ctrl+Tab for tabs, F4 to toggle view, F1/F3 for direct views',
    keymaps: {
      toggleView: 'F4',
      switchToTerminal: 'F1',
      switchToFiles: 'F3',
      nextSession: 'Ctrl+Tab',
      prevSession: 'Ctrl+Shift+Tab',
    },
  },
]

export function normalizeKey(key: string): string {
  const k = key.trim().toLowerCase()
  if (k === '`' || k === 'backquote' || k === '~' || k === 'dead') return '`'
  if (k === 'esc' || k === 'escape') return 'escape'
  if (k === 'pagedown' || k === 'pgdn') return 'pagedown'
  if (k === 'pageup' || k === 'pgup') return 'pageup'
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

  // KeyCode fallback for international keyboards / dead keys / Windows WebView2
  if ((event.keyCode === 192 || event.key === 'Dead') && targetKey === '`') return true
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
    'prevSession', // Check prevSession (Ctrl+Shift+Tab) before nextSession (Ctrl+Tab)
    'nextSession',
    'toggleView',
    'switchToTerminal',
    'switchToFiles',
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
  } else if (event.key === ' ') {
    keyName = 'Space'
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
  if (el.isContentEditable) return true
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
