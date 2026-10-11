import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'

import defaultTheme from '../themes/default.json'
import tokyoNightTheme from '../themes/tokyo-night.json'
import draculaTheme from '../themes/dracula.json'
import catppuccinTheme from '../themes/catppuccin-mocha.json'
import catppuccinLatteTheme from '../themes/catppuccin-latte.json'
import nordTheme from '../themes/nord.json'
import oneDarkTheme from '../themes/one-dark.json'
import monokaiTheme from '../themes/monokai-pro.json'
import githubDarkTheme from '../themes/github-dark.json'
import githubLightTheme from '../themes/github-light.json'

export interface ThemeUiColors {
  bgApp: string
  bgHeader: string
  bgCard: string
  bgPane: string
  bgHover: string
  border: string
  borderActive: string
  textMain: string
  textMuted: string
  accent: string
  accentHover: string
  accentSecondary: string
}

export interface ThemeTerminalColors {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  selectionForeground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export interface AppTheme {
  id: string
  name: string
  description?: string
  author?: string
  isCustom?: boolean
  isLight?: boolean
  ui: ThemeUiColors
  terminal: ThemeTerminalColors
}

export const BUILT_IN_THEMES: AppTheme[] = [
  defaultTheme as AppTheme,
  tokyoNightTheme as AppTheme,
  draculaTheme as AppTheme,
  catppuccinTheme as AppTheme,
  catppuccinLatteTheme as AppTheme,
  nordTheme as AppTheme,
  oneDarkTheme as AppTheme,
  monokaiTheme as AppTheme,
  githubDarkTheme as AppTheme,
  githubLightTheme as AppTheme,
]

export function isLightTheme(theme?: AppTheme | null): boolean {
  if (!theme) return false
  if (typeof theme.isLight === 'boolean') {
    return theme.isLight
  }
  const hex = (theme.ui?.bgApp || '').replace('#', '')
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    const yiq = (r * 299 + g * 587 + b * 114) / 1000
    return yiq >= 128
  }
  return false
}

export function applyThemeToDom(theme: AppTheme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const isLight = isLightTheme(theme)

  if (isLight) {
    root.classList.remove('dark')
    root.classList.add('light')
    root.style.colorScheme = 'light'
  } else {
    root.classList.add('dark')
    root.classList.remove('light')
    root.style.colorScheme = 'dark'
  }

  root.style.setProperty('--color-bg-app', theme.ui.bgApp)
  root.style.setProperty('--color-bg-header', theme.ui.bgHeader)
  root.style.setProperty('--color-bg-card', theme.ui.bgCard)
  root.style.setProperty('--color-bg-pane', theme.ui.bgPane)
  root.style.setProperty('--color-bg-hover', theme.ui.bgHover)
  root.style.setProperty('--color-border', theme.ui.border)
  root.style.setProperty('--color-border-active', theme.ui.borderActive)
  root.style.setProperty('--color-text-main', theme.ui.textMain)
  root.style.setProperty('--color-text-muted', theme.ui.textMuted)
  root.style.setProperty('--color-accent', theme.ui.accent)
  root.style.setProperty('--color-accent-hover', theme.ui.accentHover)
  root.style.setProperty('--color-accent-secondary', theme.ui.accentSecondary)
  root.style.setProperty('--color-terminal-bg', theme.terminal.background)
  root.style.setProperty('--color-terminal-fg', theme.terminal.foreground)
  root.style.setProperty('--color-danger', theme.terminal?.red || (isLight ? '#d20f39' : '#f38ba8'))
  root.style.setProperty('--color-success', theme.terminal?.green || (isLight ? '#40a02b' : '#a6e3a1'))
  root.style.setProperty('--color-warning', theme.terminal?.yellow || (isLight ? '#df8e1d' : '#f9e2af'))
  root.style.setProperty('--color-info', theme.terminal?.blue || theme.ui.accent || (isLight ? '#1e66f5' : '#89b4fa'))
}

