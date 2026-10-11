import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import {
  DEFAULT_KEYMAPS,
  KEYMAP_PRESETS,
  type KeymapSettings,
  type KeymapAction,
} from '../utils/keymap'

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

  // Keyboard Shortcuts Settings
  const loadSavedKeymaps = (): KeymapSettings => {
    if (typeof window === 'undefined') return { ...DEFAULT_KEYMAPS }
    try {
      const saved = localStorage.getItem('flowsftp_keymaps')
      if (saved) {
        return { ...DEFAULT_KEYMAPS, ...JSON.parse(saved) }
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
    resetTerminalDefaults,
    resetBrowserDefaults,
  }
})
