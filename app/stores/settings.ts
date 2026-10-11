import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import {
  DEFAULT_KEYMAPS,
  KEYMAP_PRESETS,
  type KeymapSettings,
  type KeymapAction,
} from '../utils/keymap'

export interface SystemFont {
  name: string
  is_monospace: boolean
}

export interface TerminalFontOption {
  label: string
  value: string
}

export interface BrowserFontOption {
  label: string
  value: string
}

export const TERMINAL_FONTS: TerminalFontOption[] = [
  {
    label: 'JetBrains Mono',
    value: '"JetBrains Mono", ui-monospace, monospace',
  },
  {
    label: 'Fira Code',
    value: '"Fira Code", ui-monospace, monospace',
  },
  {
    label: 'Cascadia Code / Consolas',
    value: '"Cascadia Code", Consolas, ui-monospace, monospace',
  },
  {
    label: 'Consolas',
    value: 'Consolas, "Lucida Console", monospace',
  },
  {
    label: 'Menlo / Monaco',
    value: 'Menlo, Monaco, "Courier New", monospace',
  },
  {
    label: 'System Monospace',
    value: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
  {
    label: 'Courier New',
    value: '"Courier New", Courier, monospace',
  },
]

export const BROWSER_FONTS: BrowserFontOption[] = [
  {
    label: 'Inter (Modern Sans)',
    value: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  {
    label: 'System UI',
    value: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  {
    label: 'JetBrains Mono (Monospace)',
    value: '"JetBrains Mono", ui-monospace, monospace',
  },
  {
    label: 'Fira Code (Monospace)',
    value: '"Fira Code", ui-monospace, monospace',
  },
  {
    label: 'Segoe UI',
    value: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
  },
  {
    label: 'Roboto',
    value: 'Roboto, -apple-system, BlinkMacSystemFont, sans-serif',
  },
]

export const DEFAULT_TRANSFER_IGNORE_PATTERNS: string[] = [
  '.git',
  'node_modules',
  '.vscode',
  '.idea',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'target',
  '.cache',
  '.turbo',
  'vendor',
  '__pycache__',
  '.DS_Store',
  'Thumbs.db',
  '*.swp',
  '*.tmp',
  '*.log',
]

export const useSettingsStore = defineStore('settings', () => {
  // Terminal Font Settings
  const terminalFontFamily = ref<string>(
    typeof window !== 'undefined'
      ? localStorage.getItem('flowsftp_terminal_font') ||
        '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
      : '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
  )

  const terminalFontSize = ref<number>(
    typeof window !== 'undefined'
      ? Number(localStorage.getItem('flowsftp_terminal_font_size')) || 13
      : 13
  )

  const terminalLineHeight = ref<number>(
    typeof window !== 'undefined'
      ? Number(localStorage.getItem('flowsftp_terminal_line_height')) || 1.25
      : 1.25
  )

  // File Browser (FTP Preview) Font Settings
  const browserFontFamily = ref<string>(
    typeof window !== 'undefined'
      ? localStorage.getItem('flowsftp_browser_font') ||
        'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      : 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  )

  const browserFontSize = ref<number>(
    typeof window !== 'undefined'
      ? Number(localStorage.getItem('flowsftp_browser_font_size')) || 12
      : 12
  )

  const browserRowDensity = ref<'compact' | 'normal' | 'relaxed'>(
    typeof window !== 'undefined'
      ? (localStorage.getItem('flowsftp_browser_density') as any) || 'normal'
      : 'normal'
  )

  // Installed System Fonts
  const systemFonts = ref<SystemFont[]>([])
  const isLoadingSystemFonts = ref<boolean>(false)

  async function loadSystemFonts() {
    if (systemFonts.value.length > 0) return
    isLoadingSystemFonts.value = true
    try {
      const fonts = await invoke<SystemFont[]>('get_system_fonts')
      if (Array.isArray(fonts) && fonts.length > 0) {
        systemFonts.value = fonts
      }
    } catch (err) {
      console.warn('Failed to load system fonts:', err)
    } finally {
      isLoadingSystemFonts.value = false
    }
  }

  if (typeof window !== 'undefined') {
    loadSystemFonts()
  }

  // Keyboard Shortcuts Settings
  const loadSavedKeymaps = (): KeymapSettings => {
    if (typeof window === 'undefined') return { ...DEFAULT_KEYMAPS }
    try {
      const saved = localStorage.getItem('flowsftp_keymaps')
      if (saved) {
        const parsed = JSON.parse(saved)
        // If older version stored transferCopy as F5, migrate transferCopy to Alt+F5 and ensure refresh is F5
        if (parsed.transferCopy === 'F5' && !parsed.refresh) {
          parsed.transferCopy = 'Alt+F5'
          parsed.refresh = 'F5'
        }
        if (!parsed.refresh) {
          parsed.refresh = DEFAULT_KEYMAPS.refresh
        }
        return { ...DEFAULT_KEYMAPS, ...parsed }
      }
    } catch (e) {
      console.warn('Failed to parse saved keymaps:', e)
    }
    return { ...DEFAULT_KEYMAPS }
  }

  const keymaps = ref<KeymapSettings>(loadSavedKeymaps())

  // Code Editor Settings (CodeMirror 6)
  const editorVimMode = ref<boolean>(
    typeof window !== 'undefined'
      ? localStorage.getItem('flowsftp_editor_vim_mode') !== 'false'
      : true
  )

  const editorFontSize = ref<number>(
    typeof window !== 'undefined'
      ? Number(localStorage.getItem('flowsftp_editor_font_size')) || 13
      : 13
  )

  // External Editor Preferences
  const preferredExternalEditor = ref<string>(
    typeof window !== 'undefined'
      ? localStorage.getItem('flowsftp_external_editor') || 'default'
      : 'default'
  )
  const customExternalEditorCommand = ref<string>(
    typeof window !== 'undefined'
      ? localStorage.getItem('flowsftp_custom_external_editor') || ''
      : ''
  )

  // Persist to localStorage on change
  if (typeof window !== 'undefined') {
    watch(preferredExternalEditor, (val) => {
      localStorage.setItem('flowsftp_external_editor', val)
    })
    watch(customExternalEditorCommand, (val) => {
      localStorage.setItem('flowsftp_custom_external_editor', val)
    })
    watch(terminalFontFamily, (val) => {
      localStorage.setItem('flowsftp_terminal_font', val)
    })
    watch(terminalFontSize, (val) => {
      localStorage.setItem('flowsftp_terminal_font_size', String(val))
    })
    watch(terminalLineHeight, (val) => {
      localStorage.setItem('flowsftp_terminal_line_height', String(val))
    })
    watch(browserFontFamily, (val) => {
      localStorage.setItem('flowsftp_browser_font', val)
    })
    watch(browserFontSize, (val) => {
      localStorage.setItem('flowsftp_browser_font_size', String(val))
    })
    watch(browserRowDensity, (val) => {
      localStorage.setItem('flowsftp_browser_density', val)
    })
    watch(editorVimMode, (val) => {
      localStorage.setItem('flowsftp_editor_vim_mode', val ? 'true' : 'false')
    })
    watch(editorFontSize, (val) => {
      localStorage.setItem('flowsftp_editor_font_size', String(val))
    })
    watch(
      keymaps,
      (val) => {
        localStorage.setItem('flowsftp_keymaps', JSON.stringify(val))
      },
      { deep: true }
    )
  }

  // Intelligent Ignore Filtering for Transfers & Directory Crawling
  const enableTransferIgnoreFilter = ref<boolean>(
    typeof window !== 'undefined'
      ? localStorage.getItem('flowsftp_enable_transfer_ignore') !== 'false'
      : true
  )

  const loadSavedIgnorePatterns = (): string[] => {
    if (typeof window === 'undefined') return [...DEFAULT_TRANSFER_IGNORE_PATTERNS]
    try {
      const saved = localStorage.getItem('flowsftp_transfer_ignore_patterns')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed
        }
      }
    } catch (e) {
      console.warn('Failed to parse saved transfer ignore patterns:', e)
    }
    return [...DEFAULT_TRANSFER_IGNORE_PATTERNS]
  }

  const transferIgnorePatterns = ref<string[]>(loadSavedIgnorePatterns())

  // Global Settings Modal Open State
  const isSettingsModalOpen = ref<boolean>(false)
  const settingsModalTab = ref<'themes' | 'appearance' | 'keymap' | 'transfers' | 'security' | 'protocols' | 'developer' | 'about'>('transfers')

  if (typeof window !== 'undefined') {
    watch(enableTransferIgnoreFilter, (val) => {
      localStorage.setItem('flowsftp_enable_transfer_ignore', val ? 'true' : 'false')
    })
    watch(
      transferIgnorePatterns,
      (val) => {
        localStorage.setItem('flowsftp_transfer_ignore_patterns', JSON.stringify(val))
      },
      { deep: true }
    )
  }

  function openSettings(tab?: 'themes' | 'appearance' | 'keymap' | 'transfers' | 'security' | 'protocols' | 'developer' | 'about') {
    if (tab) {
      settingsModalTab.value = tab
    }
    isSettingsModalOpen.value = true
  }

  function closeSettings() {
    isSettingsModalOpen.value = false
  }

  function addIgnorePattern(pattern: string): boolean {
    const clean = pattern.trim()
    if (!clean) return false
    const lower = clean.toLowerCase()
    if (!transferIgnorePatterns.value.some((p) => p.toLowerCase() === lower)) {
      transferIgnorePatterns.value = [...transferIgnorePatterns.value, clean]
      return true
    }
    return false
  }

  function removeIgnorePattern(pattern: string) {
    const lower = pattern.trim().toLowerCase()
    transferIgnorePatterns.value = transferIgnorePatterns.value.filter(
      (p) => p.toLowerCase() !== lower
    )
  }

  function resetIgnorePatterns() {
    transferIgnorePatterns.value = [...DEFAULT_TRANSFER_IGNORE_PATTERNS]
  }

  function isPatternIgnored(name: string, relOrFullPath?: string): boolean {
    if (!enableTransferIgnoreFilter.value || transferIgnorePatterns.value.length === 0) {
      return false
    }
    const nameLower = name.trim().toLowerCase()
    const pathLower = (relOrFullPath || name).replace(/\\/g, '/').toLowerCase()
    const parts = pathLower.split('/').filter(Boolean)

    for (const rawPat of transferIgnorePatterns.value) {
      const pat = rawPat.trim().replace(/^\/+/, '').toLowerCase()
      if (!pat) continue

      if (nameLower === pat || parts.includes(pat)) {
        return true
      }

      if (
        pathLower === pat ||
        pathLower.startsWith(`${pat}/`) ||
        pathLower.endsWith(`/${pat}`) ||
        pathLower.includes(`/${pat}/`)
      ) {
        return true
      }

      if (pat.startsWith('*.')) {
        const ext = pat.slice(1) // '.log'
        if (nameLower.endsWith(ext) || pathLower.endsWith(ext)) {
          return true
        }
      } else if (pat.startsWith('*')) {
        const suffix = pat.slice(1)
        if (nameLower.endsWith(suffix) || pathLower.endsWith(suffix)) {
          return true
        }
      } else if (pat.endsWith('*')) {
        const prefix = pat.slice(0, -1)
        if (nameLower.startsWith(prefix) || pathLower.startsWith(prefix)) {
          return true
        }
      }
    }
    return false
  }

  function resetTerminalDefaults() {
    terminalFontFamily.value = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    terminalFontSize.value = 13
    terminalLineHeight.value = 1.25
  }

  function resetBrowserDefaults() {
    browserFontFamily.value = 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    browserFontSize.value = 12
    browserRowDensity.value = 'normal'
  }

  function updateKeymap(action: KeymapAction, shortcut: string) {
    keymaps.value = {
      ...keymaps.value,
      [action]: shortcut,
    }
  }

  function resetKeymapAction(action: KeymapAction) {
    keymaps.value = {
      ...keymaps.value,
      [action]: DEFAULT_KEYMAPS[action],
    }
  }

  function resetAllKeymaps() {
    keymaps.value = { ...DEFAULT_KEYMAPS }
  }

  function applyKeymapPreset(presetId: 'default' | 'alt' | 'function') {
    const p = KEYMAP_PRESETS.find((preset) => preset.id === presetId)
    if (p) {
      keymaps.value = { ...p.keymaps }
    }
  }

  return {
    terminalFontFamily,
    terminalFontSize,
    terminalLineHeight,
    browserFontFamily,
    browserFontSize,
    browserRowDensity,
    editorVimMode,
    editorFontSize,
    preferredExternalEditor,
    customExternalEditorCommand,
    keymaps,
    updateKeymap,
    resetKeymapAction,
    resetAllKeymaps,
    applyKeymapPreset,
    systemFonts,
    isLoadingSystemFonts,
    loadSystemFonts,
    resetTerminalDefaults,
    resetBrowserDefaults,
    enableTransferIgnoreFilter,
    transferIgnorePatterns,
    addIgnorePattern,
    removeIgnorePattern,
    resetIgnorePatterns,
    isPatternIgnored,
    isSettingsModalOpen,
    settingsModalTab,
    openSettings,
    closeSettings,
  }
})