export const useThemeStore = defineStore('theme', () => {
  // Load custom themes from localStorage
  const loadCustomThemes = (): AppTheme[] => {
    if (typeof window === 'undefined') return []
    try {
      const saved = localStorage.getItem('flowsftp_custom_themes')
      if (saved) {
        return JSON.parse(saved)
      }
    } catch (e) {
      console.warn('Failed to load custom themes from localStorage:', e)
    }
    return []
  }

  const customThemes = ref<AppTheme[]>(loadCustomThemes())

  // All themes: built-ins + custom
  const allThemes = computed<AppTheme[]>(() => {
    return [...BUILT_IN_THEMES, ...customThemes.value]
  })

  // Selected Theme ID
  const currentThemeId = ref<string>(
    typeof window !== 'undefined'
      ? localStorage.getItem('flowsftp_theme_id') || 'default'
      : 'default'
  )

  // Current active theme object
  const currentTheme = computed<AppTheme>(() => {
    return (
      allThemes.value.find((t) => t.id === currentThemeId.value) ||
      BUILT_IN_THEMES[0]
    )
  })

  // Watch for theme change and update DOM variables & localStorage
  if (typeof window !== 'undefined') {
    watch(
      currentTheme,
      (newTheme) => {
        applyThemeToDom(newTheme)
        localStorage.setItem('flowsftp_theme_id', newTheme.id)
      },
      { immediate: true }
    )

    watch(
      customThemes,
      (themes) => {
        localStorage.setItem('flowsftp_custom_themes', JSON.stringify(themes))
      },
      { deep: true }
    )
  }

  function setTheme(id: string) {
    const found = allThemes.value.find((t) => t.id === id)
    if (found) {
      currentThemeId.value = id
      applyThemeToDom(found)
    }
  }

  function validateThemeJson(obj: any): { valid: boolean; error?: string } {
    if (!obj || typeof obj !== 'object') {
      return { valid: false, error: 'JSON content must be an object' }
    }
    if (!obj.name || typeof obj.name !== 'string') {
      return { valid: false, error: 'Theme must have a "name" string' }
    }
    if (!obj.ui || typeof obj.ui !== 'object') {
      return { valid: false, error: 'Theme must have a "ui" color object' }
    }
    const requiredUi = ['bgApp', 'bgHeader', 'bgCard', 'bgPane', 'border', 'textMain', 'accent']
    for (const key of requiredUi) {
      if (!obj.ui[key]) {
        return { valid: false, error: `Theme ui is missing required color: "${key}"` }
      }
    }
    if (!obj.terminal || typeof obj.terminal !== 'object') {
      return { valid: false, error: 'Theme must have a "terminal" color object' }
    }
    const requiredTerm = ['background', 'foreground', 'cursor']
    for (const key of requiredTerm) {
      if (!obj.terminal[key]) {
        return { valid: false, error: `Theme terminal is missing required color: "${key}"` }
      }
    }
    return { valid: true }
  }

  function importThemeFromJson(jsonText: string): { success: boolean; message: string; themeId?: string } {
    try {
      const parsed = JSON.parse(jsonText)
      const validation = validateThemeJson(parsed)
      if (!validation.valid) {
        return { success: false, message: validation.error || 'Invalid theme format' }
      }

      // Generate or normalize ID
      const baseId = (parsed.id || parsed.name)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 32)
      
      const themeId = `custom-${baseId || Date.now()}`

      // Fill in default values if optional keys are missing
      const fullUi: ThemeUiColors = {
        bgApp: parsed.ui.bgApp,
        bgHeader: parsed.ui.bgHeader || parsed.ui.bgApp,
        bgCard: parsed.ui.bgCard || parsed.ui.bgApp,
        bgPane: parsed.ui.bgPane || parsed.ui.bgApp,
        bgHover: parsed.ui.bgHover || '#293548',
        border: parsed.ui.border || '#334155',
        borderActive: parsed.ui.borderActive || parsed.ui.accent,
        textMain: parsed.ui.textMain || '#ffffff',
        textMuted: parsed.ui.textMuted || '#94a3b8',
        accent: parsed.ui.accent,
        accentHover: parsed.ui.accentHover || parsed.ui.accent,
        accentSecondary: parsed.ui.accentSecondary || '#10b981',
      }

      const fullTerminal: ThemeTerminalColors = {
        background: parsed.terminal.background || fullUi.bgPane,
        foreground: parsed.terminal.foreground || fullUi.textMain,
        cursor: parsed.terminal.cursor || fullUi.accent,
        cursorAccent: parsed.terminal.cursorAccent || fullUi.bgPane,
        selectionBackground: parsed.terminal.selectionBackground || '#334155',
        selectionForeground: parsed.terminal.selectionForeground || '#ffffff',
        black: parsed.terminal.black || '#0f172a',
        red: parsed.terminal.red || '#ef4444',
        green: parsed.terminal.green || '#22c55e',
        yellow: parsed.terminal.yellow || '#eab308',
        blue: parsed.terminal.blue || '#3b82f6',
        magenta: parsed.terminal.magenta || '#a855f7',
        cyan: parsed.terminal.cyan || '#06b6d4',
        white: parsed.terminal.white || '#f8fafc',
        brightBlack: parsed.terminal.brightBlack || '#64748b',
        brightRed: parsed.terminal.brightRed || '#f87171',
        brightGreen: parsed.terminal.brightGreen || '#4ade80',
        brightYellow: parsed.terminal.brightYellow || '#facc15',
        brightBlue: parsed.terminal.brightBlue || '#60a5fa',
        brightMagenta: parsed.terminal.brightMagenta || '#c084fc',
        brightCyan: parsed.terminal.brightCyan || '#38bdf8',
        brightWhite: parsed.terminal.brightWhite || '#ffffff',
      }

      const newTheme: AppTheme = {
        id: themeId,
        name: parsed.name,
        description: parsed.description || 'Custom imported JSON theme',
        author: parsed.author || 'User',
        isCustom: true,
        ui: fullUi,
        terminal: fullTerminal,
      }

      // Filter out existing if same ID
      customThemes.value = customThemes.value.filter((t) => t.id !== themeId)
      customThemes.value.push(newTheme)

      // Set active
      currentThemeId.value = themeId
      applyThemeToDom(newTheme)

      return {
        success: true,
        message: `Theme "${newTheme.name}" loaded successfully!`,
        themeId,
      }
    } catch (e: any) {
      return { success: false, message: `Failed to parse JSON: ${e.message}` }
    }
  }

  function deleteCustomTheme(id: string) {
    customThemes.value = customThemes.value.filter((t) => t.id !== id)
    if (currentThemeId.value === id) {
      setTheme('default')
    }
  }

  async function exportThemeJson(theme: AppTheme): Promise<{ success: boolean; message: string; path?: string }> {
    const exportData = {
      id: theme.id,
      name: theme.name,
      description: theme.description || '',
      author: theme.author || '',
      ui: theme.ui,
      terminal: theme.terminal,
    }
    const jsonString = JSON.stringify(exportData, null, 2)
    const defaultName = `flowsftp-theme-${theme.id}.json`

    // Try native Tauri save_file_dialog first
    try {
      const savedPath = await invoke<string | null>('save_file_dialog', {
        defaultName,
        content: jsonString,
        filterName: 'JSON Files (*.json)',
        filterExt: 'json',
      })

      if (savedPath) {
        return {
          success: true,
          message: `Theme "${theme.name}" exported to ${savedPath}`,
          path: savedPath,
        }
      } else {
        return {
          success: false,
          message: 'Export cancelled',
        }
      }
    } catch (err: any) {
      console.warn('Native save dialog failed or unavailable, falling back to browser download:', err)

      if (typeof window !== 'undefined') {
        try {
          const blob = new Blob([jsonString], {
            type: 'application/json',
          })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = defaultName
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          URL.revokeObjectURL(url)
          return {
            success: true,
            message: `Theme "${theme.name}" exported as ${defaultName}`,
          }
        } catch (e: any) {
          return {
            success: false,
            message: `Failed to export theme: ${e.message}`,
          }
        }
      }

      return {
        success: false,
        message: `Failed to export theme: ${err?.message || err}`,
      }
    }
  }

  const isCurrentThemeLight = computed(() => isLightTheme(currentTheme.value))

  return {
    allThemes,
    customThemes,
    currentThemeId,
    currentTheme,
    isCurrentThemeLight,
    setTheme,
    importThemeFromJson,
    deleteCustomTheme,
    exportThemeJson,
    applyThemeToDom,
    isLightTheme,
  }
})
